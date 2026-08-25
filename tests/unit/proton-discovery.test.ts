import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BridgeCredentials } from '../../src/shared/contracts/proton';
import {
  extractRecipientEvidence,
  type ProtonReadClientPort,
} from '../../src/main/proton/bridge-client';
import { ProtonConnectionRepository } from '../../src/main/proton/proton-connection-repository';
import { ProtonDiscoveryRepository } from '../../src/main/proton/proton-discovery-repository';
import { discoverProtonMailbox } from '../../src/main/proton/proton-discovery-service';
import { ProfileRepository } from '../../src/main/profiles/profile-repository';
import {
  SafeStorageVault,
  type SafeStoragePort,
} from '../../src/main/secrets/safe-storage-vault';

const roots: string[] = [];
const makeRoot = () => {
  const root = mkdtempSync(path.join(tmpdir(), 'mail-steward-discovery-'));
  roots.push(root);
  return root;
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const reversibleStorage: SafeStoragePort = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(value, 'utf8').reverse(),
  decryptString: (value) => Buffer.from(value).reverse().toString('utf8'),
};

const credentials: BridgeCredentials = {
  host: '127.0.0.1',
  port: 1143,
  username: 'combined-bridge-user',
  password: 'generated-secret',
  security: 'starttls',
};

class FakeReadClient implements ProtonReadClientPort {
  readonly capabilityCount = 3;
  connected = false;
  closed = false;
  sampledPath: string | null = null;

  async connect(): Promise<void> { this.connected = true; }
  async close(): Promise<void> { this.closed = true; }
  async listMailboxCount(): Promise<number> { return 2; }
  capabilityNames(): readonly string[] { return ['IMAP4rev1', 'IDLE', 'SPECIAL-USE']; }
  async listMailboxes() {
    return [
      {
        path: 'INBOX', name: 'Inbox', delimiter: '/', specialUse: '\\Inbox', flags: [],
        messageCount: 12, unreadCount: 4, uidValidity: '55', uidNext: 18,
      },
      {
        path: 'All Mail', name: 'All Mail', delimiter: '/', specialUse: '\\All', flags: [],
        messageCount: 30, unreadCount: 5, uidValidity: '56', uidNext: 35,
      },
    ];
  }
  async sampleRecipientHeaders(mailboxPath: string) {
    this.sampledPath = mailboxPath;
    return [
      { address: 'Primary@pm.test', source: 'delivered-to' as const, seenAt: '2026-08-23T10:00:00.000Z' },
      { address: 'primary@pm.test', source: 'to' as const, seenAt: '2026-08-23T10:00:00.000Z' },
      { address: 'groceries@pm.test', source: 'x-original-to' as const, seenAt: '2026-08-20T10:00:00.000Z' },
    ];
  }
}

const setup = (profileId: string) => {
  const root = makeRoot();
  const profile = new ProfileRepository(root, { createId: () => profileId }).createProfile('Owner');
  const vault = new SafeStorageVault(root, profile.database, reversibleStorage);
  const connections = new ProtonConnectionRepository(profile.database, vault, profileId);
  const connection = connections.save(credentials);
  return { profile, connections, connection };
};

describe('Proton read-only discovery', () => {
  it('extracts only recipient header evidence and unfolds continuation lines', () => {
    const headers = Buffer.from(
      'Subject: do not index this\r\nTo: Person <Primary@pm.test>,\r\n groceries@pm.test\r\nDelivered-To: primary+shop@proton.test\r\nFrom: sender@example.com\r\n',
    );
    expect(extractRecipientEvidence(headers, '2026-08-24T12:00:00.000Z')).toEqual([
      { address: 'primary@pm.test', source: 'to', seenAt: '2026-08-24T12:00:00.000Z' },
      { address: 'groceries@pm.test', source: 'to', seenAt: '2026-08-24T12:00:00.000Z' },
      { address: 'primary+shop@proton.test', source: 'delivered-to', seenAt: '2026-08-24T12:00:00.000Z' },
    ]);
  });

  it('discovers capabilities, folders, and normalized aliases without mutations', async () => {
    const { profile, connections, connection } = setup('8fd4ecbf-1434-42e8-b7f3-30293a81f530');
    const repository = new ProtonDiscoveryRepository(profile.database, profile.profile.id, {
      now: () => '2026-08-24T12:00:00.000Z',
    });
    const client = new FakeReadClient();
    const result = await discoverProtonMailbox(connections, repository, () => client);

    expect(client.connected).toBe(true);
    expect(client.closed).toBe(true);
    expect(client.sampledPath).toBe('All Mail');
    expect(result.connectionId).toBe(connection.id);
    expect(result.totalMessageEstimate).toBe(42);
    expect(result.mailboxes).toHaveLength(2);
    expect(result.addresses).toEqual([
      {
        address: 'primary@pm.test', occurrenceCount: 2,
        lastSeenAt: '2026-08-23T10:00:00.000Z', sources: ['delivered-to', 'to'],
      },
      {
        address: 'groceries@pm.test', occurrenceCount: 1,
        lastSeenAt: '2026-08-20T10:00:00.000Z', sources: ['x-original-to'],
      },
    ]);
    expect(repository.get(connection.id)).toEqual(result);
    profile.database.close();
  });

  it('keeps discovery snapshots isolated by profile and cascades them on disconnect', async () => {
    const first = setup('b4e60217-3ba7-4646-aa03-0c25fcf1cd45');
    const repository = new ProtonDiscoveryRepository(first.profile.database, first.profile.profile.id);
    await discoverProtonMailbox(first.connections, repository, () => new FakeReadClient());
    first.connections.disconnect(first.connection.id);
    expect(repository.get(first.connection.id)).toBeNull();
    expect((first.profile.database.prepare('SELECT COUNT(*) AS count FROM receiving_addresses').get() as { count: number }).count).toBe(0);
    first.profile.database.close();
  });
});
