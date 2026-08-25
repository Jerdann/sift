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

  getCredentials(): BridgeCredentials | null {
    const row = this.#getRow();
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
    const previous = this.#getRow();
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
           ON CONFLICT(profile_id, provider) DO UPDATE SET
             host = excluded.host,
             port = excluded.port,
             username = excluded.username,
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
    return this.get()!;
  }

  markAttention(category: BridgeDiagnosticCategory): void {
    this.#database
      .prepare(
        `UPDATE provider_connections
         SET state = 'attention', last_error_category = ?, updated_at = ?
         WHERE profile_id = ? AND provider = 'proton'`,
      )
      .run(category, this.#now(), this.#profileId);
  }

  disconnect(connectionId: string): void {
    const row = this.#getRow();
    if (!row || row.id !== connectionId) throw new Error('Proton connection was not found');
    this.#database
      .prepare(
        "DELETE FROM provider_connections WHERE id = ? AND profile_id = ? AND provider = 'proton'",
      )
      .run(connectionId, this.#profileId);
    this.#vault.delete(this.#profileId, row.secret_ref_id);
  }

  #getRow(): ProtonConnectionRow | null {
    return (
      (this.#database
        .prepare(
          "SELECT * FROM provider_connections WHERE profile_id = ? AND provider = 'proton'",
        )
        .get(this.#profileId) as ProtonConnectionRow | undefined) ?? null
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
