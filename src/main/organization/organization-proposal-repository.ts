import type BetterSqlite3 from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { CATEGORY_PRESENTATION } from "../../core/classification/mail-classifier";
import type { AccountProvider } from "../../shared/contracts/accounts";
import type { MailCategory } from "../../shared/contracts/analysis";
import {
  type EditOrganizationProposal,
  type OrganizationProposal,
  editOrganizationProposalSchema,
  organizationProposalSchema,
} from "../../shared/contracts/organization";

interface SourceRow {
  analysis_id: string;
  category: MailCategory;
  confidence: number;
  evidence_json: string;
  receiving_addresses_json: string;
  subject: string | null;
  received_at: string | null;
}

interface Aggregate {
  scopeAddress: string | null;
  containerName: string | null;
  category: MailCategory;
  targetPath: string;
  messageCount: number;
  latestAt: string | null;
  confidenceTotal: number;
  evidence: Set<string>;
  samples: Set<string>;
}

const safeStrings = (value: string): string[] => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
};

const revisionFor = (
  items: Array<{
    sourceFingerprint: string;
    category: MailCategory;
    targetPath: string;
    enabled: boolean;
  }>,
): string =>
  createHash("sha256")
    .update(
      JSON.stringify(
        items
          .map((item) => [
            item.sourceFingerprint,
            item.category,
            item.targetPath,
            item.enabled,
          ])
          .sort((left, right) =>
            JSON.stringify(left).localeCompare(JSON.stringify(right)),
          ),
      ),
    )
    .digest("hex");

export class OrganizationProposalRepository {
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

  generate(
    provider: AccountProvider,
    connectionId: string,
  ): OrganizationProposal {
    this.#assertConnection(provider, connectionId);
    const rows = this.#sourceRows(provider, connectionId);
    if (!rows.length) throw new Error("mailbox_analysis_required");
    const identities = this.#database
      .prepare(
        `
      SELECT normalized_address,container_enabled,container_name FROM account_identities
      WHERE profile_id=? AND provider=? AND connection_id=? AND user_status='confirmed'
    `,
      )
      .all(this.#profileId, provider, connectionId) as Array<{
      normalized_address: string;
      container_enabled: number;
      container_name: string | null;
    }>;
    const owned = new Map(
      identities.map((identity) => [identity.normalized_address, identity]),
    );
    const aggregates = new Map<string, Aggregate>();
    for (const row of rows) {
      const matched = safeStrings(row.receiving_addresses_json).filter(
        (address) => owned.has(address),
      );
      const scopes: Array<string | null> = matched.length ? matched : [null];
      for (const address of scopes) {
        const identity = address ? owned.get(address) : undefined;
        const containerName = identity?.container_enabled
          ? identity.container_name
          : null;
        const key = `${address ?? ""}\0${row.category}`;
        const current = aggregates.get(key) ?? {
          scopeAddress: address,
          containerName,
          category: row.category,
          targetPath: containerName
            ? `${containerName}/${CATEGORY_PRESENTATION[row.category].folder}`
            : CATEGORY_PRESENTATION[row.category].folder,
          messageCount: 0,
          latestAt: null,
          confidenceTotal: 0,
          evidence: new Set<string>(),
          samples: new Set<string>(),
        };
        current.messageCount += 1;
        current.confidenceTotal += row.confidence;
        if (
          row.received_at &&
          (!current.latestAt || row.received_at > current.latestAt)
        )
          current.latestAt = row.received_at;
        for (const evidence of safeStrings(row.evidence_json))
          current.evidence.add(evidence);
        if (row.subject?.trim() && current.samples.size < 5)
          current.samples.add(row.subject.trim().slice(0, 240));
        aggregates.set(key, current);
      }
    }
    const items = [...aggregates.values()]
      .map((aggregate) => {
        const sourceFingerprint = createHash("sha256")
          .update(
            JSON.stringify([
              aggregate.scopeAddress,
              aggregate.category,
              aggregate.messageCount,
              aggregate.latestAt,
            ]),
          )
          .digest("hex");
        return {
          id: this.#createId(),
          ...aggregate,
          confidence: aggregate.confidenceTotal / aggregate.messageCount,
          evidence: [...aggregate.evidence].sort().slice(0, 12),
          samples: [...aggregate.samples],
          enabled: true,
          sourceCategory: aggregate.category,
          sourceFingerprint,
        };
      })
      .sort(
        (left, right) =>
          (left.scopeAddress ?? "").localeCompare(right.scopeAddress ?? "") ||
          right.messageCount - left.messageCount ||
          left.category.localeCompare(right.category),
      );
    const revision = revisionFor(items);
    const proposalId = this.#createId();
    const now = this.#now();
    this.#database.transaction(() => {
      this.#database
        .prepare(
          "UPDATE organization_proposals SET state='superseded',updated_at=? WHERE profile_id=? AND provider=? AND connection_id=? AND state='draft'",
        )
        .run(now, this.#profileId, provider, connectionId);
      this.#database
        .prepare(
          `INSERT INTO organization_proposals(id,profile_id,provider,connection_id,analysis_id,revision,state,created_at,updated_at) VALUES (?,?,?,?,?,?,'draft',?,?)`,
        )
        .run(
          proposalId,
          this.#profileId,
          provider,
          connectionId,
          rows[0]!.analysis_id,
          revision,
          now,
          now,
        );
      const insert = this.#database.prepare(
        `INSERT INTO organization_proposal_items(id,proposal_id,scope_address,container_name,category,target_path,enabled,message_count,latest_at,confidence,evidence_json,samples_json,source_fingerprint,updated_at,source_category) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      );
      for (const item of items)
        insert.run(
          item.id,
          proposalId,
          item.scopeAddress,
          item.containerName,
          item.category,
          item.targetPath,
          1,
          item.messageCount,
          item.latestAt,
          item.confidence,
          JSON.stringify(item.evidence),
          JSON.stringify(item.samples),
          item.sourceFingerprint,
          now,
          item.sourceCategory,
        );
    })();
    return this.get(provider, connectionId)!;
  }

  get(
    provider: AccountProvider,
    connectionId: string,
  ): OrganizationProposal | null {
    this.#assertConnection(provider, connectionId);
    const proposal = this.#database
      .prepare(
        `SELECT * FROM organization_proposals WHERE profile_id=? AND provider=? AND connection_id=? ORDER BY updated_at DESC,rowid DESC LIMIT 1`,
      )
      .get(this.#profileId, provider, connectionId) as
      | Record<string, unknown>
      | undefined;
    if (!proposal) return null;
    const items = this.#database
      .prepare(
        "SELECT * FROM organization_proposal_items WHERE proposal_id=? ORDER BY scope_address,message_count DESC,category",
      )
      .all(proposal.id) as Array<Record<string, unknown>>;
    return organizationProposalSchema.parse({
      id: proposal.id,
      provider: proposal.provider,
      connectionId: proposal.connection_id,
      revision: proposal.revision,
      state: proposal.state,
      createdAt: proposal.created_at,
      updatedAt: proposal.updated_at,
      items: items.map((item) => ({
        id: item.id,
        scopeAddress: item.scope_address,
        containerName: item.container_name,
        category: item.category,
        targetPath: item.target_path,
        enabled: Boolean(item.enabled),
        messageCount: item.message_count,
        latestAt: item.latest_at,
        confidence: item.confidence,
        evidence: safeStrings(String(item.evidence_json)),
        samples: safeStrings(String(item.samples_json)),
      })),
    });
  }

  edit(rawInput: EditOrganizationProposal): OrganizationProposal {
    const input = editOrganizationProposalSchema.parse(rawInput);
    const proposal = this.#database
      .prepare(
        "SELECT * FROM organization_proposals WHERE id=? AND profile_id=?",
      )
      .get(input.proposalId, this.#profileId) as
      | Record<string, unknown>
      | undefined;
    if (
      !proposal ||
      proposal.state !== "draft" ||
      proposal.revision !== input.revision
    )
      throw new Error("organization_proposal_changed");
    const item = this.#database
      .prepare(
        "SELECT * FROM organization_proposal_items WHERE id=? AND proposal_id=?",
      )
      .get(input.itemId, input.proposalId) as
      | Record<string, unknown>
      | undefined;
    if (!item) throw new Error("organization_proposal_item_not_found");
    const now = this.#now();
    this.#database.transaction(() => {
      this.#database
        .prepare(
          "UPDATE organization_proposal_items SET category=?,target_path=?,enabled=?,updated_at=? WHERE id=?",
        )
        .run(
          input.category,
          input.targetPath,
          input.enabled ? 1 : 0,
          now,
          input.itemId,
        );
      const revisionRows = this.#database
        .prepare(
          "SELECT source_fingerprint,category,target_path,enabled FROM organization_proposal_items WHERE proposal_id=?",
        )
        .all(input.proposalId) as Array<{
        source_fingerprint: string;
        category: MailCategory;
        target_path: string;
        enabled: number;
      }>;
      const nextRevision = revisionFor(
        revisionRows.map((row) => ({
          sourceFingerprint: row.source_fingerprint,
          category: row.category,
          targetPath: row.target_path,
          enabled: Boolean(row.enabled),
        })),
      );
      this.#database
        .prepare(
          "UPDATE organization_proposals SET revision=?,updated_at=? WHERE id=?",
        )
        .run(nextRevision, now, input.proposalId);
      this.#database
        .prepare(
          "INSERT INTO organization_corrections(id,proposal_id,item_id,prior_json,corrected_json,resulting_revision,created_at) VALUES (?,?,?,?,?,?,?)",
        )
        .run(
          this.#createId(),
          input.proposalId,
          input.itemId,
          JSON.stringify({
            category: item.category,
            targetPath: item.target_path,
            enabled: Boolean(item.enabled),
          }),
          JSON.stringify({
            category: input.category,
            targetPath: input.targetPath,
            enabled: input.enabled,
          }),
          nextRevision,
          now,
        );
    })();
    return this.get(
      proposal.provider as AccountProvider,
      String(proposal.connection_id),
    )!;
  }

  #sourceRows(provider: AccountProvider, connectionId: string): SourceRow[] {
    if (provider === "gmail")
      return this.#database
        .prepare(
          `SELECT gma.id analysis_id,gmc.category,gmc.confidence,gmc.evidence_json,gmc.receiving_addresses_json,gim.subject,gim.received_at FROM gmail_mailbox_analyses gma JOIN gmail_message_classifications gmc ON gmc.analysis_id=gma.id JOIN gmail_indexed_messages gim ON gim.id=gmc.message_row_id WHERE gma.profile_id=? AND gma.connection_id=?`,
        )
        .all(this.#profileId, connectionId) as SourceRow[];
    if (provider === "outlook")
      return this.#database
        .prepare(
          `SELECT oma.id analysis_id,omc.category,omc.confidence,omc.evidence_json,omc.receiving_addresses_json,oim.subject,oim.received_at FROM outlook_mailbox_analyses oma JOIN outlook_message_classifications omc ON omc.analysis_id=oma.id JOIN outlook_indexed_messages oim ON oim.id=omc.message_row_id WHERE oma.profile_id=? AND oma.connection_id=?`,
        )
        .all(this.#profileId, connectionId) as SourceRow[];
    return this.#database
      .prepare(
        `SELECT ma.id analysis_id,mc.category,mc.confidence,mc.evidence_json,mc.receiving_addresses_json,im.subject,im.received_at FROM mailbox_analyses ma JOIN message_classifications mc ON mc.analysis_id=ma.id JOIN indexed_messages im ON im.id=mc.message_row_id WHERE ma.profile_id=? AND ma.connection_id=?`,
      )
      .all(this.#profileId, connectionId) as SourceRow[];
  }

  #assertConnection(provider: AccountProvider, connectionId: string): void {
    const row =
      provider === "gmail"
        ? this.#database
            .prepare(
              "SELECT id FROM gmail_connections WHERE id=? AND profile_id=?",
            )
            .get(connectionId, this.#profileId)
        : provider === "outlook"
          ? this.#database
              .prepare(
                "SELECT id FROM outlook_connections WHERE id=? AND profile_id=?",
              )
              .get(connectionId, this.#profileId)
          : this.#database
              .prepare(
                "SELECT id FROM provider_connections WHERE id=? AND profile_id=? AND provider='proton'",
              )
              .get(connectionId, this.#profileId);
    if (!row) throw new Error("account_connection_not_found");
  }
}
