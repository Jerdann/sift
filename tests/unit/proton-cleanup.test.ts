import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { analyzeMailbox } from '../../src/main/analysis/mailbox-analysis-service';
import { AccountIdentityRepository } from '../../src/main/identity/account-identity-repository';
import { CleanupPlanRepository } from '../../src/main/cleanup/cleanup-plan-repository';
import { CleanupRunner } from '../../src/main/cleanup/cleanup-runner';
import { JobRepository } from '../../src/main/jobs/job-repository';
import { ProfileRepository } from '../../src/main/profiles/profile-repository';
import { ProtonConnectionRepository } from '../../src/main/proton/proton-connection-repository';
import { ProtonDiscoveryRepository } from '../../src/main/proton/proton-discovery-repository';
import type { ProtonMutationClientPort } from '../../src/main/proton/proton-mutation-client';
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

class FakeMutationClient implements ProtonMutationClientPort {
  readonly prepared: Array<[string, boolean, boolean]> = [];
  readonly applied: Array<[string, number, string]> = [];
  closed = false;
  constructor(private readonly validity = '1') {}
  async connect() {}
  async close() { this.closed = true; }
  async prepareTarget(path: string, spam: boolean, trash = false) {
    this.prepared.push([path, spam, trash]);
    return spam ? 'Proton Spam' : trash ? 'Proton Trash' : path;
  }
  async inspect(_path: string, _uid: number) { return { uidValidity: this.validity, flags: ['\\Flagged'] }; }
  async apply(path: string, uid: number, target: string) {
    this.applied.push([path, uid, target]);
    return true;
  }
}

const setup = () => {
  const root = mkdtempSync(path.join(tmpdir(), 'mail-steward-cleanup-'));
  roots.push(root);
  const profileId = '350313ef-491d-4cdf-963b-18b6e95476a3';
  const profile = new ProfileRepository(root, { createId: () => profileId }).createProfile('Cleanup owner');
  const vault = new SafeStorageVault(root, profile.database, storage);
  const connections = new ProtonConnectionRepository(profile.database, vault, profileId);
  const connection = connections.save({ host: '127.0.0.1', port: 1143, username: 'bridge', password: 'generated', security: 'starttls' });
  const discovery = new ProtonDiscoveryRepository(profile.database, profileId).replace(connection.id, {
    capabilities: ['IMAP4rev1'],
    mailboxes: [{ path: 'INBOX', name: 'Inbox', delimiter: '/', specialUse: '\\Inbox', flags: [], messageCount: 3, unreadCount: 3, uidValidity: '1', uidNext: 4 }],
    addresses: [{ address: 'owner@pm.test', occurrenceCount: 3, lastSeenAt: '2026-08-24T12:00:00.000Z', sources: ['delivered-to'] }],
  });
  const inbox = discovery.mailboxes[0]!;
  const insert = profile.database.prepare(`
    INSERT INTO indexed_messages(
      id, connection_id, container_id, uid_validity, uid, message_id, received_at,
      subject, sender_json, recipients_json, headers_json, flags_json, size_bytes,
      body_text, body_truncated, indexed_at
    ) VALUES (?, ?, ?, '1', ?, ?, '2026-08-24T12:00:00.000Z', ?, ?, '["owner@pm.test"]', ?, '[]', 100, NULL, 0, '2026-08-24T12:00:00.000Z')
  `);
  insert.run('7f7b1044-94b4-42c5-91c7-a0518d3d0231', connection.id, inbox.id, 1, '<security>', 'New login security alert', '["security@service.example"]', '{"delivered-to":"owner@pm.test"}');
  insert.run('56b19752-78dd-4640-b395-d724d1f81a65', connection.id, inbox.id, 2, '<promo>', '50% off today', '["offers@store.example"]', '{"delivered-to":"owner@pm.test","list-id":"store.example"}');
  insert.run('8b6cedd6-41d0-4bb4-9182-2fa44ecb03d2', connection.id, inbox.id, 3, '<spam>', 'Claim your crypto giveaway', '["scam@bad.example"]', '{"delivered-to":"owner@pm.test","authentication-results":"dkim=fail; dmarc=fail"}');
  analyzeMailbox(profile.database, profileId, connection.id);
  new AccountIdentityRepository(profile.database, profileId).update({
    provider: 'proton', connectionId: connection.id, address: 'owner@pm.test',
    status: 'confirmed', containerEnabled: true, containerName: 'Primary',
  });
  analyzeMailbox(profile.database, profileId, connection.id);
  const jobs = new JobRepository(profile.database);
  const plans = new CleanupPlanRepository(profile.database, jobs, profileId);
  return { profile, connections, connection, jobs, plans };
};

describe('approved Proton cleanup', () => {
  it('previews exact impact, rejects stale approval, then applies only approved actions', async () => {
    const current = setup();
    const plan = current.plans.generate(current.connection.id, { kind: 'organize', containers: { 'owner@pm.test': 'Primary' }, trashSenderDomains: [] });
    expect(plan).toMatchObject({ state: 'draft', actionCount: 3, spamCount: 1, skippedCount: 0 });
    expect(() => current.plans.approve(plan.id, 'stale-revision')).toThrow('cleanup_plan_changed');
    const approved = current.plans.approve(plan.id, plan.revision);
    expect(approved.job?.kind).toBe('proton-cleanup');

    const client = new FakeMutationClient();
    const result = await new CleanupRunner(current.jobs, current.plans, current.connections, () => client).run(approved.job!.id);
    expect(result.plan.state).toBe('completed');
    expect(result.profileId).toBe(current.profile.profile.id);
    expect(result.plan.job?.state).toBe('succeeded');
    expect(client.applied).toHaveLength(3);
    expect(client.applied.some(([, , target]) => target === 'Proton Spam')).toBe(true);
    expect(client.applied.some(([, , target]) => target === 'Primary/Important/Security')).toBe(true);
    expect(client.applied.some(([, , target]) => target === 'Primary/Promotions')).toBe(true);
    expect((current.profile.database.prepare("SELECT COUNT(*) AS count FROM cleanup_actions WHERE prior_flags_json = '[\"\\\\Flagged\"]' AND state = 'succeeded'").get() as { count: number }).count).toBe(3);
    expect(client.closed).toBe(true);
    current.profile.database.close();
  });

  it('refuses a changed source UIDVALIDITY without mutating provider state', async () => {
    const current = setup();
    const plan = current.plans.generate(current.connection.id, { kind: 'organize', containers: {}, trashSenderDomains: [] });
    const approved = current.plans.approve(plan.id, plan.revision);
    const client = new FakeMutationClient('999');
    const result = await new CleanupRunner(current.jobs, current.plans, current.connections, () => client).run(approved.job!.id);
    expect(result.plan.job?.state).toBe('verification_mismatch');
    expect(client.applied).toHaveLength(0);
    current.profile.database.close();
  });

  it('builds a separate protected sender-domain plan that moves only non-critical history to native Trash', async () => {
    const current = setup();
    const plan = current.plans.generate(current.connection.id, {
      kind: 'trash',
      containers: {},
      trashSenderDomains: ['store.example', 'service.example'],
    });
    expect(plan).toMatchObject({ kind: 'trash', actionCount: 1, trashCount: 1, spamCount: 0 });
    const approved = current.plans.approve(plan.id, plan.revision);
    const client = new FakeMutationClient();
    const result = await new CleanupRunner(current.jobs, current.plans, current.connections, () => client).run(approved.job!.id);
    expect(result.plan.state).toBe('completed');
    expect(client.prepared).toContainEqual(['Trash', false, true]);
    expect(client.applied).toContainEqual(['INBOX', 2, 'Proton Trash']);
    expect(client.applied.some(([, uid]) => uid === 1)).toBe(false);
    current.profile.database.close();
  });
});
