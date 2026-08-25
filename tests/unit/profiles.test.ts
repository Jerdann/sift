import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProfileRepository } from '../../src/main/profiles/profile-repository';
import {
  openProfileDatabase,
  resolveProfileDirectory,
} from '../../src/main/storage/database';
import { MIGRATIONS } from '../../src/main/storage/migrations';

const roots: string[] = [];
const makeRoot = () => {
  const root = mkdtempSync(path.join(tmpdir(), 'mail-steward-profiles-'));
  roots.push(root);
  return root;
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('local profile isolation', () => {
  it('uses generated IDs for paths while keeping unsafe-looking names as metadata', () => {
    const root = makeRoot();
    const ids = [
      '77ac437c-c7ac-4f38-b95d-0fb033043787',
      'ad2854d1-d6d9-4b23-adac-8d6e841ac36b',
    ];
    const repository = new ProfileRepository(root, {
      createId: () => ids.shift()!,
      now: () => '2026-08-24T12:00:00.000Z',
    });

    const first = repository.createProfile('../../Private Mail');
    const second = repository.createProfile('Girlfriend / Gmail');

    expect(first.profileDirectory).not.toBe(second.profileDirectory);
    expect(first.profileDirectory).toContain(first.profile.id);
    expect(first.profileDirectory).not.toContain(first.profile.displayName);
    expect(path.relative(root, first.profileDirectory)).not.toMatch(/^\.\./);
    expect(repository.listProfiles().map((profile) => profile.displayName)).toEqual([
      '../../Private Mail',
      'Girlfriend / Gmail',
    ]);

    first.database.close();
    second.database.close();
  });

  it('keeps each profile database and audit history separate', () => {
    const root = makeRoot();
    const ids = [
      '6dcf1390-987e-4e37-8566-58a8a1f1a704',
      'f57eb634-19c8-4205-8603-068631726463',
    ];
    const repository = new ProfileRepository(root, { createId: () => ids.shift()! });
    const first = repository.createProfile('One');
    const second = repository.createProfile('Two');

    first.database
      .prepare('INSERT INTO audit_events(id, event_type, safe_payload_json, created_at) VALUES (?, ?, ?, ?)')
      .run('event-one', 'profile.created', '{}', '2026-08-24T12:00:00.000Z');

    expect(
      (first.database.prepare('SELECT COUNT(*) AS count FROM audit_events').get() as { count: number }).count,
    ).toBe(1);
    expect(
      (second.database.prepare('SELECT COUNT(*) AS count FROM audit_events').get() as { count: number }).count,
    ).toBe(0);

    first.database.close();
    second.database.close();
  });

  it('rejects traversal and unknown profile identifiers', () => {
    const root = makeRoot();
    const repository = new ProfileRepository(root);
    expect(() => resolveProfileDirectory(root, '../outside')).toThrow();
    expect(() => repository.openProfile('00000000-0000-4000-8000-000000000000')).toThrow(
      'not found',
    );
  });

  it('applies ordered migrations exactly once with foreign keys and WAL enabled', () => {
    const root = makeRoot();
    const id = 'f418fc74-b215-4214-b850-624bfb0d9562';
    const first = openProfileDatabase(root, id);
    first.database.close();
    const second = openProfileDatabase(root, id);

    const applied = second.database
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all() as Array<{ version: number }>;
    expect(applied.map(({ version }) => version)).toEqual(
      MIGRATIONS.map(({ version }) => version),
    );
    expect(second.database.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(second.database.pragma('journal_mode', { simple: true })).toBe('wal');
    second.database.close();
  });
});
