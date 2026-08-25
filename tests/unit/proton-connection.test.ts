import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BridgeCredentials } from '../../src/shared/contracts/proton';
import { bridgeCredentialsSchema } from '../../src/shared/contracts/proton';
import {
  type BridgeClientPort,
  diagnoseBridge,
} from '../../src/main/proton/bridge-client';
import { ProtonConnectionRepository } from '../../src/main/proton/proton-connection-repository';
import { ProfileRepository } from '../../src/main/profiles/profile-repository';
import {
  SafeStorageVault,
  type SafeStoragePort,
} from '../../src/main/secrets/safe-storage-vault';

const roots: string[] = [];
const makeRoot = () => {
  const root = mkdtempSync(path.join(tmpdir(), 'mail-steward-proton-'));
  roots.push(root);
  return root;
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

const credentials: BridgeCredentials = {
  host: '127.0.0.1',
  port: 1143,
  username: 'bridge-user',
  password: 'bridge-generated-password',
  security: 'starttls',
};

class FakeBridgeClient implements BridgeClientPort {
  readonly capabilityCount = 7;
  closed = false;

  constructor(private readonly failure?: unknown) {}

  async connect(): Promise<void> {
    if (this.failure) throw this.failure;
  }

  async listMailboxCount(): Promise<number> {
    return 12;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

const reversibleStorage: SafeStoragePort = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(value, 'utf8').reverse(),
  decryptString: (value) => Buffer.from(value).reverse().toString('utf8'),
};

describe('Proton Bridge connection', () => {
  it('accepts loopback only and reports successful read-only diagnostics', async () => {
    expect(() =>
      bridgeCredentialsSchema.parse({ ...credentials, host: 'mail.proton.me' }),
    ).toThrow();

    const client = new FakeBridgeClient();
    const diagnostic = await diagnoseBridge(credentials, () => client);
    expect(diagnostic).toEqual({
      ok: true,
      category: 'connected',
      message: 'Bridge accepted the local connection. No mailbox changes were made.',
      capabilityCount: 7,
      mailboxCount: 12,
    });
    expect(client.closed).toBe(true);
  });

  it.each([
    [{ code: 'ECONNREFUSED' }, 'bridge_unavailable'],
    [{ authenticationFailed: true }, 'authentication_failed'],
    [{ code: 'CERT_HAS_EXPIRED' }, 'tls_failed'],
    [{ code: 'ECONNRESET' }, 'connection_interrupted'],
  ] as const)('maps %o to %s without returning raw errors', async (failure, category) => {
    const diagnostic = await diagnoseBridge(
      credentials,
      () => new FakeBridgeClient(failure),
    );
    expect(diagnostic.ok).toBe(false);
    expect(diagnostic.category).toBe(category);
    expect(JSON.stringify(diagnostic)).not.toContain(credentials.password);
  });

  it('stores a write-only Bridge password in the profile vault and removes it', () => {
    const root = makeRoot();
    const profileId = '747080ee-8ae8-4809-9e55-9be87015d686';
    const profile = new ProfileRepository(root, { createId: () => profileId }).createProfile(
      'Proton profile',
    );
    const vault = new SafeStorageVault(root, profile.database, reversibleStorage);
    const repository = new ProtonConnectionRepository(
      profile.database,
      vault,
      profileId,
      {
        createId: () => 'fc9572a6-fcbb-4e72-adc9-e140c10512bb',
        now: () => '2026-08-24T12:00:00.000Z',
      },
    );

    const summary = repository.save(credentials);
    expect(summary).not.toHaveProperty('password');
    expect(repository.getCredentials()).toEqual(credentials);

    const connectionRow = profile.database
      .prepare('SELECT * FROM provider_connections')
      .get() as Record<string, unknown>;
    expect(JSON.stringify(connectionRow)).not.toContain(credentials.password);
    for (const relative of readdirSync(root, { recursive: true }) as string[]) {
      const file = path.join(root, relative);
      if (statSync(file).isFile()) {
        expect(readFileSync(file).includes(Buffer.from(credentials.password))).toBe(false);
      }
    }

    repository.disconnect(summary.id);
    expect(repository.get()).toBeNull();
    expect(
      (profile.database.prepare('SELECT COUNT(*) AS count FROM secret_refs').get() as {
        count: number;
      }).count,
    ).toBe(0);
    profile.database.close();
  });
});
