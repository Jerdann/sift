import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BridgeCredentials } from '../../src/shared/contracts/proton';
import type {
  ProtonAuditBatch,
  ProtonAuditClientPort,
  ProtonAuditMessage,
} from '../../src/main/proton/bridge-client';
import { JobRepository } from '../../src/main/jobs/job-repository';
import { ProfileRepository } from '../../src/main/profiles/profile-repository';
import { ProtonConnectionRepository } from '../../src/main/proton/proton-connection-repository';
import { ProtonDiscoveryRepository } from '../../src/main/proton/proton-discovery-repository';
import { ProtonAuditRepository } from '../../src/main/proton/proton-audit-repository';
import { ProtonAuditRunner } from '../../src/main/proton/proton-audit-runner';
import { SafeStorageVault, type SafeStoragePort } from '../../src/main/secrets/safe-storage-vault';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const storage: SafeStoragePort = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(value).reverse(),
  decryptString: (value) => Buffer.from(value).reverse().toString(),
};
const credentials: BridgeCredentials = {
  host: '127.0.0.1', port: 1143, username: 'bridge', password: 'generated', security: 'starttls',
};

const message = (uid: number, options: Partial<ProtonAuditMessage> = {}): ProtonAuditMessage => ({
  uid,
  messageId: `<${uid}@example.test>`,
  receivedAt: `2026-08-${String((uid % 20) + 1).padStart(2, '0')}T12:00:00.000Z`,
  subject: `Message ${uid}`,
  senders: ['sender@example.test'],
  recipients: ['owner@pm.test'],
  headers: {},
  flags: [],
  sizeBytes: 100,
  bodyText: null,
  bodyTruncated: false,
  bodyError: false,
  ...options,
});

class FakeAuditClient implements ProtonAuditClientPort {
  readonly capabilityCount = 1;
  readonly calls: number[] = [];
  closed = false;
  constructor(private readonly total: number, private readonly validity = '7') {}
  async connect() {}
  async close() { this.closed = true; }
  async listMailboxCount() { return 1; }
  capabilityNames() { return ['IMAP4rev1']; }
  async listMailboxes() { return []; }
  async sampleRecipientHeaders() { return []; }
  async fetchAuditBatch(_path: string, fromUid: number, limit: number): Promise<ProtonAuditBatch> {
    this.calls.push(fromUid);
    const messages = Array.from(
      { length: Math.max(0, Math.min(limit, this.total - fromUid + 1)) },
      (_, index) => message(fromUid + index),
    );
    return { uidValidity: this.validity, uidNext: this.total + 1, exists: this.total, messages };
  }
}

class FolderFailureClient extends FakeAuditClient {
  override async fetchAuditBatch(path: string, fromUid: number, limit: number): Promise<ProtonAuditBatch> {
    if (path === 'INBOX') throw new Error('synthetic folder failure containing owner@pm.test');
    return super.fetchAuditBatch(path, fromUid, limit);
  }
}

const setup = () => {
  const root = mkdtempSync(path.join(tmpdir(), 'mail-steward-audit-'));
  roots.push(root);
  const profileId = '49793693-41df-4473-8fe5-ca044fa2b50f';
  const profile = new ProfileRepository(root, { createId: () => profileId }).createProfile('Audit owner');
  const vault = new SafeStorageVault(root, profile.database, storage);
  const connections = new ProtonConnectionRepository(profile.database, vault, profileId);
  const connection = connections.save(credentials);
  const discovery = new ProtonDiscoveryRepository(profile.database, profileId);
  const snapshot = discovery.replace(connection.id, {
    capabilities: ['IMAP4rev1'],
    mailboxes: [{
      path: 'INBOX', name: 'Inbox', delimiter: '/', specialUse: '\\Inbox', flags: [],
      messageCount: 150, unreadCount: 100, uidValidity: '7', uidNext: 151,
    }],
    addresses: [],
  });
  const jobs = new JobRepository(profile.database);
  const job = jobs.createJob({
    profileId,
    kind: 'proton-audit',
    idempotencyKey: `audit:${connection.id}`,
    itemKeys: ['INBOX'],
  });
  const audits = new ProtonAuditRepository(profile.database);
  audits.registerRun(job.id, connection.id, false);
  return { profile, connections, connection, jobs, job, audits, containerId: snapshot.mailboxes[0]!.id };
};

describe('Proton UID-safe read-only audit', () => {
  it('indexes metadata in resumable batches without exposing mutation methods', async () => {
    const current = setup();
    const firstClient = new FakeAuditClient(150);
    const firstRunner = new ProtonAuditRunner(current.jobs, current.audits, current.connections, () => firstClient);
    firstRunner.subscribe((progress) => {
      if (progress.indexedMessages === 100) firstRunner.requestPause(current.job.id);
    });
    const paused = await firstRunner.run(current.job.id);
    expect(paused.job.state).toBe('pending');
    expect(paused.indexedMessages).toBe(100);
    expect(firstClient.calls).toEqual([1]);

    const secondClient = new FakeAuditClient(150);
    const resumed = await new ProtonAuditRunner(
      current.jobs, current.audits, current.connections, () => secondClient,
    ).run(current.job.id);
    expect(secondClient.calls).toEqual([101]);
    expect(resumed.job.state).toBe('succeeded');
    expect(resumed.profileId).toBe(current.profile.profile.id);
    expect(resumed.indexedMessages).toBe(150);
    expect((current.profile.database.prepare('SELECT COUNT(*) AS count FROM indexed_messages').get() as { count: number }).count).toBe(150);
    expect(Object.keys(firstClient)).not.toContain('messageMove');
    expect(firstClient.closed).toBe(true);
    current.profile.database.close();
  });

  it('atomically replaces only one folder index when UIDVALIDITY changes', () => {
    const current = setup();
    current.audits.commitBatch({
      jobId: current.job.id, connectionId: current.connection.id, containerId: current.containerId,
      uidValidity: '7', completedThrough: 2, messages: [message(1), message(2)],
    });
    current.audits.commitBatch({
      jobId: current.job.id, connectionId: current.connection.id, containerId: current.containerId,
      uidValidity: '99', completedThrough: 1, messages: [message(1, { subject: 'Replacement' })],
    });
    const rows = current.profile.database.prepare('SELECT uid_validity, uid, subject FROM indexed_messages').all();
    expect(rows).toEqual([{ uid_validity: '99', uid: 1, subject: 'Replacement' }]);
    expect(current.audits.checkpoint(current.connection.id, current.containerId)).toEqual({ uidValidity: '99', lastUid: 1 });
    current.profile.database.close();
  });

  it('keeps metadata progress when an optional bounded body extraction fails', () => {
    const current = setup();
    current.audits.commitBatch({
      jobId: current.job.id, connectionId: current.connection.id, containerId: current.containerId,
      uidValidity: '7', completedThrough: 1,
      messages: [message(1, { bodyError: true })],
    });
    expect((current.profile.database.prepare('SELECT COUNT(*) AS count FROM indexed_messages').get() as { count: number }).count).toBe(1);
    expect((current.profile.database.prepare('SELECT category FROM proton_scan_failures').get() as { category: string }).category).toBe('body_extract_failed');
    current.profile.database.close();
  });

  it('does not surface an orphaned audit after the Proton connection is removed', () => {
    const current = setup();
    expect(current.audits.findLatestJobId(current.profile.profile.id)).toBe(current.job.id);
    current.connections.disconnect(current.connection.id);
    expect(current.audits.findLatestJobId(current.profile.profile.id)).toBeNull();
    current.profile.database.close();
  });

  it('isolates a folder failure and preserves successful folder progress', async () => {
    const current = setup();
    const discovery = new ProtonDiscoveryRepository(current.profile.database, current.profile.profile.id);
    discovery.replace(current.connection.id, {
      capabilities: ['IMAP4rev1'],
      mailboxes: [
        { path: 'Archive', name: 'Archive', delimiter: '/', specialUse: '\\Archive', flags: [], messageCount: 1, unreadCount: 0, uidValidity: '7', uidNext: 2 },
        { path: 'INBOX', name: 'Inbox', delimiter: '/', specialUse: '\\Inbox', flags: [], messageCount: 1, unreadCount: 1, uidValidity: '7', uidNext: 2 },
      ],
      addresses: [],
    });
    const job = current.jobs.createJob({
      profileId: current.profile.profile.id,
      kind: 'proton-audit',
      idempotencyKey: 'audit:folder-failure',
      itemKeys: ['Archive', 'INBOX'],
    });
    current.audits.registerRun(job.id, current.connection.id, false);
    const result = await new ProtonAuditRunner(
      current.jobs, current.audits, current.connections, () => new FolderFailureClient(1),
    ).run(job.id);
    expect(result.job.state).toBe('failed');
    expect(result.indexedMessages).toBe(1);
    expect(result.failureCount).toBe(1);
    expect(result.folders.map((folder) => [folder.path, folder.state])).toEqual([
      ['Archive', 'succeeded'],
      ['INBOX', 'failed'],
    ]);
    current.profile.database.close();
  });
});
