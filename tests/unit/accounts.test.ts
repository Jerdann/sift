import BetterSqlite3 from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GmailConnectionRepository } from '../../src/main/gmail/gmail-connection-repository';
import { ProfileRepository } from '../../src/main/profiles/profile-repository';
import { ProtonConnectionRepository } from '../../src/main/proton/proton-connection-repository';
import { SafeStorageVault, type SafeStoragePort } from '../../src/main/secrets/safe-storage-vault';
import { applyMigrations } from '../../src/main/storage/migrations';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const storage: SafeStoragePort = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(value).reverse(),
  decryptString: (value) => Buffer.from(value).reverse().toString(),
};

describe('plural mailbox accounts', () => {
  it('migrates v13 parent tables without losing child relationships', () => {
    const database = new BetterSqlite3(':memory:');
    database.pragma('foreign_keys = ON');
    applyMigrations(database, () => '2026-08-25T12:00:00.000Z', 13);
    database.prepare(
      'INSERT INTO secret_refs(id,profile_id,purpose,created_at,updated_at) VALUES (?,?,?,?,?)',
    ).run('proton-secret', 'profile-one', 'proton.bridge.imap', 'now', 'now');
    database.prepare(
      'INSERT INTO secret_refs(id,profile_id,purpose,created_at,updated_at) VALUES (?,?,?,?,?)',
    ).run('gmail-secret', 'profile-one', 'gmail.oauth.refresh', 'now', 'now');
    database.prepare(`
      INSERT INTO provider_connections(
        id,profile_id,provider,host,port,username,security,secret_ref_id,state,
        last_connected_at,last_error_category,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run('proton-one', 'profile-one', 'proton', '127.0.0.1', 1143, 'bridge-one', 'starttls', 'proton-secret', 'connected', 'now', null, 'now', 'now');
    database.prepare(`
      INSERT INTO mail_containers(
        id,connection_id,profile_id,provider_container_id,display_name,delimiter,special_use,
        flags_json,message_count,unread_count,uid_validity,uid_next,observed_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run('inbox-one', 'proton-one', 'profile-one', 'INBOX', 'Inbox', '/', '\\Inbox', '[]', 1, 0, '1', 2, 'now');
    database.prepare(`
      INSERT INTO gmail_connections(id,profile_id,email,client_id,secret_ref_id,state,connected_at,updated_at)
      VALUES (?,?,?,?,?,'connected',?,?)
    `).run('gmail-one', 'profile-one', 'owner@example.test', 'client.apps.googleusercontent.com', 'gmail-secret', 'now', 'now');
    database.prepare(`
      INSERT INTO gmail_audit_state(connection_id,state,indexed_messages,total_estimate,updated_at)
      VALUES (?,'completed',1,1,?)
    `).run('gmail-one', 'now');

    applyMigrations(database, () => '2026-08-25T12:00:01.000Z');

    expect(database.prepare('SELECT connection_id FROM mail_containers').get()).toEqual({ connection_id: 'proton-one' });
    expect(database.prepare('SELECT connection_id FROM gmail_audit_state').get()).toEqual({ connection_id: 'gmail-one' });
    expect(database.prepare('SELECT provider,connection_id FROM account_selections ORDER BY provider').all()).toEqual([
      { provider: 'gmail', connection_id: 'gmail-one' },
      { provider: 'proton', connection_id: 'proton-one' },
    ]);
    expect(database.pragma('foreign_key_check')).toEqual([]);
    expect(database.pragma('foreign_keys', { simple: true })).toBe(1);
    database.close();
  });

  it('selects and disconnects multiple Gmail and Proton accounts independently', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sift-accounts-'));
    roots.push(root);
    const profileId = '0bf869b1-e77f-49d1-8381-2f327b94b7aa';
    const profile = new ProfileRepository(root, { createId: () => profileId }).createProfile('Multiple accounts');
    const vault = new SafeStorageVault(root, profile.database, storage);
    const gmailIds = [
      'c1829b96-f7a7-4304-867a-5fe1d95deafa',
      '91c978a5-8124-499e-8858-5eb37c7329bf',
    ];
    const gmail = new GmailConnectionRepository(profile.database, vault, profileId, {
      createId: () => gmailIds.shift()!,
      now: () => '2026-08-25T12:00:00.000Z',
    });
    const firstGmail = gmail.save({ clientId: 'first-client.apps.googleusercontent.com' }, 'first@example.test', 'first-refresh');
    const secondGmail = gmail.save({ clientId: 'second-client.apps.googleusercontent.com' }, 'second@example.test', 'second-refresh');
    expect(gmail.list().map((item) => item.email).sort()).toEqual(['first@example.test', 'second@example.test']);
    expect(gmail.get()?.id).toBe(secondGmail.id);
    expect(gmail.select(firstGmail.id).id).toBe(firstGmail.id);
    expect(gmail.credentials(secondGmail.id)?.refreshToken).toBe('second-refresh');

    const protonIds = [
      '4d8b05a5-0c27-49d7-9230-a1374ba1be1e',
      '8eaf961d-03f3-491f-9757-30694f9c0224',
    ];
    const proton = new ProtonConnectionRepository(profile.database, vault, profileId, {
      createId: () => protonIds.shift()!,
      now: () => '2026-08-25T12:00:00.000Z',
    });
    const firstProton = proton.save({ host: '127.0.0.1', port: 1143, username: 'bridge-one', password: 'first-password', security: 'starttls' });
    const secondProton = proton.save({ host: '127.0.0.1', port: 1143, username: 'bridge-two', password: 'second-password', security: 'starttls' });
    expect(proton.list().map((item) => item.username).sort()).toEqual(['bridge-one', 'bridge-two']);
    expect(proton.get()?.id).toBe(secondProton.id);
    expect(proton.select(firstProton.id).id).toBe(firstProton.id);
    expect(proton.getCredentials(secondProton.id)?.password).toBe('second-password');

    gmail.disconnect(firstGmail.id);
    expect(gmail.get()?.id).toBe(secondGmail.id);
    expect(gmail.credentials()?.refreshToken).toBe('second-refresh');
    expect(proton.get()?.id).toBe(firstProton.id);
    proton.disconnect(firstProton.id);
    expect(proton.get()?.id).toBe(secondProton.id);
    expect(proton.getCredentials()?.password).toBe('second-password');
    expect((profile.database.prepare('SELECT COUNT(*) AS count FROM secret_refs').get() as { count: number }).count).toBe(2);
    profile.database.close();
  });
});
