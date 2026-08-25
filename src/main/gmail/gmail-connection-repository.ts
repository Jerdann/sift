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

  credentials(): { connection: GmailConnectionSummary; refreshToken: string; clientSecret?: string } | null {
    const row = this.#row();
    if (!row) return null;
    const secret = JSON.parse(this.#vault.read(this.#profileId, row.secret_ref_id)) as GmailSecret;
    return { connection: this.#summary(row), refreshToken: secret.refreshToken, clientSecret: secret.clientSecret };
  }

  save(input: GmailOAuthInput, email: string, refreshToken: string): GmailConnectionSummary {
    const previous = this.#row();
    const secret = this.#vault.store(this.#profileId, 'gmail.oauth.refresh', JSON.stringify({ refreshToken, ...(input.clientSecret ? { clientSecret: input.clientSecret } : {}) }));
    const id = previous?.id ?? this.#createId();
    const now = this.#now();
    try {
      this.#database.prepare(`
        INSERT INTO gmail_connections(id, profile_id, email, client_id, secret_ref_id, state, connected_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'connected', ?, ?)
        ON CONFLICT(profile_id) DO UPDATE SET email=excluded.email, client_id=excluded.client_id,
          secret_ref_id=excluded.secret_ref_id, state='connected', connected_at=excluded.connected_at, updated_at=excluded.updated_at
      `).run(id, this.#profileId, email.toLowerCase(), input.clientId, secret.id, now, now);
    } catch (error) {
      this.#vault.delete(this.#profileId, secret.id);
      throw error;
    }
    if (previous) this.#vault.delete(this.#profileId, previous.secret_ref_id);
    return this.get()!;
  }

  disconnect(connectionId: string): void {
    const row = this.#row();
    if (!row || row.id !== connectionId) throw new Error('gmail_connection_not_found');
    this.#database.prepare('DELETE FROM gmail_connections WHERE id = ? AND profile_id = ?').run(connectionId, this.#profileId);
    this.#vault.delete(this.#profileId, row.secret_ref_id);
  }

  #row(): GmailRow | null {
    return (this.#database.prepare('SELECT * FROM gmail_connections WHERE profile_id = ?').get(this.#profileId) as GmailRow | undefined) ?? null;
  }

  #summary(row: GmailRow): GmailConnectionSummary {
    return gmailConnectionSummarySchema.parse({ id: row.id, email: row.email, clientId: row.client_id, connectedAt: row.connected_at, state: row.state });
  }
}
