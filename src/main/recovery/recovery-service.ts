import BetterSqlite3 from "better-sqlite3";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { z } from "zod";
import {
  diagnosticsSummarySchema,
  rebuildIndexResultSchema,
  restoreResultSchema,
  type DiagnosticsSummary,
  type RebuildIndexResult,
  type RestoreResult,
} from "../../shared/contracts/recovery";
import type { ProfileContext } from "../profiles/profile-repository";
import type { ProfileSession } from "../profiles/profile-session";
import type { SafeStoragePort } from "../secrets/safe-storage-vault";

const MAX_BACKUP_BYTES = 1024 * 1024 * 1024;
const SECRET_FILE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.bin$/i;

const backupSecretSchema = z.object({
  name: z.string().regex(SECRET_FILE_PATTERN),
  data: z.string().min(1),
  checksum: z.string().regex(/^[0-9a-f]{64}$/),
});

const backupPayloadSchema = z.object({
  format: z.literal("sift-profile"),
  version: z.literal(1),
  profileId: z.uuid(),
  createdAt: z.iso.datetime(),
  appVersion: z.string().min(1).max(40),
  database: z.string().min(1),
  databaseChecksum: z.string().regex(/^[0-9a-f]{64}$/),
  secrets: z.array(backupSecretSchema).max(10_000),
});

const backupEnvelopeSchema = z.object({
  format: z.literal("sift-encrypted-backup"),
  version: z.literal(1),
  protectedKey: z.string().min(1),
  iv: z.string().min(1),
  tag: z.string().min(1),
  ciphertext: z.string().min(1),
  checksum: z.string().regex(/^[0-9a-f]{64}$/),
});

type BackupPayload = z.infer<typeof backupPayloadSchema>;

const sha256 = (value: Buffer): string =>
  createHash("sha256").update(value).digest("hex");

const scalar = (
  database: BetterSqlite3.Database,
  sql: string,
  parameters: readonly unknown[] = [],
  key = "count",
): number =>
  Number(
    (
      database.prepare(sql).get(...parameters) as
        | Record<string, unknown>
        | undefined
    )?.[key] ?? 0,
  );

export const diagnostics = (
  context: ProfileContext,
  safeStorage: SafeStoragePort,
  appVersion: string,
  now = () => new Date().toISOString(),
): DiagnosticsSummary => {
  const jobRows = context.database
    .prepare(
      "SELECT state, COUNT(*) count FROM jobs WHERE profile_id = ? GROUP BY state",
    )
    .all(context.profile.id) as Array<{ state: string; count: number }>;
  const jobs = new Map(jobRows.map((row) => [row.state, row.count]));
  const integrityRows = context.database.pragma("integrity_check") as Array<{
    integrity_check: string;
  }>;
  const providerCount = (table: string): number =>
    scalar(
      context.database,
      `SELECT COUNT(*) count FROM ${table} WHERE profile_id = ?`,
      [context.profile.id],
    );

  return diagnosticsSummarySchema.parse({
    generatedAt: now(),
    appVersion,
    platform: process.platform,
    arch: process.arch,
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
    schemaVersion: scalar(
      context.database,
      "SELECT COALESCE(MAX(version), 0) value FROM schema_migrations",
      [],
      "value",
    ),
    integrity: integrityRows.every((row) => row.integrity_check === "ok")
      ? "ok"
      : "failed",
    foreignKeyViolations: (
      context.database.pragma("foreign_key_check") as unknown[]
    ).length,
    databaseBytes: statSync(context.databasePath).size,
    providers: {
      proton: providerCount("provider_connections"),
      gmail: providerCount("gmail_connections"),
      outlook: providerCount("outlook_connections"),
    },
    indexedMessages: {
      proton: scalar(
        context.database,
        "SELECT COUNT(*) count FROM indexed_messages",
      ),
      gmail: scalar(
        context.database,
        "SELECT COUNT(*) count FROM gmail_indexed_messages",
      ),
      outlook: scalar(
        context.database,
        "SELECT COUNT(*) count FROM outlook_indexed_messages",
      ),
    },
    jobs: {
      pending: jobs.get("pending") ?? 0,
      running: jobs.get("running") ?? 0,
      succeeded: jobs.get("succeeded") ?? 0,
      failed: jobs.get("failed") ?? 0,
      verificationMismatch: jobs.get("verification_mismatch") ?? 0,
    },
  });
};

export const writeEncryptedBackup = async (
  context: ProfileContext,
  safeStorage: SafeStoragePort,
  appVersion: string,
  destination: string,
  now = () => new Date().toISOString(),
): Promise<{ createdAt: string; bytes: number }> => {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("secret_storage_unavailable");
  }

  const temporaryRoot = path.join(tmpdir(), `sift-backup-${randomUUID()}`);
  mkdirSync(temporaryRoot, { recursive: true });
  try {
    const snapshotPath = path.join(temporaryRoot, "profile.sqlite3");
    await context.database.backup(snapshotPath);
    const database = readFileSync(snapshotPath);
    const secretDirectory = path.join(context.profileDirectory, "secrets");
    const secrets = existsSync(secretDirectory)
      ? readdirSync(secretDirectory, { withFileTypes: true })
          .filter(
            (entry) => entry.isFile() && SECRET_FILE_PATTERN.test(entry.name),
          )
          .map((entry) => {
            const data = readFileSync(path.join(secretDirectory, entry.name));
            return {
              name: entry.name,
              data: data.toString("base64"),
              checksum: sha256(data),
            };
          })
      : [];
    const createdAt = now();
    const payload: BackupPayload = {
      format: "sift-profile",
      version: 1,
      profileId: context.profile.id,
      createdAt,
      appVersion,
      database: database.toString("base64"),
      databaseChecksum: sha256(database),
      secrets,
    };
    const compressed = gzipSync(Buffer.from(JSON.stringify(payload)), {
      level: 9,
    });
    const key = randomBytes(32);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(compressed),
      cipher.final(),
    ]);
    const envelope = backupEnvelopeSchema.parse({
      format: "sift-encrypted-backup",
      version: 1,
      protectedKey: safeStorage
        .encryptString(key.toString("base64"))
        .toString("base64"),
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
      checksum: sha256(compressed),
    });
    const temporary = `${destination}.${randomUUID()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(envelope)}\n`, { flag: "wx" });
    if (existsSync(destination)) rmSync(destination);
    renameSync(temporary, destination);
    return { createdAt, bytes: statSync(destination).size };
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
};

const readBackupPayload = (
  source: string,
  safeStorage: SafeStoragePort,
): BackupPayload => {
  if (statSync(source).size > MAX_BACKUP_BYTES) {
    throw new Error("backup_too_large");
  }
  const envelope = backupEnvelopeSchema.parse(
    JSON.parse(readFileSync(source, "utf8")),
  );
  const key = Buffer.from(
    safeStorage.decryptString(Buffer.from(envelope.protectedKey, "base64")),
    "base64",
  );
  const iv = Buffer.from(envelope.iv, "base64");
  const tag = Buffer.from(envelope.tag, "base64");
  if (key.length !== 32 || iv.length !== 12 || tag.length !== 16) {
    throw new Error("backup_encryption_metadata_invalid");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const compressed = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]);
  if (sha256(compressed) !== envelope.checksum) {
    throw new Error("backup_checksum_invalid");
  }
  return backupPayloadSchema.parse(
    JSON.parse(
      gunzipSync(compressed, { maxOutputLength: MAX_BACKUP_BYTES }).toString(
        "utf8",
      ),
    ),
  );
};

const validateStagedDatabase = (
  stagedDatabase: string,
  current: ProfileContext,
  expectedSecretFiles: ReadonlySet<string>,
): void => {
  const validation = new BetterSqlite3(stagedDatabase, { readonly: true });
  try {
    const integrity = validation.pragma("integrity_check") as Array<{
      integrity_check: string;
    }>;
    if (!integrity.every((row) => row.integrity_check === "ok")) {
      throw new Error("backup_database_invalid");
    }
    if ((validation.pragma("foreign_key_check") as unknown[]).length) {
      throw new Error("backup_database_foreign_keys_invalid");
    }
    const backupVersion = scalar(
      validation,
      "SELECT COALESCE(MAX(version), 0) value FROM schema_migrations",
      [],
      "value",
    );
    const supportedVersion = scalar(
      current.database,
      "SELECT COALESCE(MAX(version), 0) value FROM schema_migrations",
      [],
      "value",
    );
    if (backupVersion > supportedVersion) {
      throw new Error("backup_requires_newer_sift");
    }
    const profileTables = [
      "secret_refs",
      "provider_connections",
      "gmail_connections",
      "outlook_connections",
      "jobs",
    ];
    for (const table of profileTables) {
      const foreignProfiles = scalar(
        validation,
        `SELECT COUNT(*) count FROM ${table} WHERE profile_id <> ?`,
        [current.profile.id],
      );
      if (foreignProfiles) throw new Error("backup_profile_mismatch");
    }
    const referencedSecretFiles = new Set(
      (
        validation.prepare("SELECT id FROM secret_refs").all() as Array<{
          id: string;
        }>
      ).map((row) => `${row.id}.bin`),
    );
    if (
      referencedSecretFiles.size !== expectedSecretFiles.size ||
      [...referencedSecretFiles].some((name) => !expectedSecretFiles.has(name))
    ) {
      throw new Error("backup_secret_set_invalid");
    }
  } finally {
    validation.close();
  }
};

export const restoreEncryptedBackup = (
  profileSession: ProfileSession,
  safeStorage: SafeStoragePort,
  source: string,
  now = () => new Date().toISOString(),
): RestoreResult => {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("secret_storage_unavailable");
  }
  const context = profileSession.requireActiveContext();
  const payload = readBackupPayload(source, safeStorage);
  if (payload.profileId !== context.profile.id) {
    throw new Error("backup_profile_mismatch");
  }
  const database = Buffer.from(payload.database, "base64");
  if (database.length > MAX_BACKUP_BYTES) throw new Error("backup_too_large");
  if (sha256(database) !== payload.databaseChecksum) {
    throw new Error("backup_database_checksum_invalid");
  }
  const secretIds = new Set<string>();
  for (const secret of payload.secrets) {
    const data = Buffer.from(secret.data, "base64");
    if (sha256(data) !== secret.checksum || secretIds.has(secret.name)) {
      throw new Error("backup_secret_invalid");
    }
    secretIds.add(secret.name);
  }

  const parent = path.dirname(context.profileDirectory);
  const stage = path.join(parent, `restore-stage-${randomUUID()}`);
  const rollback = path.join(parent, `restore-rollback-${randomUUID()}`);
  mkdirSync(stage);
  mkdirSync(rollback);
  const stagedDatabase = path.join(stage, "mail-steward.sqlite3");
  const stagedSecrets = path.join(stage, "secrets");
  try {
    writeFileSync(stagedDatabase, database, { flag: "wx" });
    mkdirSync(stagedSecrets);
    for (const secret of payload.secrets) {
      writeFileSync(
        path.join(stagedSecrets, secret.name),
        Buffer.from(secret.data, "base64"),
        { flag: "wx" },
      );
    }
    validateStagedDatabase(stagedDatabase, context, secretIds);
  } catch (error) {
    rmSync(stage, { recursive: true, force: true });
    rmSync(rollback, { recursive: true, force: true });
    throw error;
  }

  const databasePath = context.databasePath;
  const secretsPath = path.join(context.profileDirectory, "secrets");
  const databaseFiles = [
    databasePath,
    `${databasePath}-wal`,
    `${databasePath}-shm`,
  ];
  profileSession.close();
  try {
    for (const file of databaseFiles) {
      if (existsSync(file)) {
        renameSync(file, path.join(rollback, path.basename(file)));
      }
    }
    if (existsSync(secretsPath)) {
      renameSync(secretsPath, path.join(rollback, "secrets"));
    }
    renameSync(stagedDatabase, databasePath);
    renameSync(stagedSecrets, secretsPath);
    profileSession.selectProfile(context.profile.id);
    rmSync(rollback, { recursive: true, force: true });
  } catch (error) {
    profileSession.close();
    if (existsSync(databasePath)) rmSync(databasePath);
    if (existsSync(secretsPath)) {
      rmSync(secretsPath, { recursive: true, force: true });
    }
    const oldDatabase = path.join(rollback, path.basename(databasePath));
    if (existsSync(oldDatabase)) renameSync(oldDatabase, databasePath);
    for (const suffix of ["-wal", "-shm"]) {
      const oldSidecar = path.join(
        rollback,
        `${path.basename(databasePath)}${suffix}`,
      );
      if (existsSync(oldSidecar))
        renameSync(oldSidecar, `${databasePath}${suffix}`);
    }
    const oldSecrets = path.join(rollback, "secrets");
    if (existsSync(oldSecrets)) renameSync(oldSecrets, secretsPath);
    profileSession.selectProfile(context.profile.id);
    throw error;
  } finally {
    rmSync(stage, { recursive: true, force: true });
    rmSync(rollback, { recursive: true, force: true });
  }

  return restoreResultSchema.parse({
    restoredAt: now(),
    databaseBytes: statSync(databasePath).size,
    secretFiles: payload.secrets.length,
  });
};

export const rebuildLocalIndex = (
  context: ProfileContext,
  now = () => new Date().toISOString(),
): RebuildIndexResult => {
  const clearedMessages = scalar(
    context.database,
    `SELECT
       (SELECT COUNT(*) FROM indexed_messages) +
       (SELECT COUNT(*) FROM gmail_indexed_messages) +
       (SELECT COUNT(*) FROM outlook_indexed_messages) count`,
  );
  const preservedConnections = scalar(
    context.database,
    `SELECT
       (SELECT COUNT(*) FROM provider_connections WHERE profile_id = ?) +
       (SELECT COUNT(*) FROM gmail_connections WHERE profile_id = ?) +
       (SELECT COUNT(*) FROM outlook_connections WHERE profile_id = ?) count`,
    [context.profile.id, context.profile.id, context.profile.id],
  );
  const preservedManagedRules = scalar(
    context.database,
    "SELECT COUNT(*) count FROM managed_rules WHERE profile_id = ? AND state = 'active'",
    [context.profile.id],
  );

  context.database.transaction(() => {
    context.database
      .prepare("DELETE FROM organization_proposals WHERE profile_id = ?")
      .run(context.profile.id);
    context.database
      .prepare("DELETE FROM rule_inventories WHERE profile_id = ?")
      .run(context.profile.id);
    context.database
      .prepare("DELETE FROM account_identities WHERE profile_id = ?")
      .run(context.profile.id);
    context.database.exec(`
      DELETE FROM mailbox_analyses;
      DELETE FROM gmail_mailbox_analyses;
      DELETE FROM outlook_mailbox_analyses;
      DELETE FROM indexed_messages;
      DELETE FROM gmail_indexed_messages;
      DELETE FROM outlook_indexed_messages;
      DELETE FROM proton_folder_checkpoints;
      DELETE FROM proton_scan_failures;
      DELETE FROM proton_audit_runs;
      DELETE FROM gmail_audit_state;
      DELETE FROM outlook_audit_state;
      DELETE FROM audit_events;
    `);
    context.database
      .prepare("DELETE FROM jobs WHERE profile_id = ?")
      .run(context.profile.id);
  })();
  context.database.exec("VACUUM");

  return rebuildIndexResultSchema.parse({
    rebuiltAt: now(),
    clearedMessages,
    preservedConnections,
    preservedManagedRules,
  });
};
