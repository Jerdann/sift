import type BetterSqlite3 from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { GmailConnectionSummary, GmailOAuthInput } from '../../shared/contracts/gmail';
import { gmailConnectionSummarySchema } from '../../shared/contracts/gmail';
import type { SecretVault } from '../secrets/secret-vault';

interface GmailRow {
  id: string;
  profile_id: string;
  email: string;
  client_id: string;
  secret_ref_id: string;
  state: 'connected' | 'attention';
  connected_at: string;
  updated_at: string;
}

interface GmailSecret {
  refreshToken: string;
  clientSecret?: string;
}

export class GmailConnectionRepository {
  readonly #database: BetterSqlite3.Database;
  readonly #vault: SecretVault;
  readonly #profileId: string;
  readonly #now: () => string;
  readonly #createId: () => string;

  constructor(database: BetterSqlite3.Database, vault: SecretVault, profileId: string, options: { now?: () => string; createId?: () => string } = {}) {
    this.#database = database;
    this.#vault = vault;
    this.#profileId = profileId;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#createId = options.createId ?? randomUUID;
  }

  get(): GmailConnectionSummary | null {
    const row = this.#row();
    return row ? this.#summary(row) : null;
  }

  list(): GmailConnectionSummary[] {
    return (this.#database.prepare(
      'SELECT * FROM gmail_connections WHERE profile_id = ? ORDER BY updated_at DESC, email',
    ).all(this.#profileId) as GmailRow[]).map((row) => this.#summary(row));
  }

  getById(connectionId: string): GmailConnectionSummary | null {
    const row = this.#row(connectionId);
    return row ? this.#summary(row) : null;
  }

  credentials(connectionId?: string): { connection: GmailConnectionSummary; refreshToken: string; clientSecret?: string } | null {
    const row = this.#row(connectionId);
    if (!row) return null;
    const secret = JSON.parse(this.#vault.read(this.#profileId, row.secret_ref_id)) as GmailSecret;
    return { connection: this.#summary(row), refreshToken: secret.refreshToken, clientSecret: secret.clientSecret };
  }

  save(input: GmailOAuthInput, email: string, refreshToken: string): GmailConnectionSummary {
    const normalizedEmail = email.toLowerCase();
    const previous = this.#rowByEmail(normalizedEmail);
    const secret = this.#vault.store(this.#profileId, 'gmail.oauth.refresh', JSON.stringify({ refreshToken, ...(input.clientSecret ? { clientSecret: input.clientSecret } : {}) }));
    const id = previous?.id ?? this.#createId();
    const now = this.#now();
    try {
      this.#database.prepare(`
        INSERT INTO gmail_connections(id, profile_id, email, client_id, secret_ref_id, state, connected_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'connected', ?, ?)
        ON CONFLICT(profile_id, email) DO UPDATE SET client_id=excluded.client_id,
          secret_ref_id=excluded.secret_ref_id, state='connected', connected_at=excluded.connected_at, updated_at=excluded.updated_at
      `).run(id, this.#profileId, normalizedEmail, input.clientId, secret.id, now, now);
    } catch (error) {
      this.#vault.delete(this.#profileId, secret.id);
      throw error;
    }
    if (previous) this.#vault.delete(this.#profileId, previous.secret_ref_id);
    this.select(id);
    return this.getById(id)!;
  }

  select(connectionId: string): GmailConnectionSummary {
    const row = this.#row(connectionId);
    if (!row) throw new Error('gmail_connection_not_found');
    this.#database.prepare(`
      INSERT INTO account_selections(profile_id, provider, connection_id, updated_at)
      VALUES (?, 'gmail', ?, ?)
      ON CONFLICT(profile_id, provider) DO UPDATE SET
        connection_id=excluded.connection_id, updated_at=excluded.updated_at
    `).run(this.#profileId, connectionId, this.#now());
    return this.#summary(row);
  }

  disconnect(connectionId: string): void {
    const row = this.#row(connectionId);
    if (!row) throw new Error('gmail_connection_not_found');
    this.#database.prepare('DELETE FROM gmail_connections WHERE id = ? AND profile_id = ?').run(connectionId, this.#profileId);
    this.#vault.delete(this.#profileId, row.secret_ref_id);
    const selected = this.#database.prepare(
      "SELECT connection_id FROM account_selections WHERE profile_id = ? AND provider = 'gmail'",
    ).get(this.#profileId) as { connection_id: string } | undefined;
    if (selected?.connection_id !== connectionId) return;
    const fallback = this.#database.prepare(
      'SELECT id FROM gmail_connections WHERE profile_id = ? ORDER BY updated_at DESC, email LIMIT 1',
    ).get(this.#profileId) as { id: string } | undefined;
    if (fallback) this.select(fallback.id);
    else this.#database.prepare(
      "DELETE FROM account_selections WHERE profile_id = ? AND provider = 'gmail'",
    ).run(this.#profileId);
  }

  #row(connectionId?: string): GmailRow | null {
    if (connectionId) {
      return (this.#database.prepare(
        'SELECT * FROM gmail_connections WHERE id = ? AND profile_id = ?',
      ).get(connectionId, this.#profileId) as GmailRow | undefined) ?? null;
    }
    return (this.#database.prepare(`
      SELECT gmail_connections.* FROM gmail_connections
      LEFT JOIN account_selections ON account_selections.profile_id = gmail_connections.profile_id
        AND account_selections.provider = 'gmail'
        AND account_selections.connection_id = gmail_connections.id
      WHERE gmail_connections.profile_id = ?
      ORDER BY CASE WHEN account_selections.connection_id IS NULL THEN 1 ELSE 0 END,
        gmail_connections.updated_at DESC, gmail_connections.email
      LIMIT 1
    `).get(this.#profileId) as GmailRow | undefined) ?? null;
  }

  #rowByEmail(email: string): GmailRow | null {
    return (this.#database.prepare(
      'SELECT * FROM gmail_connections WHERE profile_id = ? AND email = ?',
    ).get(this.#profileId, email) as GmailRow | undefined) ?? null;
  }

  #summary(row: GmailRow): GmailConnectionSummary {
    return gmailConnectionSummarySchema.parse({ id: row.id, email: row.email, clientId: row.client_id, connectedAt: row.connected_at, state: row.state });
  }
}
