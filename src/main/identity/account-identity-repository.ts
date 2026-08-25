import type BetterSqlite3 from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import {
  type AccountIdentitySummary,
  type AccountIdentityUpdateInput,
  type AccountProvider,
  accountIdentitySummarySchema,
  accountIdentityUpdateInputSchema,
} from '../../shared/contracts/accounts';
import type { OwnedIdentityEvidence } from './ownership-evidence';

interface IdentityRow {
  id: string;
  provider: AccountProvider;
  connection_id: string;
  normalized_address: string;
  evidence_json: string;
  sent_from_count: number;
  delivered_to_count: number;
  provider_evidence: number;
  last_seen_at: string | null;
  user_status: AccountIdentitySummary['status'];
  container_enabled: number;
  container_name: string | null;
  updated_at: string;
}

export class AccountIdentityRepository {
  readonly #database: BetterSqlite3.Database;
  readonly #profileId: string;
  readonly #now: () => string;
  readonly #createId: () => string;

  constructor(database: BetterSqlite3.Database, profileId: string, options: { now?: () => string; createId?: () => string } = {}) {
    this.#database = database;
    this.#profileId = profileId;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#createId = options.createId ?? randomUUID;
  }

  sync(provider: AccountProvider, connectionId: string, evidence: readonly OwnedIdentityEvidence[]): AccountIdentitySummary[] {
    this.#assertConnection(provider, connectionId);
    const now = this.#now();
    const upsert = this.#database.prepare(`
      INSERT INTO account_identities(
        id,profile_id,provider,connection_id,normalized_address,evidence_json,
        sent_from_count,delivered_to_count,provider_evidence,last_seen_at,user_status,
        container_enabled,container_name,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,0,NULL,?,?)
      ON CONFLICT(connection_id,normalized_address) DO UPDATE SET
        evidence_json=excluded.evidence_json,
        sent_from_count=excluded.sent_from_count,
        delivered_to_count=excluded.delivered_to_count,
        provider_evidence=excluded.provider_evidence,
        last_seen_at=excluded.last_seen_at,
        user_status=CASE
          WHEN account_identities.user_status='unreviewed' AND excluded.provider_evidence=1 THEN 'confirmed'
          ELSE account_identities.user_status
        END,
        updated_at=excluded.updated_at
    `);
    this.#database.transaction(() => {
      for (const identity of evidence) {
        upsert.run(
          this.#createId(), this.#profileId, provider, connectionId, identity.address,
          JSON.stringify(identity.evidence), identity.sentFromCount, identity.deliveredToCount,
          identity.providerEvidence ? 1 : 0, identity.lastSeenAt,
          identity.providerEvidence ? 'confirmed' : 'unreviewed', now, now,
        );
      }
    })();
    return this.list(provider, connectionId);
  }

  list(provider: AccountProvider, connectionId: string): AccountIdentitySummary[] {
    this.#assertConnection(provider, connectionId);
    return (this.#database.prepare(`
      SELECT * FROM account_identities
      WHERE profile_id=? AND provider=? AND connection_id=?
      ORDER BY CASE user_status WHEN 'confirmed' THEN 0 WHEN 'unreviewed' THEN 1 ELSE 2 END,
        normalized_address
    `).all(this.#profileId, provider, connectionId) as IdentityRow[]).map((row) => this.#summary(row));
  }

  update(rawInput: AccountIdentityUpdateInput): AccountIdentitySummary {
    const input = accountIdentityUpdateInputSchema.parse(rawInput);
    this.#assertConnection(input.provider, input.connectionId);
    const address = input.address.toLowerCase();
    const row = this.#database.prepare(`
      SELECT id FROM account_identities
      WHERE profile_id=? AND provider=? AND connection_id=? AND normalized_address=?
    `).get(this.#profileId, input.provider, input.connectionId, address) as { id: string } | undefined;
    if (!row) throw new Error('account_identity_not_found');
    const containerEnabled = input.status === 'confirmed' && input.containerEnabled;
    this.#database.prepare(`
      UPDATE account_identities SET user_status=?,container_enabled=?,container_name=?,updated_at=?
      WHERE id=? AND profile_id=? AND provider=? AND connection_id=?
    `).run(
      input.status, containerEnabled ? 1 : 0,
      containerEnabled ? input.containerName : null, this.#now(), row.id,
      this.#profileId, input.provider, input.connectionId,
    );
    const updated = this.#database.prepare('SELECT * FROM account_identities WHERE id=?').get(row.id) as IdentityRow;
    return this.#summary(updated);
  }

  #assertConnection(provider: AccountProvider, connectionId: string): void {
    const table = provider === 'gmail' ? 'gmail_connections' : 'provider_connections';
    const providerClause = provider === 'proton' ? " AND provider='proton'" : '';
    const row = this.#database.prepare(
      `SELECT id FROM ${table} WHERE id=? AND profile_id=?${providerClause}`,
    ).get(connectionId, this.#profileId);
    if (!row) throw new Error('account_connection_not_found');
  }

  #summary(row: IdentityRow): AccountIdentitySummary {
    return accountIdentitySummarySchema.parse({
      id: row.id,
      provider: row.provider,
      connectionId: row.connection_id,
      address: row.normalized_address,
      evidence: JSON.parse(row.evidence_json),
      sentFromCount: row.sent_from_count,
      deliveredToCount: row.delivered_to_count,
      providerEvidence: Boolean(row.provider_evidence),
      lastSeenAt: row.last_seen_at,
      status: row.user_status,
      containerEnabled: Boolean(row.container_enabled),
      containerName: row.container_name,
      updatedAt: row.updated_at,
    });
  }
}
