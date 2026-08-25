import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProfileRepository } from '../../src/main/profiles/profile-repository';
import { ProfileSession } from '../../src/main/profiles/profile-session';
import { SafeStorageVault, type SafeStoragePort } from '../../src/main/secrets/safe-storage-vault';
import {
  InMemorySecretVault,
  SecretStorageUnavailableError,
} from '../../src/main/secrets/secret-vault';

const roots: string[] = [];
const makeRoot = () => {
  const root = mkdtempSync(path.join(tmpdir(), 'mail-steward-secrets-'));
  roots.push(root);
  return root;
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

const reversibleTestStorage: SafeStoragePort = {
  isEncryptionAvailable: () => true,
  encryptString: (plainText) => Buffer.from(plainText, 'utf8').reverse(),
  decryptString: (encrypted) => encrypted.reverse().toString('utf8'),
};

describe('secret vaults', () => {
  it('supports a deterministic in-memory implementation for tests', () => {
    const vault = new InMemorySecretVault({
      createId: () => 'c0b68bc2-9f00-48fb-b320-b2a620efcf29',
      now: () => '2026-08-24T12:00:00.000Z',
    });
    const profileId = '48e1cc06-cc5f-4709-a1ee-d71112deaeaa';
    const reference = vault.store(profileId, 'provider.credentials', 'secret-value');

    expect(reference).not.toHaveProperty('value');
    expect(vault.read(profileId, reference.id)).toBe('secret-value');
    expect(() =>
      vault.read('d7c8d192-63e6-464b-976f-13ab2c899e8b', reference.id),
    ).toThrow('not found');
    vault.delete(profileId, reference.id);
    expect(() => vault.read(profileId, reference.id)).toThrow('not found');
  });

  it('stores only opaque metadata in SQLite and encrypted bytes on disk', () => {
    const root = makeRoot();
    const profileId = '662be01f-bf4c-474c-a9ad-834339a9c83f';
    const repository = new ProfileRepository(root, { createId: () => profileId });
    const context = repository.createProfile('Private');
    const vault = new SafeStorageVault(root, context.database, reversibleTestStorage, {
      createId: () => '03c1503b-45a7-44c8-a869-d86c00fce2c6',
      now: () => '2026-08-24T12:00:00.000Z',
    });
    const canary = 'canary-provider-password';
    const reference = vault.store(profileId, 'proton.bridge', canary);

    expect(vault.read(profileId, reference.id)).toBe(canary);
    expect(JSON.stringify(reference)).not.toContain(canary);
    const row = context.database
      .prepare('SELECT * FROM secret_refs WHERE id = ?')
      .get(reference.id) as Record<string, unknown>;
    expect(Object.keys(row).sort()).toEqual([
      'created_at',
      'id',
      'profile_id',
      'purpose',
      'updated_at',
    ]);

    for (const relative of readdirSync(root, { recursive: true }) as string[]) {
      const file = path.join(root, relative);
      if (statSync(file).isFile()) {
        expect(readFileSync(file).includes(Buffer.from(canary))).toBe(false);
      }
    }
    context.database.close();
  });

  it('fails closed without OS encryption and writes no reference', () => {
    const root = makeRoot();
    const profileId = '8c63f6fb-0553-4d28-b8e0-c17d42be95ee';
    const repository = new ProfileRepository(root, { createId: () => profileId });
    const context = repository.createProfile('Locked');
    const vault = new SafeStorageVault(root, context.database, {
      isEncryptionAvailable: () => false,
      encryptString: () => { throw new Error('must not encrypt'); },
      decryptString: () => { throw new Error('must not decrypt'); },
    });

    expect(() => vault.store(profileId, 'provider.credentials', 'never-write-this')).toThrow(
      SecretStorageUnavailableError,
    );
    const count = context.database
      .prepare('SELECT COUNT(*) AS count FROM secret_refs')
      .get() as { count: number };
    expect(count.count).toBe(0);
    context.database.close();
  });

  it('binds the active production profile to its OS-backed vault', () => {
    const root = makeRoot();
    const profileId = '688db163-471c-4a20-bf4a-375284129c4e';
    const repository = new ProfileRepository(root, { createId: () => profileId });
    const session = new ProfileSession(
      repository,
      (context) =>
        new SafeStorageVault(root, context.database, reversibleTestStorage),
    );

    const profile = session.createProfile('Bound vault');
    const vault = session.requireSecretVault();
    const reference = vault.store(profile.id, 'provider.credentials', 'bound-secret');

    expect(vault.read(profile.id, reference.id)).toBe('bound-secret');
    session.close();
  });
});
