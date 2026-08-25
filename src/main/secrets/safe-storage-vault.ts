import type BetterSqlite3 from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { profileIdSchema, resolveContainedPath, resolveProfileDirectory } from '../storage/database';
import {
  type SecretReference,
  type SecretVault,
  SecretStorageUnavailableError,
  secretReferenceSchema,
} from './secret-vault';

export interface SafeStoragePort {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export interface SafeStorageVaultOptions {
  now?: () => string;
  createId?: () => string;
}

const secretIdSchema = z.uuid();
const purposeSchema = z.string().trim().min(1).max(80);

export class SafeStorageVault implements SecretVault {
  readonly #root: string;
  readonly #database: BetterSqlite3.Database;
  readonly #safeStorage: SafeStoragePort;
  readonly #now: () => string;
  readonly #createId: () => string;

  constructor(
    root: string,
    database: BetterSqlite3.Database,
    safeStorage: SafeStoragePort,
    options: SafeStorageVaultOptions = {},
  ) {
    this.#root = root;
    this.#database = database;
    this.#safeStorage = safeStorage;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#createId = options.createId ?? randomUUID;
  }

  store(profileId: string, purpose: string, secret: string): SecretReference {
    if (!this.#safeStorage.isEncryptionAvailable()) {
      throw new SecretStorageUnavailableError();
    }

    const id = secretIdSchema.parse(this.#createId());
    const validatedProfileId = profileIdSchema.parse(profileId);
    const validatedPurpose = purposeSchema.parse(purpose);
    const timestamp = this.#now();
    const reference = secretReferenceSchema.parse({
      id,
      profileId: validatedProfileId,
      purpose: validatedPurpose,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const secretDirectory = resolveContainedPath(
      resolveProfileDirectory(this.#root, validatedProfileId),
      'secrets',
    );
    mkdirSync(secretDirectory, { recursive: true });
    const encryptedPath = resolveContainedPath(secretDirectory, `${id}.bin`);
    const encrypted = this.#safeStorage.encryptString(secret);

    writeFileSync(encryptedPath, encrypted, { flag: 'wx' });
    try {
      this.#database
        .prepare(
          `INSERT INTO secret_refs(id, profile_id, purpose, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(id, validatedProfileId, validatedPurpose, timestamp, timestamp);
    } catch (error) {
      unlinkSync(encryptedPath);
      throw error;
    }

    return reference;
  }

  read(profileId: string, referenceId: string): string {
    if (!this.#safeStorage.isEncryptionAvailable()) {
      throw new SecretStorageUnavailableError();
    }

    const validatedProfileId = profileIdSchema.parse(profileId);
    const id = secretIdSchema.parse(referenceId);
    const row = this.#database
      .prepare('SELECT id FROM secret_refs WHERE id = ? AND profile_id = ?')
      .get(id, validatedProfileId);
    if (!row) throw new Error('Secret reference was not found for this profile');

    const encryptedPath = resolveContainedPath(
      resolveProfileDirectory(this.#root, validatedProfileId),
      'secrets',
      `${id}.bin`,
    );
    return this.#safeStorage.decryptString(readFileSync(encryptedPath));
  }

  delete(profileId: string, referenceId: string): void {
    const validatedProfileId = profileIdSchema.parse(profileId);
    const id = secretIdSchema.parse(referenceId);
    const row = this.#database
      .prepare('SELECT id FROM secret_refs WHERE id = ? AND profile_id = ?')
      .get(id, validatedProfileId);
    if (!row) throw new Error('Secret reference was not found for this profile');

    const encryptedPath = resolveContainedPath(
      resolveProfileDirectory(this.#root, validatedProfileId),
      'secrets',
      `${id}.bin`,
    );
    if (existsSync(encryptedPath)) unlinkSync(encryptedPath);
    this.#database
      .prepare('DELETE FROM secret_refs WHERE id = ? AND profile_id = ?')
      .run(id, validatedProfileId);
  }
}
