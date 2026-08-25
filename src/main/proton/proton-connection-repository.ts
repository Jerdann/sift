import type BetterSqlite3 from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import {
  type BridgeCredentials,
  type BridgeDiagnosticCategory,
  type ProtonConnectionSummary,
  protonConnectionSummarySchema,
} from '../../shared/contracts/proton';
import type { SecretVault } from '../secrets/secret-vault';

interface ProtonConnectionRow {
  id: string;
  profile_id: string;
  host: BridgeCredentials['host'];
  port: number;
  username: string;
  security: BridgeCredentials['security'];
  secret_ref_id: string;
  state: 'connected' | 'attention';
  last_connected_at: string | null;
  last_error_category: BridgeDiagnosticCategory | null;
  updated_at: string;
}

export class ProtonConnectionRepository {
  readonly #database: BetterSqlite3.Database;
  readonly #vault: SecretVault;
  readonly #profileId: string;
  readonly #now: () => string;
  readonly #createId: () => string;

  constructor(
    database: BetterSqlite3.Database,
    vault: SecretVault,
    profileId: string,
    options: { now?: () => string; createId?: () => string } = {},
  ) {
    this.#database = database;
    this.#vault = vault;
    this.#profileId = profileId;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#createId = options.createId ?? randomUUID;
  }

  get(): ProtonConnectionSummary | null {
    const row = this.#getRow();
    return row ? this.#summary(row) : null;
  }

  list(): ProtonConnectionSummary[] {
    return (this.#database.prepare(`
      SELECT * FROM provider_connections
      WHERE profile_id = ? AND provider = 'proton'
      ORDER BY updated_at DESC, username
    `).all(this.#profileId) as ProtonConnectionRow[]).map((row) => this.#summary(row));
  }

  getById(connectionId: string): ProtonConnectionSummary | null {
    const row = this.#getRow(connectionId);
    return row ? this.#summary(row) : null;
  }

  getCredentials(connectionId?: string): BridgeCredentials | null {
    const row = this.#getRow(connectionId);
    if (!row) return null;
    return {
      host: row.host,
      port: row.port,
      username: row.username,
      password: this.#vault.read(this.#profileId, row.secret_ref_id),
      security: row.security,
    };
  }

  save(credentials: BridgeCredentials): ProtonConnectionSummary {
    const previous = this.#getRowByIdentity(credentials);
    const timestamp = this.#now();
    const secret = this.#vault.store(
      this.#profileId,
      'proton.bridge.imap',
      credentials.password,
    );
    const id = previous?.id ?? this.#createId();

    try {
      this.#database
        .prepare(
          `INSERT INTO provider_connections(
             id, profile_id, provider, host, port, username, security,
             secret_ref_id, state, last_connected_at, last_error_category,
             created_at, updated_at
           ) VALUES (?, ?, 'proton', ?, ?, ?, ?, ?, 'connected', ?, NULL, ?, ?)
           ON CONFLICT(profile_id, provider, host, port, username) DO UPDATE SET
             security = excluded.security,
             secret_ref_id = excluded.secret_ref_id,
             state = 'connected',
             last_connected_at = excluded.last_connected_at,
             last_error_category = NULL,
             updated_at = excluded.updated_at`,
        )
        .run(
          id,
          this.#profileId,
          credentials.host,
          credentials.port,
          credentials.username,
          credentials.security,
          secret.id,
          timestamp,
          timestamp,
          timestamp,
        );
    } catch (error) {
      this.#vault.delete(this.#profileId, secret.id);
      throw error;
    }

    if (previous) this.#vault.delete(this.#profileId, previous.secret_ref_id);
    this.select(id);
    return this.getById(id)!;
  }

  select(connectionId: string): ProtonConnectionSummary {
    const row = this.#getRow(connectionId);
    if (!row) throw new Error('Proton connection was not found');
    this.#database.prepare(`
      INSERT INTO account_selections(profile_id, provider, connection_id, updated_at)
      VALUES (?, 'proton', ?, ?)
      ON CONFLICT(profile_id, provider) DO UPDATE SET
        connection_id=excluded.connection_id, updated_at=excluded.updated_at
    `).run(this.#profileId, connectionId, this.#now());
    return this.#summary(row);
  }

  markAttention(category: BridgeDiagnosticCategory, connectionId?: string): void {
    const row = this.#getRow(connectionId);
    if (!row) return;
    this.#database
      .prepare(
        `UPDATE provider_connections
         SET state = 'attention', last_error_category = ?, updated_at = ?
         WHERE id = ? AND profile_id = ? AND provider = 'proton'`,
      )
      .run(category, this.#now(), row.id, this.#profileId);
  }

  disconnect(connectionId: string): void {
    const row = this.#getRow(connectionId);
    if (!row) throw new Error('Proton connection was not found');
    this.#database
      .prepare(
        "DELETE FROM provider_connections WHERE id = ? AND profile_id = ? AND provider = 'proton'",
      )
      .run(connectionId, this.#profileId);
    this.#vault.delete(this.#profileId, row.secret_ref_id);
    const selected = this.#database.prepare(
      "SELECT connection_id FROM account_selections WHERE profile_id = ? AND provider = 'proton'",
    ).get(this.#profileId) as { connection_id: string } | undefined;
    if (selected?.connection_id !== connectionId) return;
    const fallback = this.#database.prepare(`
      SELECT id FROM provider_connections
      WHERE profile_id = ? AND provider = 'proton'
      ORDER BY updated_at DESC, username LIMIT 1
    `).get(this.#profileId) as { id: string } | undefined;
    if (fallback) this.select(fallback.id);
    else this.#database.prepare(
      "DELETE FROM account_selections WHERE profile_id = ? AND provider = 'proton'",
    ).run(this.#profileId);
  }

  #getRow(connectionId?: string): ProtonConnectionRow | null {
    if (connectionId) {
      return (
        (this.#database.prepare(`
          SELECT * FROM provider_connections
          WHERE id = ? AND profile_id = ? AND provider = 'proton'
        `).get(connectionId, this.#profileId) as ProtonConnectionRow | undefined) ?? null
      );
    }
    return (
      (this.#database
        .prepare(
          `SELECT provider_connections.* FROM provider_connections
           LEFT JOIN account_selections ON account_selections.profile_id = provider_connections.profile_id
             AND account_selections.provider = 'proton'
             AND account_selections.connection_id = provider_connections.id
           WHERE provider_connections.profile_id = ? AND provider_connections.provider = 'proton'
           ORDER BY CASE WHEN account_selections.connection_id IS NULL THEN 1 ELSE 0 END,
             provider_connections.updated_at DESC, provider_connections.username
           LIMIT 1`,
        )
        .get(this.#profileId) as ProtonConnectionRow | undefined) ?? null
    );
  }

  #getRowByIdentity(credentials: BridgeCredentials): ProtonConnectionRow | null {
    return (
      (this.#database.prepare(`
        SELECT * FROM provider_connections
        WHERE profile_id = ? AND provider = 'proton' AND host = ? AND port = ? AND username = ?
      `).get(this.#profileId, credentials.host, credentials.port, credentials.username) as ProtonConnectionRow | undefined) ?? null
    );
  }

  #summary(row: ProtonConnectionRow): ProtonConnectionSummary {
    return protonConnectionSummarySchema.parse({
      id: row.id,
      host: row.host,
      port: row.port,
      username: row.username,
      security: row.security,
      state: row.state,
      lastConnectedAt: row.last_connected_at,
      lastErrorCategory: row.last_error_category,
    });
  }
}
