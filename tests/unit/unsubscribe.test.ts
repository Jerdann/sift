import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyzeMailbox } from '../../src/main/analysis/mailbox-analysis-service';
import { JobRepository } from '../../src/main/jobs/job-repository';
import { ProfileRepository } from '../../src/main/profiles/profile-repository';
import { ProtonConnectionRepository } from '../../src/main/proton/proton-connection-repository';
import { ProtonDiscoveryRepository } from '../../src/main/proton/proton-discovery-repository';
import { SafeStorageVault, type SafeStoragePort } from '../../src/main/secrets/safe-storage-vault';
import { SubscriptionRepository } from '../../src/main/unsubscribe/subscription-repository';
import { postOneClickUnsubscribe, UnsubscribeRunner } from '../../src/main/unsubscribe/unsubscribe-runner';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const storage: SafeStoragePort = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(value).reverse(),
  decryptString: (value) => Buffer.from(value).reverse().toString(),
};

describe('safe bulk unsubscribe', () => {
  it('posts only the RFC 8058 body without credentials and rejects unsafe redirects/hosts', async () => {
    const headers = new Headers();
    const fetchPort = vi.fn(async () => ({ status: 204, headers }));
    await expect(postOneClickUnsubscribe(
      'https://lists.example.test/unsubscribe/token',
      fetchPort,
      async () => ['203.0.113.10'],
    )).resolves.toBe(true);
    expect(fetchPort).toHaveBeenCalledWith('https://lists.example.test/unsubscribe/token', expect.objectContaining({
      method: 'POST', redirect: 'manual', credentials: 'omit', body: 'List-Unsubscribe=One-Click',
    }));

    await expect(postOneClickUnsubscribe(
      'https://lists.example.test/unsubscribe',
      async () => ({ status: 302, headers: new Headers({ location: 'https://tracker.evil.test/confirm' }) }),
      async () => ['203.0.113.10'],
    )).rejects.toThrow('unsafe_unsubscribe_redirect');
    await expect(postOneClickUnsubscribe(
      'https://localhost/unsubscribe',
      fetchPort,
      async () => ['127.0.0.1'],
    )).rejects.toThrow('unsafe_unsubscribe_host');
  });

  it('separates eligible, protected, manual, and spam lists and executes only selected eligible requests', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'mail-steward-unsubscribe-'));
    roots.push(root);
    const profileId = 'ebf66734-267a-4a0a-a2e7-238774c04e22';
    const profile = new ProfileRepository(root, { createId: () => profileId }).createProfile('Subscription owner');
    const vault = new SafeStorageVault(root, profile.database, storage);
    const connection = new ProtonConnectionRepository(profile.database, vault, profileId).save({ host: '127.0.0.1', port: 1143, username: 'bridge', password: 'generated', security: 'starttls' });
    const discovery = new ProtonDiscoveryRepository(profile.database, profileId).replace(connection.id, {
      capabilities: ['IMAP4rev1'],
      mailboxes: [{ path: 'INBOX', name: 'Inbox', delimiter: '/', specialUse: '\\Inbox', flags: [], messageCount: 5, unreadCount: 5, uidValidity: '1', uidNext: 6 }],
      addresses: [{ address: 'owner@pm.test', occurrenceCount: 5, lastSeenAt: '2026-08-24T12:00:00.000Z', sources: ['delivered-to'] }],
    });
    const inbox = discovery.mailboxes[0]!;
    const insert = profile.database.prepare(`
      INSERT INTO indexed_messages(
        id, connection_id, container_id, uid_validity, uid, message_id, received_at,
        subject, sender_json, recipients_json, headers_json, flags_json, size_bytes,
        body_text, body_truncated, indexed_at
      ) VALUES (?, ?, ?, '1', ?, ?, '2026-08-24T12:00:00.000Z', ?, ?, '["owner@pm.test"]', ?, '[]', 100, NULL, 0, '2026-08-24T12:00:00.000Z')
    `);
    const eligibleHeaders = JSON.stringify({
      'delivered-to': 'owner@pm.test', 'list-id': '<weekly.news.example>',
      'list-unsubscribe': '<https://news.example/unsub/opaque>',
      'list-unsubscribe-post': 'List-Unsubscribe=One-Click',
      'authentication-results': 'dkim=pass; dmarc=pass',
    });
    insert.run('2ee5f16d-5a18-4688-84c8-25b8f7f7766e', connection.id, inbox.id, 1, '<eligible>', 'Weekly news and updates', '["hello@news.example"]', eligibleHeaders);
    insert.run('8215a56f-a9b0-49d3-87ec-093804d696ab', connection.id, inbox.id, 2, '<protected>', 'Receipt for your payment', '["billing@billing.example"]', JSON.stringify({ ...JSON.parse(eligibleHeaders), 'list-id': '<billing.example>', 'list-unsubscribe': '<https://billing.example/unsub>' }));
    insert.run('60bf3903-4b81-4c7b-a926-e60751bff86d', connection.id, inbox.id, 3, '<manual>', 'Monthly digest', '["digest@manual.example"]', JSON.stringify({ 'delivered-to': 'owner@pm.test', 'list-id': '<manual.example>', 'authentication-results': 'dkim=pass; dmarc=pass', 'list-unsubscribe': '<mailto:leave@manual.example>' }));
    insert.run('246097df-00eb-4363-987a-50810493a8be', connection.id, inbox.id, 4, '<spam>', 'Claim your crypto giveaway', '["scam@bad.example"]', JSON.stringify({ 'delivered-to': 'owner@pm.test', 'list-id': '<bad.example>', 'list-unsubscribe': '<https://bad.example/confirm>', 'list-unsubscribe-post': 'List-Unsubscribe=One-Click', 'authentication-results': 'dkim=fail; dmarc=fail' }));
    insert.run('7f1711f8-829f-47e4-a70f-17b877690fd0', connection.id, inbox.id, 5, '<eligible-two>', 'Daily product updates', '["updates@news.example"]', JSON.stringify({ ...JSON.parse(eligibleHeaders), 'list-id': '<daily.news.example>', 'list-unsubscribe': '<https://news.example/unsub/second>' }));
    analyzeMailbox(profile.database, profileId, connection.id);
    const jobs = new JobRepository(profile.database);
    const repository = new SubscriptionRepository(profile.database, jobs, profileId);
    const dashboard = repository.scan(connection.id);
    expect(dashboard.candidates.map((candidate) => candidate.eligibility)).toEqual(expect.arrayContaining(['eligible', 'protected', 'manual', 'spam_skipped']));
    const eligible = dashboard.candidates.find((candidate) => candidate.eligibility === 'eligible')!;
    expect(eligible).toMatchObject({ messagesPerMonth: 1, readRate: 0 });
    const spam = dashboard.candidates.find((candidate) => candidate.eligibility === 'spam_skipped')!;
    expect(() => repository.start([spam.id])).toThrow('unsubscribe_selection_invalid');
    const started = repository.start([eligible.id]);
    expect(() => repository.scan(connection.id)).toThrow('unsubscribe_run_active');
    let succeeds = false;
    const post = vi.fn(async () => succeeds);
    const failed = await new UnsubscribeRunner(jobs, repository, post).run(started.job!.id);
    expect(failed.dashboard.job?.state).toBe('failed');
    expect(failed.dashboard.candidates.find((candidate) => candidate.id === eligible.id)?.status).toBe('failed');
    succeeds = true;
    repository.retry(started.job!.id, [eligible.id]);
    const result = await new UnsubscribeRunner(jobs, repository, post).run(started.job!.id);
    expect(result.dashboard.job?.state).toBe('succeeded');
    expect(result.dashboard.candidates.find((candidate) => candidate.id === eligible.id)?.status).toBe('unsubscribed');
    expect(result.dashboard.candidates.find((candidate) => candidate.id === spam.id)?.status).toBe('spam_skipped');
    expect(result.dashboard.candidates.find((candidate) => candidate.id === eligible.id)?.recurrence).toBe('quiet');
    profile.database.prepare("UPDATE unsubscribe_ledger SET requested_at='2020-01-01T00:00:00.000Z'").run();
    expect(repository.getByScan(repository.scanIdForJob(started.job!.id)).candidates.find((candidate) => candidate.id === eligible.id)?.recurrence).toBe('recurring');
    expect(post).toHaveBeenCalledTimes(2);

    const throttleScan = repository.scan(connection.id);
    const throttleCandidates = throttleScan.candidates.filter((candidate) => candidate.eligibility === 'eligible').map((candidate) => candidate.id);
    const throttleRun = repository.start(throttleCandidates);
    let clock = 1_000;
    const waits: number[] = [];
    await new UnsubscribeRunner(jobs, repository, async () => true, {
      minimumHostIntervalMs: 750,
      now: () => clock,
      wait: async (milliseconds) => { waits.push(milliseconds); clock += milliseconds; },
    }).run(throttleRun.job!.id);
    expect(waits).toEqual([750]);
    profile.database.close();
  });
});
