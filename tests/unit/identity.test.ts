import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GmailConnectionRepository } from '../../src/main/gmail/gmail-connection-repository';
import { GmailIdentityService } from '../../src/main/gmail/gmail-identity-service';
import { AccountIdentityRepository } from '../../src/main/identity/account-identity-repository';
import { extractOwnedIdentityEvidence } from '../../src/main/identity/ownership-evidence';
import { ProfileRepository } from '../../src/main/profiles/profile-repository';
import { SafeStorageVault, type SafeStoragePort } from '../../src/main/secrets/safe-storage-vault';

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const storage: SafeStoragePort = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(value).reverse(),
  decryptString: (value) => Buffer.from(value).reverse().toString(),
};

describe('owned mailbox identities', () => {
  it('accepts only provider, Sent From, and direct delivery evidence', () => {
    const evidence = extractOwnedIdentityEvidence({
      primaryAddresses: ['Primary@Example.Test'],
      providerAliases: ['provider-alias@example.test'],
      messages: [
        {
          sent: true,
          senders: ['sent-alias@example.test'],
          headers: {
            to: 'recipient@example.test',
            cc: 'group-member@example.test',
            bcc: 'hidden@example.test',
            'reply-to': 'reply@example.test',
          },
          receivedAt: '2026-08-24T12:00:00.000Z',
        },
        {
          sent: false,
          senders: ['external-sender@example.test'],
          headers: {
            to: 'mailing-list@example.test, primary@example.test',
            cc: 'coworker@example.test',
            bcc: 'unknown@example.test',
            'reply-to': 'support@example.test',
            'delivered-to': 'direct-alias@example.test',
            'x-original-to': 'original-alias@example.test',
          },
          receivedAt: '2026-08-25T12:00:00.000Z',
        },
        {
          sent: false,
          senders: ['outside@example.test'],
          headers: { 'delivered-to': 'relay@forward.protonmail.ch' },
          receivedAt: '2026-08-25T13:00:00.000Z',
        },
      ],
    });

    expect(evidence.map((identity) => identity.address)).toEqual([
      'direct-alias@example.test',
      'original-alias@example.test',
      'primary@example.test',
      'provider-alias@example.test',
      'sent-alias@example.test',
    ]);
    expect(evidence.find((identity) => identity.address === 'sent-alias@example.test')).toMatchObject({
      evidence: ['sent_from'], sentFromCount: 1, deliveredToCount: 0, providerEvidence: false,
    });
    expect(evidence.find((identity) => identity.address === 'direct-alias@example.test')).toMatchObject({
      evidence: ['delivered_to'], sentFromCount: 0, deliveredToCount: 1,
    });
    expect(evidence.flatMap((identity) => identity.evidence)).not.toContain('to');
  });

  it('merges evidence while preserving explicit review and container decisions', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sift-identities-'));
    roots.push(root);
    const profileId = '3fab15c7-49c6-4ce0-82a5-44a715dd7fe1';
    const profile = new ProfileRepository(root, { createId: () => profileId }).createProfile('Identity owner');
    const vault = new SafeStorageVault(root, profile.database, storage);
    const connections = new GmailConnectionRepository(profile.database, vault, profileId, {
      createId: () => '7e2d8e6c-2611-466e-9980-c71b7d6e34df',
      now: () => '2026-08-25T12:00:00.000Z',
    });
    const connection = connections.save(
      { clientId: 'synthetic-client.apps.googleusercontent.com' },
      'primary@example.test',
      'encrypted-refresh-value',
    );
    const identities = new AccountIdentityRepository(profile.database, profileId, {
      createId: () => crypto.randomUUID(),
      now: () => '2026-08-25T12:00:00.000Z',
    });
    identities.sync('gmail', connection.id, [
      {
        address: 'primary@example.test', evidence: ['provider_primary'], sentFromCount: 0,
        deliveredToCount: 0, providerEvidence: true, lastSeenAt: null,
      },
      {
        address: 'joint@example.test', evidence: ['delivered_to'], sentFromCount: 0,
        deliveredToCount: 2, providerEvidence: false, lastSeenAt: '2026-08-24T12:00:00.000Z',
      },
    ]);
    identities.update({
      provider: 'gmail', connectionId: connection.id, address: 'joint@example.test',
      status: 'confirmed', containerEnabled: true, containerName: 'Home & joint',
    });
    identities.sync('gmail', connection.id, [
      {
        address: 'joint@example.test', evidence: ['provider_alias', 'sent_from', 'delivered_to'],
        sentFromCount: 3, deliveredToCount: 4, providerEvidence: true,
        lastSeenAt: '2026-08-25T12:00:00.000Z',
      },
    ]);
    expect(identities.list('gmail', connection.id).find((item) => item.address === 'joint@example.test')).toMatchObject({
      status: 'confirmed', containerEnabled: true, containerName: 'Home & joint',
      sentFromCount: 3, deliveredToCount: 4, providerEvidence: true,
    });

    identities.update({
      provider: 'gmail', connectionId: connection.id, address: 'joint@example.test',
      status: 'rejected', containerEnabled: false, containerName: null,
    });
    identities.sync('gmail', connection.id, [{
      address: 'joint@example.test', evidence: ['provider_alias'], sentFromCount: 0,
      deliveredToCount: 0, providerEvidence: true, lastSeenAt: null,
    }]);
    expect(identities.list('gmail', connection.id).find((item) => item.address === 'joint@example.test')).toMatchObject({
      status: 'rejected', containerEnabled: false, containerName: null,
    });
    expect(() => identities.update({
      provider: 'gmail', connectionId: connection.id, address: 'primary@example.test',
      status: 'confirmed', containerEnabled: true, containerName: 'Unsafe/Path',
    })).toThrow();
    profile.database.close();
  });

  it('imports Gmail send-as aliases as provider evidence without trusting message participants', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sift-gmail-identities-'));
    roots.push(root);
    const profileId = '476391e2-cb04-49be-a658-93f636685469';
    const profile = new ProfileRepository(root, { createId: () => profileId }).createProfile('Gmail identities');
    const vault = new SafeStorageVault(root, profile.database, storage);
    const connections = new GmailConnectionRepository(profile.database, vault, profileId, {
      createId: () => 'ff8b6e3e-8e88-4f40-a1f2-d7f4de05514f',
    });
    const connection = connections.save(
      { clientId: 'synthetic-client.apps.googleusercontent.com' },
      'primary@example.test',
      'refresh-value',
    );
    const fetchPort = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'access-token', expires_in: 3600, token_type: 'Bearer' }), { status: 200 });
      }
      return new Response(JSON.stringify({
        sendAs: [
          { sendAsEmail: 'primary@example.test' },
          { sendAsEmail: 'joint@example.test' },
        ],
      }), { status: 200 });
    });

    const result = await new GmailIdentityService(
      profile.database,
      connections,
      profileId,
      fetchPort as typeof fetch,
    ).refresh(connection.id);
    expect(result.map((identity) => [identity.address, identity.status, identity.providerEvidence])).toEqual([
      ['joint@example.test', 'confirmed', true],
      ['primary@example.test', 'confirmed', true],
    ]);
    expect(fetchPort.mock.calls.at(-1)?.[0]).toBe('https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs');
    profile.database.close();
  });
});
