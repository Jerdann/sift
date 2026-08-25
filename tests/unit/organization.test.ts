import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GmailAnalysisService } from '../../src/main/gmail/gmail-analysis-service';
import { GmailConnectionRepository } from '../../src/main/gmail/gmail-connection-repository';
import { AccountIdentityRepository } from '../../src/main/identity/account-identity-repository';
import { OrganizationProposalRepository } from '../../src/main/organization/organization-proposal-repository';
import { ProfileRepository } from '../../src/main/profiles/profile-repository';
import { SafeStorageVault, type SafeStoragePort } from '../../src/main/secrets/safe-storage-vault';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const storage: SafeStoragePort = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(value).reverse(),
  decryptString: (value) => Buffer.from(value).reverse().toString(),
};

describe('per-address organization proposals', () => {
  it('separates categories for one domain and revisions every local correction', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sift-organization-')); roots.push(root);
    const profileId = '592ba97f-e105-44ce-9341-c9997e1ae9d1';
    const profile = new ProfileRepository(root, { createId: () => profileId }).createProfile('Proposal owner');
    const vault = new SafeStorageVault(root, profile.database, storage);
    const connections = new GmailConnectionRepository(profile.database, vault, profileId, {
      createId: () => '244a769c-11bd-42c4-99cc-65a6ce368f64',
      now: () => '2026-08-25T12:00:00.000Z',
    });
    const connection = connections.save({ clientId: 'synthetic-client.apps.googleusercontent.com' }, 'owner@example.test', 'refresh-value');
    const insert = profile.database.prepare(`INSERT INTO gmail_indexed_messages(
      id,connection_id,gmail_message_id,thread_id,received_at,subject,sender_json,recipients_json,
      headers_json,label_ids_json,size_bytes,indexed_at
    ) VALUES (?,?,?,?,?,?,?,?,?, '[]',100,'2026-08-25T12:00:00.000Z')`);
    const add = (id: string, date: string, subject: string, headers: Record<string, string>) => insert.run(
      id, connection.id, id, `thread-${id}`, date, subject, '["mail@service.example"]', '["owner@example.test"]',
      JSON.stringify({ 'delivered-to': 'owner@example.test', ...headers }),
    );
    add('72ea544e-8999-461d-8bde-287f03e1b2b1', '2026-08-25T10:00:00.000Z', 'New login security alert', {});
    add('ce34d6aa-811d-4a99-9e02-0cc95e404834', '2026-08-24T10:00:00.000Z', 'Receipt for your payment', {});
    add('afafc196-49af-4ec5-8d67-62aa05295662', '2025-04-01T10:00:00.000Z', '50% off today', { 'list-id': 'offers.service.example' });
    add('a8d9a12e-5804-4ac0-b12f-6a74e58b1a5d', '2024-04-01T10:00:00.000Z', 'Last chance sale', { 'list-id': 'offers.service.example' });

    new GmailAnalysisService(profile.database, profileId).analyze(connection);
    const identities = new AccountIdentityRepository(profile.database, profileId);
    identities.update({ provider: 'gmail', connectionId: connection.id, address: 'owner@example.test', status: 'confirmed', containerEnabled: true, containerName: 'Primary' });
    new GmailAnalysisService(profile.database, profileId).analyze(connection);

    let counter = 0;
    const proposals = new OrganizationProposalRepository(profile.database, profileId, {
      now: () => '2026-08-25T12:30:00.000Z',
      createId: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`,
    });
    const first = proposals.generate('gmail', connection.id);
    expect(first.items.map((item) => item.category)).toEqual(expect.arrayContaining(['security', 'transactions', 'promotions']));
    expect(first.items.every((item) => item.scopeAddress === 'owner@example.test')).toBe(true);
    expect(first.items.every((item) => item.targetPath.startsWith('Primary/'))).toBe(true);
    expect(first.items.find((item) => item.category === 'promotions')).toMatchObject({ messageCount: 2, latestAt: '2025-04-01T10:00:00.000Z' });
    expect(first.items.find((item) => item.category === 'promotions')?.samples).toHaveLength(2);

    const promotions = first.items.find((item) => item.category === 'promotions')!;
    const edited = proposals.edit({ proposalId: first.id, revision: first.revision, itemId: promotions.id, category: 'subscriptions', targetPath: 'Primary/Subscriptions/Offers', enabled: false });
    expect(edited.revision).not.toBe(first.revision);
    expect(edited.items.find((item) => item.id === promotions.id)).toMatchObject({ category: 'subscriptions', targetPath: 'Primary/Subscriptions/Offers', enabled: false });
    expect(() => proposals.edit({ proposalId: first.id, revision: first.revision, itemId: promotions.id, category: 'promotions', targetPath: 'Promotions', enabled: true })).toThrow('organization_proposal_changed');
    expect((profile.database.prepare('SELECT COUNT(*) count FROM organization_corrections').get() as { count: number }).count).toBe(1);

    const regenerated = proposals.generate('gmail', connection.id);
    expect(regenerated.revision).toBe(first.revision);
    expect(regenerated.id).not.toBe(first.id);
    profile.database.close();
  });
});
