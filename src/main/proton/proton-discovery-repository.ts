import type BetterSqlite3 from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import {
  type ProtonAddressEvidence,
  type ProtonDiscoverySummary,
  type ProtonMailbox,
  protonDiscoverySummarySchema,
} from '../../shared/contracts/proton';

interface MailboxSnapshotInput extends Omit<ProtonMailbox, 'id'> {}

export interface ProtonDiscoverySnapshot {
  capabilities: readonly string[];
  mailboxes: readonly MailboxSnapshotInput[];
  addresses: readonly ProtonAddressEvidence[];
}

interface MailboxRow {
  id: string;
  provider_container_id: string;
  display_name: string;
  delimiter: string;
  special_use: string | null;
  flags_json: string;
  message_count: number;
  unread_count: number;
  uid_validity: string;
  uid_next: number;
}

interface AddressRow {
  normalized_address: string;
  occurrence_count: number;
  last_seen_at: string | null;
  sources_json: string;
}

export class ProtonDiscoveryRepository {
  readonly #database: BetterSqlite3.Database;
  readonly #profileId: string;
  readonly #now: () => string;
  readonly #createId: () => string;

  constructor(
    database: BetterSqlite3.Database,
    profileId: string,
    options: { now?: () => string; createId?: () => string } = {},
  ) {
    this.#database = database;
    this.#profileId = profileId;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#createId = options.createId ?? randomUUID;
  }

  replace(connectionId: string, snapshot: ProtonDiscoverySnapshot): ProtonDiscoverySummary {
    const observedAt = this.#now();
    this.#database.transaction(() => {
      this.#database.prepare('DELETE FROM proton_capabilities WHERE connection_id = ?').run(connectionId);
      this.#database.prepare('DELETE FROM mail_containers WHERE connection_id = ?').run(connectionId);
      this.#database.prepare('DELETE FROM receiving_addresses WHERE connection_id = ?').run(connectionId);

      const addCapability = this.#database.prepare(
        'INSERT INTO proton_capabilities(connection_id, capability, observed_at) VALUES (?, ?, ?)',
      );
      for (const capability of [...new Set(snapshot.capabilities)].sort()) {
        addCapability.run(connectionId, capability, observedAt);
      }

      const addMailbox = this.#database.prepare(`
        INSERT INTO mail_containers(
          id, connection_id, profile_id, provider_container_id, display_name,
          delimiter, special_use, flags_json, message_count, unread_count,
          uid_validity, uid_next, observed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const mailbox of snapshot.mailboxes) {
        addMailbox.run(
          this.#createId(), connectionId, this.#profileId, mailbox.path, mailbox.name,
          mailbox.delimiter, mailbox.specialUse, JSON.stringify(mailbox.flags),
          mailbox.messageCount, mailbox.unreadCount, mailbox.uidValidity, mailbox.uidNext,
          observedAt,
        );
      }

      const addAddress = this.#database.prepare(`
        INSERT INTO receiving_addresses(
          id, connection_id, profile_id, normalized_address, occurrence_count,
          last_seen_at, sources_json, observed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const evidence of snapshot.addresses) {
        addAddress.run(
          this.#createId(), connectionId, this.#profileId, evidence.address,
          evidence.occurrenceCount, evidence.lastSeenAt, JSON.stringify(evidence.sources), observedAt,
        );
      }
    })();
    return this.get(connectionId)!;
  }

  get(connectionId: string): ProtonDiscoverySummary | null {
    const observed = this.#database
      .prepare(`
        SELECT MAX(observed_at) AS observed_at FROM (
          SELECT observed_at FROM proton_capabilities WHERE connection_id = ?
          UNION ALL SELECT observed_at FROM mail_containers WHERE connection_id = ?
          UNION ALL SELECT observed_at FROM receiving_addresses WHERE connection_id = ?
        )
      `)
      .get(connectionId, connectionId, connectionId) as { observed_at: string | null };
    if (!observed.observed_at) return null;

    const capabilities = this.#database
      .prepare('SELECT capability FROM proton_capabilities WHERE connection_id = ? ORDER BY capability')
      .all(connectionId)
      .map((row) => (row as { capability: string }).capability);
    const mailboxes = (this.#database
      .prepare('SELECT * FROM mail_containers WHERE connection_id = ? ORDER BY display_name COLLATE NOCASE')
      .all(connectionId) as MailboxRow[])
      .map((row) => ({
        id: row.id,
        path: row.provider_container_id,
        name: row.display_name,
        delimiter: row.delimiter,
        specialUse: row.special_use,
        flags: JSON.parse(row.flags_json) as string[],
        messageCount: row.message_count,
        unreadCount: row.unread_count,
        uidValidity: row.uid_validity,
        uidNext: row.uid_next,
      }));
    const addresses = (this.#database
      .prepare(`
        SELECT * FROM receiving_addresses
        WHERE connection_id = ?
        ORDER BY occurrence_count DESC, normalized_address
      `)
      .all(connectionId) as AddressRow[])
      .map((row) => ({
        address: row.normalized_address,
        occurrenceCount: row.occurrence_count,
        lastSeenAt: row.last_seen_at,
        sources: JSON.parse(row.sources_json) as ProtonAddressEvidence['sources'],
      }));

    return protonDiscoverySummarySchema.parse({
      connectionId,
      discoveredAt: observed.observed_at,
      capabilities,
      mailboxes,
      addresses,
      totalMessageEstimate: mailboxes.reduce((total, mailbox) => total + mailbox.messageCount, 0),
    });
  }
}
