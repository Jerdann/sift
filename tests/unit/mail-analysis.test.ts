import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { classifyMessage } from '../../src/core/classification/mail-classifier';
import { buildPortableRulePack, renderProtonSieve } from '../../src/core/rules/rule-pack';
import { analyzeMailbox } from '../../src/main/analysis/mailbox-analysis-service';
import { AccountIdentityRepository } from '../../src/main/identity/account-identity-repository';
import { ProfileRepository } from '../../src/main/profiles/profile-repository';
import { ProtonConnectionRepository } from '../../src/main/proton/proton-connection-repository';
import { ProtonDiscoveryRepository } from '../../src/main/proton/proton-discovery-repository';
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

describe('local mailbox analysis', () => {
  it.each([
    ['Your verification code is 123456', {}, 'security'],
    ['Receipt for your payment', {}, 'transactions'],
    ['Your package is out for delivery', {}, 'shopping'],
    ['50% off — shop now', { 'list-id': 'store.example' }, 'promotions'],
    ['Weekly engineering digest', { 'list-id': 'news.example' }, 'subscriptions'],
    ['Claim your crypto giveaway', { 'authentication-results': 'dkim=fail; dmarc=fail' }, 'spam'],
  ] as const)('classifies %s as %s', (subject, headers, category) => {
    expect(classifyMessage({
      subject,
      bodyText: null,
      senders: ['sender@example.com'],
      recipients: ['owner@pm.test'],
      headers,
    }).category).toBe(category);
  });

  it('deduplicates folder copies and builds category, stream, and address-service proposals', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'mail-steward-analysis-'));
    roots.push(root);
    const profileId = 'b9161481-f663-4384-b840-df2cc5d125ad';
    const profile = new ProfileRepository(root, { createId: () => profileId }).createProfile('Analysis owner');
    const vault = new SafeStorageVault(root, profile.database, storage);
    const connection = new ProtonConnectionRepository(profile.database, vault, profileId).save({
      host: '127.0.0.1', port: 1143, username: 'bridge', password: 'generated', security: 'starttls',
    });
    const discovery = new ProtonDiscoveryRepository(profile.database, profileId).replace(connection.id, {
      capabilities: ['IMAP4rev1'],
      mailboxes: [
        { path: 'INBOX', name: 'Inbox', delimiter: '/', specialUse: '\\Inbox', flags: [], messageCount: 3, unreadCount: 3, uidValidity: '1', uidNext: 4 },
        { path: 'All Mail', name: 'All Mail', delimiter: '/', specialUse: '\\All', flags: [], messageCount: 1, unreadCount: 1, uidValidity: '2', uidNext: 2 },
        { path: 'Sent', name: 'Sent', delimiter: '/', specialUse: '\\Sent', flags: [], messageCount: 1, unreadCount: 0, uidValidity: '3', uidNext: 2 },
      ],
      addresses: [
        { address: 'owner@pm.test', occurrenceCount: 3, lastSeenAt: '2026-08-24T12:00:00.000Z', sources: ['delivered-to'] },
        { address: 'home@pm.test', occurrenceCount: 1, lastSeenAt: '2026-08-24T12:30:00.000Z', sources: ['delivered-to'] },
        { address: 'coworker@company.test', occurrenceCount: 1, lastSeenAt: '2026-08-24T13:00:00.000Z', sources: ['to'] },
      ],
    });
    const insert = profile.database.prepare(`
      INSERT INTO indexed_messages(
        id, connection_id, container_id, uid_validity, uid, message_id, received_at,
        subject, sender_json, recipients_json, headers_json, flags_json, size_bytes,
        body_text, body_truncated, indexed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 100, NULL, 0, '2026-08-24T12:00:00.000Z')
    `);
    const inbox = discovery.mailboxes.find((mailbox) => mailbox.path === 'INBOX')!;
    const all = discovery.mailboxes.find((mailbox) => mailbox.path === 'All Mail')!;
    const sent = discovery.mailboxes.find((mailbox) => mailbox.path === 'Sent')!;
    insert.run('fa2570e3-bdef-4d41-8931-301ba7185801', connection.id, inbox.id, '1', 1, '<receipt@example>', '2026-08-24T10:00:00.000Z', 'Receipt for your payment', '["billing@store.example"]', '["owner@pm.test"]', '{"delivered-to":"owner@pm.test"}');
    insert.run('69410e65-1112-4d92-af72-10c19039db5e', connection.id, all.id, '2', 1, '<receipt@example>', '2026-08-24T10:00:00.000Z', 'Receipt for your payment', '["billing@store.example"]', '["owner@pm.test"]', '{"delivered-to":"owner@pm.test"}');
    insert.run('87fddcf8-b182-4f41-92e4-88007126b2bb', connection.id, inbox.id, '1', 2, '<security@example>', '2026-08-24T11:00:00.000Z', 'New login security alert', '["security@service.example"]', '["owner@pm.test"]', '{"delivered-to":"owner@pm.test"}');
    insert.run('a6efc99d-5558-4512-b370-a7ebde40c3b5', connection.id, inbox.id, '1', 3, '<promo@example>', '2026-08-24T12:00:00.000Z', '50% off today', '["offers@store.example"]', '["owner@pm.test"]', '{"delivered-to":"owner@pm.test","list-id":"store.example"}');
    insert.run('6a2f4af1-c2c9-4525-9710-712d5ea9bd5e', connection.id, inbox.id, '1', 4, '<home@example>', '2026-08-24T12:30:00.000Z', 'Neighborhood update', '["news@community.example"]', '["home@pm.test"]', '{"delivered-to":"home@pm.test","x-original-to":"home=pm.test+partner=mail.test@forward.protonmail.ch"}');
    insert.run('f7aa8027-636f-4a7c-91d4-9e206028f8fd', connection.id, sent.id, '3', 1, '<outbound@example>', '2026-08-24T13:00:00.000Z', 'Project question', '["owner@pm.test"]', '["coworker@company.test"]', '{}');

    const unreviewed = analyzeMailbox(profile.database, profileId, connection.id);
    expect(unreviewed.addresses).toEqual([]);
    const identities = new AccountIdentityRepository(profile.database, profileId);
    expect(identities.list('proton', connection.id).map((identity) => identity.address)).toEqual([
      'home@pm.test',
      'owner@pm.test',
    ]);
    for (const identity of identities.list('proton', connection.id)) {
      identities.update({
        provider: 'proton', connectionId: connection.id, address: identity.address,
        status: 'confirmed', containerEnabled: identity.address === 'home@pm.test',
        containerName: identity.address === 'home@pm.test' ? 'Home' : null,
      });
    }
    const result = analyzeMailbox(profile.database, profileId, connection.id);
    expect(result.uniqueMessages).toBe(4);
    expect(result.categories.map((item) => [item.category, item.messageCount])).toEqual(expect.arrayContaining([
      ['transactions', 1], ['security', 1], ['promotions', 1],
    ]));
    expect(result.addresses.map((address) => address.address)).toEqual(['owner@pm.test', 'home@pm.test']);
    expect(result.topStreams.every((stream) => ['owner@pm.test', 'home@pm.test'].includes(stream.receivingAddress))).toBe(true);
    expect(result.addresses[0]).toMatchObject({ address: 'owner@pm.test', recommendation: 'retain', importantCount: 2 });
    expect(result.addresses[0]).toMatchObject({ ownershipEvidence: 'sent_and_received', canRetire: true });
    expect(result.addresses[1]).toMatchObject({ address: 'home@pm.test', ownershipEvidence: 'received', canRetire: false });
    expect(result.addresses[1]).toMatchObject({ containerEnabled: true, containerName: 'Home' });
    expect(result.addresses[0]!.services.map((service) => service.domain)).toEqual(expect.arrayContaining(['store.example', 'service.example']));
    const pack = buildPortableRulePack(result);
    expect(pack.rules.map((rule) => [rule.senderDomain, rule.targetFolder])).toEqual([
      ['service.example', 'Important/Security'],
    ]);
    expect(pack.skippedAmbiguousStreams).toBe(2);
    const sieve = renderProtonSieve(pack);
    expect(sieve).toContain('address :domain :is "from" "service.example"');
    expect(sieve).toContain('fileinto "Important/Security";');
    expect(sieve).not.toContain('# security · 1 observed · 94% confidence\nif allof (address :domain :is "from" "service.example", address :is ["delivered-to", "x-original-to"] "owner@pm.test") {\n  addflag');
    profile.database.close();
  });
});
