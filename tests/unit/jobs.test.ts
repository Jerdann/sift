import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { JobRepository } from '../../src/main/jobs/job-repository';
import { JobRunner } from '../../src/main/jobs/job-runner';
import { openProfileDatabase } from '../../src/main/storage/database';

const roots: string[] = [];
const profileId = '97e8488f-ff1e-47fd-a3a1-9fd94589b205';

const openTestDatabase = () => {
  const root = mkdtempSync(path.join(tmpdir(), 'mail-steward-jobs-'));
  roots.push(root);
  return { root, ...openProfileDatabase(root, profileId) };
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('durable jobs', () => {
  it('deduplicates job creation by stable idempotency key', () => {
    const context = openTestDatabase();
    const repository = new JobRepository(context.database);
    const input = {
      profileId,
      kind: 'synthetic-audit' as const,
      idempotencyKey: 'synthetic:stable-request',
      itemKeys: ['one', 'two'],
    };
    const first = repository.createJob(input);
    const second = repository.createJob(input);

    expect(second.id).toBe(first.id);
    expect(
      (context.database.prepare('SELECT COUNT(*) AS count FROM jobs').get() as { count: number }).count,
    ).toBe(1);
    expect(
      (context.database.prepare('SELECT COUNT(*) AS count FROM job_items').get() as { count: number }).count,
    ).toBe(2);
    context.database.close();
  });

  it('rejects illegal state transitions without corrupting progress', () => {
    const context = openTestDatabase();
    const repository = new JobRepository(context.database);
    const job = repository.createJob({
      profileId,
      kind: 'synthetic-audit',
      idempotencyKey: 'synthetic:transition-test',
      itemKeys: ['one'],
    });
    const item = repository.claimNextPending(job.id)!;

    expect(() => repository.transitionItem(item.id, 'running')).toThrow(
      'Illegal job item transition',
    );
    expect(repository.getProgress(job.id)).toMatchObject({
      state: 'running',
      counts: { running: 1, succeeded: 0 },
    });
    context.database.close();
  });

  it('claims a durable batch in order with one attempt per item', () => {
    const context = openTestDatabase();
    const repository = new JobRepository(context.database);
    const job = repository.createJob({
      profileId,
      kind: 'proton-cleanup',
      idempotencyKey: 'cleanup:batch-claim',
      itemKeys: ['one', 'two', 'three', 'four'],
    });

    const claimed = repository.claimNextPendingBatch(job.id, 3);

    expect(claimed.map((item) => item.itemKey)).toEqual(['one', 'two', 'three']);
    expect(claimed.every((item) => item.state === 'running' && item.attempts === 1)).toBe(true);
    expect(repository.getProgress(job.id).counts).toMatchObject({ pending: 1, running: 3 });
    expect(() => repository.claimNextPendingBatch(job.id, 501)).toThrow('batch size');
    context.database.close();
  });

  it('requeues an uncertain running batch without replaying completed items', () => {
    const context = openTestDatabase();
    const repository = new JobRepository(context.database);
    const job = repository.createJob({
      profileId,
      kind: 'proton-cleanup',
      idempotencyKey: 'cleanup:uncertain-batch',
      itemKeys: ['one', 'two', 'three'],
    });
    const claimed = repository.claimNextPendingBatch(job.id, 3);
    repository.transitionItem(claimed[0]!.id, 'succeeded', {
      result: { operation: 'proton-cleanup-action', verified: true },
    });

    expect(repository.requeueRunning(job.id, 'provider_verification_pending')).toBe(2);
    expect(repository.getProgress(job.id)).toMatchObject({
      state: 'pending',
      errorCode: 'provider_verification_pending',
      counts: { succeeded: 1, pending: 2, running: 0 },
    });
    expect(repository.claimNextPendingBatch(job.id, 3).map((item) => item.itemKey)).toEqual(['two', 'three']);
    context.database.close();
  });

  it('recovers interrupted items and never replays verified successes', async () => {
    const firstContext = openTestDatabase();
    const firstRepository = new JobRepository(firstContext.database);
    const job = firstRepository.createJob({
      profileId,
      kind: 'synthetic-audit',
      idempotencyKey: 'synthetic:restart-test',
      itemKeys: ['one', 'two', 'three'],
    });
    const succeeded = firstRepository.claimNextPending(job.id)!;
    firstRepository.transitionItem(succeeded.id, 'succeeded', {
      result: { operation: 'synthetic-check', verified: true },
    });
    const interrupted = firstRepository.claimNextPending(job.id)!;
    expect(interrupted.state).toBe('running');
    firstContext.database.close();

    const secondContext = openProfileDatabase(firstContext.root, profileId);
    const secondRepository = new JobRepository(secondContext.database);
    expect(secondRepository.recoverInterrupted()).toBe(1);
    const observed: number[] = [];
    const runner = new JobRunner(secondRepository, { delay: async () => undefined });
    runner.subscribe((progress) => observed.push(progress.completedItems));
    const completed = await runner.run(job.id);

    expect(completed).toMatchObject({
      state: 'succeeded',
      completedItems: 3,
      counts: { succeeded: 3, pending: 0, running: 0 },
    });
    const attempts = secondContext.database
      .prepare('SELECT item_key, attempts FROM job_items WHERE job_id = ? ORDER BY item_key')
      .all(job.id) as Array<{ item_key: string; attempts: number }>;
    expect(attempts).toEqual([
      { item_key: 'one', attempts: 1 },
      { item_key: 'three', attempts: 1 },
      { item_key: 'two', attempts: 2 },
    ]);
    expect(observed.at(-1)).toBe(3);
    secondContext.database.close();
  });

  it('persists content-free audit events and sanitized progress only', async () => {
    const context = openTestDatabase();
    const repository = new JobRepository(context.database);
    const job = repository.createJob({
      profileId,
      kind: 'synthetic-audit',
      idempotencyKey: 'synthetic:safe-events',
      itemKeys: ['safe-item-key'],
    });
    const runner = new JobRunner(repository, { delay: async () => undefined });
    const progress = await runner.run(job.id);
    const events = context.database
      .prepare('SELECT event_type, safe_payload_json FROM audit_events WHERE job_id = ?')
      .all(job.id);
    const serialized = JSON.stringify({ progress, events });

    expect(serialized).not.toMatch(/subject|body|sender|recipient|token|password/i);
    expect(progress).not.toHaveProperty('itemKeys');
    expect(progress.percent).toBe(100);
    context.database.close();
  });
});
