import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProfileRepository } from "../../src/main/profiles/profile-repository";
import { ProfileSession } from "../../src/main/profiles/profile-session";
import {
  diagnostics,
  rebuildLocalIndex,
  restoreEncryptedBackup,
  writeEncryptedBackup,
} from "../../src/main/recovery/recovery-service";
import {
  SafeStorageVault,
  type SafeStoragePort,
} from "../../src/main/secrets/safe-storage-vault";

const roots: string[] = [];
const makeRoot = () => {
  const root = mkdtempSync(path.join(tmpdir(), "sift-recovery-"));
  roots.push(root);
  return root;
};

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

const testStorage: SafeStoragePort = {
  isEncryptionAvailable: () => true,
  encryptString: (plainText) =>
    Buffer.from(`test-protected:${plainText}`, "utf8"),
  decryptString: (encrypted) =>
    encrypted.toString("utf8").replace(/^test-protected:/, ""),
};

const createSession = (root: string, profileId: string) => {
  const repository = new ProfileRepository(root, {
    createId: () => profileId,
    now: () => "2026-08-25T12:00:00.000Z",
  });
  const session = new ProfileSession(
    repository,
    (context) =>
      new SafeStorageVault(root, context.database, testStorage, {
        createId: () => "b2159935-393e-4ead-8499-369166ac3418",
        now: () => "2026-08-25T12:00:00.000Z",
      }),
  );
  session.createProfile("Recovery test");
  return session;
};

describe("local recovery", () => {
  it("produces content-free diagnostics", () => {
    const root = makeRoot();
    const session = createSession(root, "8b6d2a26-2528-46a0-834c-00693b7e08f5");
    const context = session.requireActiveContext();
    context.database
      .prepare(
        "INSERT INTO audit_events(id, event_type, safe_payload_json, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(
        "event",
        "privacy.canary",
        JSON.stringify({
          address: "private-person@example.test",
          subject: "private subject canary",
          path: root,
        }),
        "2026-08-25T12:00:00.000Z",
      );

    const report = diagnostics(context, testStorage, "1.0.0");
    const serialized = JSON.stringify(report);
    expect(report.integrity).toBe("ok");
    expect(report.foreignKeyViolations).toBe(0);
    expect(serialized).not.toContain("private-person");
    expect(serialized).not.toContain("private subject");
    expect(serialized).not.toContain(root);
    expect(serialized).not.toContain(context.profile.id);
    session.close();
  });

  it("encrypts, validates, restores, and detects tampering", async () => {
    const root = makeRoot();
    const session = createSession(root, "576857dd-50ee-4829-8147-b033707b3398");
    const context = session.requireActiveContext();
    const vault = session.requireSecretVault();
    const secret = "provider-token-privacy-canary";
    const secretRef = vault.store(context.profile.id, "test.provider", secret);
    context.database
      .prepare(
        "INSERT INTO audit_events(id, event_type, safe_payload_json, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(
        "before",
        "backup.canary",
        '{"state":"before-backup"}',
        "2026-08-25T12:00:00.000Z",
      );
    const backupPath = path.join(root, "profile.siftbackup");
    await writeEncryptedBackup(context, testStorage, "1.0.0", backupPath);

    const backupBytes = readFileSync(backupPath);
    expect(backupBytes.includes(Buffer.from(secret))).toBe(false);
    expect(backupBytes.includes(Buffer.from("before-backup"))).toBe(false);
    context.database
      .prepare("UPDATE audit_events SET safe_payload_json = ? WHERE id = ?")
      .run('{"state":"after-backup"}', "before");

    const restored = restoreEncryptedBackup(session, testStorage, backupPath);
    expect(restored.secretFiles).toBe(1);
    const restoredContext = session.requireActiveContext();
    expect(
      (
        restoredContext.database
          .prepare("SELECT safe_payload_json FROM audit_events WHERE id = ?")
          .get("before") as { safe_payload_json: string }
      ).safe_payload_json,
    ).toContain("before-backup");
    expect(
      session.requireSecretVault().read(context.profile.id, secretRef.id),
    ).toBe(secret);

    const envelope = JSON.parse(readFileSync(backupPath, "utf8")) as {
      ciphertext: string;
    };
    envelope.ciphertext = `${envelope.ciphertext.slice(0, -2)}AA`;
    const tamperedPath = path.join(root, "tampered.siftbackup");
    writeFileSync(tamperedPath, JSON.stringify(envelope));
    expect(() =>
      restoreEncryptedBackup(session, testStorage, tamperedPath),
    ).toThrow();
    session.close();
  });

  it("rebuilds derived data while preserving connections, rules, and the ledger", () => {
    const root = makeRoot();
    const session = createSession(root, "e25131af-f4f8-4595-ad9e-1a0c72aa406b");
    const context = session.requireActiveContext();
    const secretRef = session
      .requireSecretVault()
      .store(context.profile.id, "gmail.oauth", "oauth-token");
    const timestamp = "2026-08-25T12:00:00.000Z";
    context.database
      .prepare(
        `INSERT INTO gmail_connections(
           id, profile_id, email, client_id, secret_ref_id, state, connected_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 'connected', ?, ?)`,
      )
      .run(
        "gmail-connection",
        context.profile.id,
        "owner@example.test",
        "desktop-client",
        secretRef.id,
        timestamp,
        timestamp,
      );
    context.database
      .prepare(
        `INSERT INTO gmail_indexed_messages(
           id, connection_id, gmail_message_id, thread_id, received_at, subject,
           sender_json, recipients_json, headers_json, label_ids_json, size_bytes, indexed_at
         ) VALUES (?, ?, ?, ?, ?, ?, '[]', '[]', '{}', '[]', 42, ?)`,
      )
      .run(
        "message-row",
        "gmail-connection",
        "provider-message",
        "thread",
        timestamp,
        "private subject",
        timestamp,
      );
    context.database
      .prepare(
        `INSERT INTO managed_rules(
           id, profile_id, provider, connection_id, stable_key, provider_rule_id,
           fingerprint, desired_json, ownership, state, created_at, updated_at
         ) VALUES (?, ?, 'gmail', ?, ?, ?, ?, '{}', 'managed', 'active', ?, ?)`,
      )
      .run(
        "managed-rule",
        context.profile.id,
        "gmail-connection",
        "stable-rule",
        "provider-rule",
        "fingerprint",
        timestamp,
        timestamp,
      );
    context.database
      .prepare(
        `INSERT INTO unsubscribe_ledger(
           id, profile_id, provider, connection_id, list_id, receiving_address,
           requested_at, latest_seen_at_request, recurrence_count, updated_at
         ) VALUES (?, ?, 'gmail', ?, ?, ?, ?, NULL, 0, ?)`,
      )
      .run(
        "ledger-entry",
        context.profile.id,
        "gmail-connection",
        "list-id",
        "owner@example.test",
        timestamp,
        timestamp,
      );

    const result = rebuildLocalIndex(context);
    expect(result).toMatchObject({
      clearedMessages: 1,
      preservedConnections: 1,
      preservedManagedRules: 1,
    });
    expect(
      (
        context.database
          .prepare("SELECT COUNT(*) count FROM gmail_indexed_messages")
          .get() as { count: number }
      ).count,
    ).toBe(0);
    expect(
      (
        context.database
          .prepare("SELECT COUNT(*) count FROM gmail_connections")
          .get() as { count: number }
      ).count,
    ).toBe(1);
    expect(
      (
        context.database
          .prepare("SELECT COUNT(*) count FROM managed_rules")
          .get() as { count: number }
      ).count,
    ).toBe(1);
    expect(
      (
        context.database
          .prepare("SELECT COUNT(*) count FROM unsubscribe_ledger")
          .get() as { count: number }
      ).count,
    ).toBe(1);
    session.close();
  });
});
