import type BetterSqlite3 from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import type { MailCategory } from "../../shared/contracts/analysis";
import type { GmailOrganizationPlan } from "../../shared/contracts/gmail-organize";
import { gmailOrganizationPlanSchema } from "../../shared/contracts/gmail-organize";
import type { OutlookConnectionSummary } from "../../shared/contracts/outlook";
import type { JobRepository } from "../jobs/job-repository";

interface Item {
  id: string;
  scope_address: string | null;
  source_category: MailCategory;
  category: MailCategory;
  target_path: string;
  enabled: number;
  confidence: number;
}
interface Message {
  graph_message_id: string;
  sender_domain: string;
  received_at: string | null;
  source_category: MailCategory;
  confidence: number;
  receiving_addresses_json: string;
  parent_folder_id: string;
  is_read: number;
}
export interface OutlookHistoryAction {
  id: string;
  planId: string;
  connectionId: string;
  graphMessageId: string;
  priorFolderId: string;
  priorIsRead: boolean;
  targetFolder: string;
  markRead: boolean;
  spam: boolean;
  trash: boolean;
  resultingFolderId: string | null;
  resultingIsRead: boolean | null;
}
const strings = (value: string): string[] => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
};

export class OutlookHistoryRepository {
  readonly #database: BetterSqlite3.Database;
  readonly #jobs: JobRepository;
  readonly #profileId: string;
  readonly #now: () => string;
  readonly #createId: () => string;
  constructor(
    database: BetterSqlite3.Database,
    jobs: JobRepository,
    profileId: string,
    options: { now?: () => string; createId?: () => string } = {},
  ) {
    this.#database = database;
    this.#jobs = jobs;
    this.#profileId = profileId;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#createId = options.createId ?? randomUUID;
  }

  generate(
    connection: OutlookConnectionSummary,
    input: {
      kind?: "organize" | "trash";
      senderDomains?: readonly string[];
      olderThanDays?: number;
    } = {},
  ): GmailOrganizationPlan {
    const kind = input.kind ?? "organize";
    const proposal =
      kind === "organize"
        ? (this.#database
            .prepare(
              "SELECT * FROM organization_proposals WHERE profile_id=? AND provider='outlook' AND connection_id=? AND state='draft' ORDER BY updated_at DESC,rowid DESC LIMIT 1",
            )
            .get(this.#profileId, connection.id) as
            | Record<string, unknown>
            | undefined)
        : undefined;
    if (kind === "organize" && !proposal)
      throw new Error("organization_proposal_required");
    const analysis =
      proposal ??
      (this.#database
        .prepare(
          "SELECT id analysis_id FROM outlook_mailbox_analyses WHERE profile_id=? AND connection_id=?",
        )
        .get(this.#profileId, connection.id) as
        | Record<string, unknown>
        | undefined);
    if (!analysis) throw new Error("outlook_analysis_required");
    const items = proposal
      ? (this.#database
          .prepare(
            "SELECT * FROM organization_proposal_items WHERE proposal_id=? ORDER BY scope_address,source_category",
          )
          .all(proposal.id) as Item[])
      : [];
    const bySource = new Map<string, Item[]>();
    for (const item of items)
      bySource.set(item.source_category, [
        ...(bySource.get(item.source_category) ?? []),
        item,
      ]);
    const messages = this.#database
      .prepare(
        `SELECT oim.graph_message_id,omc.sender_domain,oim.received_at,omc.category source_category,omc.confidence,omc.receiving_addresses_json,oim.parent_folder_id,oim.is_read FROM outlook_message_classifications omc JOIN outlook_indexed_messages oim ON oim.id=omc.message_row_id WHERE omc.analysis_id=? ORDER BY oim.graph_message_id`,
      )
      .all(analysis.analysis_id) as Message[];
    const domains = new Set(
      (input.senderDomains ?? []).map((value) => value.toLowerCase()),
    );
    const cutoff =
      Date.parse(this.#now()) - (input.olderThanDays ?? 180) * 86_400_000;
    const protectedCategories = new Set<MailCategory>([
      "security",
      "accounts",
      "transactions",
      "finance",
      "personal",
      "suspicious",
    ]);
    const selected = new Map<string, { item: Item; message: Message }>();
    let skipped = 0;
    for (const message of messages) {
      const addresses = new Set(
        strings(message.receiving_addresses_json).map((value) =>
          value.toLowerCase(),
        ),
      );
      const candidates = (bySource.get(message.source_category) ?? [])
        .filter(
          (item) =>
            !item.scope_address ||
            addresses.has(item.scope_address.toLowerCase()),
        )
        .sort(
          (left, right) =>
            Number(Boolean(right.scope_address)) -
            Number(Boolean(left.scope_address)),
        );
      const item =
        kind === "trash"
          ? domains.has(message.sender_domain.toLowerCase()) &&
            !protectedCategories.has(message.source_category) &&
            Boolean(message.received_at) &&
            Date.parse(message.received_at!) < cutoff
            ? {
                id: `trash:${message.sender_domain}:${message.source_category}`,
                scope_address: [...addresses][0] ?? null,
                source_category: message.source_category,
                category: message.source_category,
                target_path: "TRASH",
                enabled: 1,
                confidence: message.confidence,
              }
            : undefined
          : candidates[0];
      if (
        !item ||
        !item.enabled ||
        message.confidence < 0.7 ||
        (kind === "organize" &&
          ["other", "personal", "suspicious"].includes(item.category))
      ) {
        skipped += 1;
        continue;
      }
      if (selected.has(message.graph_message_id)) {
        skipped += 1;
        continue;
      }
      selected.set(message.graph_message_id, { item, message });
    }
    const groups = new Map<string, { item: Item; messages: Message[] }>();
    for (const value of selected.values()) {
      const group = groups.get(value.item.id) ?? {
        item: value.item,
        messages: [],
      };
      group.messages.push(value.message);
      groups.set(value.item.id, group);
    }
    const normalized = [...groups.values()].sort((left, right) =>
      left.item.id.localeCompare(right.item.id),
    );
    const revision = createHash("sha256")
      .update(
        JSON.stringify({
          kind,
          proposal: proposal?.revision ?? null,
          selected: normalized.map((group) => [
            group.item.id,
            group.item.category,
            group.item.target_path,
            group.messages.map((message) => [
              message.graph_message_id,
              message.parent_folder_id,
              message.is_read,
            ]),
          ]),
        }),
      )
      .digest("hex");
    const planId = this.#createId();
    const now = this.#now();
    this.#database.transaction(() => {
      this.#database
        .prepare(
          "DELETE FROM outlook_history_plans WHERE connection_id=? AND plan_kind=?",
        )
        .run(connection.id, kind);
      this.#database
        .prepare(
          "INSERT INTO outlook_history_plans(id,connection_id,analysis_id,proposal_id,proposal_revision,plan_kind,revision,state,skipped_ambiguous_streams,created_at) VALUES (?,?,?,?,?,?,?,'draft',?,?)",
        )
        .run(
          planId,
          connection.id,
          analysis.analysis_id,
          proposal?.id ?? null,
          proposal?.revision ?? null,
          kind,
          revision,
          skipped,
          now,
        );
      const addImpact = this.#database.prepare(
        "INSERT INTO outlook_history_impacts(id,plan_id,scope_address,source_category,category,target_folder,mark_read,spam,trash,confidence,existing_messages) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      );
      const addAction = this.#database.prepare(
        "INSERT INTO outlook_history_actions(id,plan_id,impact_id,graph_message_id,prior_folder_id,prior_is_read,state,updated_at) VALUES (?,?,?,?,?,?,'pending',?)",
      );
      for (const group of normalized) {
        const impactId = this.#createId();
        const spam = kind === "organize" && group.item.category === "spam";
        const markRead =
          kind === "trash" || (!spam && group.item.category !== "security");
        addImpact.run(
          impactId,
          planId,
          group.item.scope_address,
          group.item.source_category,
          group.item.category,
          kind === "trash" ? "TRASH" : spam ? "SPAM" : group.item.target_path,
          markRead ? 1 : 0,
          spam ? 1 : 0,
          kind === "trash" ? 1 : 0,
          group.item.confidence,
          group.messages.length,
        );
        for (const message of group.messages)
          addAction.run(
            this.#createId(),
            planId,
            impactId,
            message.graph_message_id,
            message.parent_folder_id,
            message.is_read,
            now,
          );
      }
    })();
    return this.get(connection.id, kind)!;
  }

  get(
    connectionId: string,
    kind: "organize" | "trash" = "organize",
  ): GmailOrganizationPlan | null {
    const row = this.#database
      .prepare(
        "SELECT ohp.* FROM outlook_history_plans ohp JOIN outlook_connections oc ON oc.id=ohp.connection_id WHERE ohp.connection_id=? AND oc.profile_id=? AND ohp.plan_kind=? ORDER BY ohp.rowid DESC LIMIT 1",
      )
      .get(connectionId, this.#profileId, kind) as
      | Record<string, unknown>
      | undefined;
    return row ? this.#plan(row) : null;
  }
  getById(planId: string): GmailOrganizationPlan {
    const row = this.#database
      .prepare(
        "SELECT ohp.* FROM outlook_history_plans ohp JOIN outlook_connections oc ON oc.id=ohp.connection_id WHERE ohp.id=? AND oc.profile_id=?",
      )
      .get(planId, this.#profileId) as Record<string, unknown> | undefined;
    if (!row) throw new Error("outlook_history_plan_not_found");
    return this.#plan(row);
  }
  approve(
    connectionId: string,
    planId: string,
    revision: string,
  ): GmailOrganizationPlan {
    const plan = this.getById(planId);
    if (plan.revision !== revision) throw new Error("outlook_plan_stale");
    if (["approved", "running"].includes(plan.state) && plan.job) return plan;
    if (plan.state !== "draft") throw new Error("outlook_plan_stale");
    if (plan.kind === "organize") {
      const current = this.#database
        .prepare(
          "SELECT id,revision FROM organization_proposals WHERE profile_id=? AND provider='outlook' AND connection_id=? AND state='draft' ORDER BY updated_at DESC,rowid DESC LIMIT 1",
        )
        .get(this.#profileId, connectionId) as
        | { id: string; revision: string }
        | undefined;
      if (
        !current ||
        current.id !== plan.proposalId ||
        current.revision !== plan.proposalRevision
      )
        throw new Error("outlook_plan_stale");
    }
    const actions = this.#database
      .prepare(
        "SELECT id FROM outlook_history_actions WHERE plan_id=? ORDER BY rowid",
      )
      .all(planId) as Array<{ id: string }>;
    const job = this.#jobs.createJob({
      profileId: this.#profileId,
      kind: "outlook-history",
      idempotencyKey: `outlook-history:${planId}:${revision}`,
      itemKeys: actions.map((action) => action.id),
    });
    this.#database
      .prepare(
        "UPDATE outlook_history_plans SET state='approved',approved_at=?,job_id=? WHERE id=? AND connection_id=?",
      )
      .run(this.#now(), job.id, planId, connectionId);
    return this.getById(planId);
  }
  planIdForJob(jobId: string): string {
    const row = this.#database
      .prepare(
        "SELECT id FROM outlook_history_plans WHERE job_id=? OR undo_job_id=?",
      )
      .get(jobId, jobId) as { id: string } | undefined;
    if (!row) throw new Error("outlook_history_plan_not_found");
    return row.id;
  }
  action(id: string): OutlookHistoryAction {
    const row = this.#database
      .prepare(
        "SELECT oha.*,ohi.target_folder,ohi.mark_read,ohi.spam,ohi.trash,ohp.connection_id FROM outlook_history_actions oha JOIN outlook_history_impacts ohi ON ohi.id=oha.impact_id JOIN outlook_history_plans ohp ON ohp.id=oha.plan_id JOIN outlook_connections oc ON oc.id=ohp.connection_id WHERE oha.id=? AND oc.profile_id=?",
      )
      .get(id, this.#profileId) as Record<string, unknown> | undefined;
    if (!row) throw new Error("outlook_history_action_not_found");
    return {
      id: String(row.id),
      planId: String(row.plan_id),
      connectionId: String(row.connection_id),
      graphMessageId: String(row.graph_message_id),
      priorFolderId: String(row.prior_folder_id),
      priorIsRead: Boolean(row.prior_is_read),
      targetFolder: String(row.target_folder),
      markRead: Boolean(row.mark_read),
      spam: Boolean(row.spam),
      trash: Boolean(row.trash),
      resultingFolderId: row.resulting_folder_id
        ? String(row.resulting_folder_id)
        : null,
      resultingIsRead:
        row.resulting_is_read == null ? null : Boolean(row.resulting_is_read),
    };
  }
  mark(
    id: string,
    state: "running" | "succeeded" | "failed" | "verification_mismatch",
    error: string | null = null,
    result?: { folderId: string; isRead: boolean },
  ): void {
    this.#database
      .prepare(
        "UPDATE outlook_history_actions SET state=?,error_code=?,resulting_folder_id=COALESCE(?,resulting_folder_id),resulting_is_read=COALESCE(?,resulting_is_read),updated_at=? WHERE id=?",
      )
      .run(
        state,
        error,
        result?.folderId ?? null,
        result ? Number(result.isRead) : null,
        this.#now(),
        id,
      );
  }
  retry(planId: string, ids: readonly string[]): GmailOrganizationPlan {
    const plan = this.getById(planId);
    if (!plan.job) throw new Error("outlook_history_job_missing");
    this.#jobs.retryItems(plan.job.id, ids);
    const slots = ids.map(() => "?").join(",");
    this.#database
      .prepare(
        `UPDATE outlook_history_actions SET state='pending',error_code=NULL,updated_at=? WHERE plan_id=? AND id IN (${slots})`,
      )
      .run(this.#now(), planId, ...ids);
    this.#database
      .prepare("UPDATE outlook_history_plans SET state='approved' WHERE id=?")
      .run(planId);
    return this.getById(planId);
  }
  prepareUndo(planId: string): GmailOrganizationPlan {
    const plan = this.getById(planId);
    if (plan.job?.state !== "succeeded")
      throw new Error("outlook_history_undo_not_ready");
    const rows = this.#database
      .prepare(
        "SELECT id FROM outlook_history_actions WHERE plan_id=? AND state='succeeded' AND resulting_folder_id IS NOT NULL ORDER BY rowid DESC",
      )
      .all(planId) as Array<{ id: string }>;
    if (!rows.length) throw new Error("outlook_history_undo_receipts_missing");
    const job = this.#jobs.createJob({
      profileId: this.#profileId,
      kind: "outlook-history",
      idempotencyKey: `outlook-history-undo:${planId}:${plan.revision}`,
      itemKeys: rows.map((row) => `undo:${row.id}`),
    });
    this.#database
      .prepare("UPDATE outlook_history_plans SET undo_job_id=? WHERE id=?")
      .run(job.id, planId);
    this.#database
      .prepare(
        "UPDATE outlook_history_actions SET undo_state='pending',undo_error_code=NULL WHERE plan_id=? AND state='succeeded'",
      )
      .run(planId);
    return this.getById(planId);
  }
  markUndo(
    id: string,
    state: "running" | "succeeded" | "failed" | "verification_mismatch",
    error: string | null = null,
  ): void {
    this.#database
      .prepare(
        "UPDATE outlook_history_actions SET undo_state=?,undo_error_code=?,updated_at=? WHERE id=?",
      )
      .run(state, error, this.#now(), id);
  }
  syncIndexed(
    connectionId: string,
    messageId: string,
    folderId: string,
    isRead: boolean,
  ): void {
    this.#database
      .prepare(
        "UPDATE outlook_indexed_messages SET parent_folder_id=?,is_read=? WHERE connection_id=? AND graph_message_id=?",
      )
      .run(folderId, isRead ? 1 : 0, connectionId, messageId);
  }
  sync(planId: string): GmailOrganizationPlan {
    const plan = this.getById(planId);
    const state =
      plan.job?.state === "succeeded"
        ? "completed"
        : plan.job &&
            ["failed", "verification_mismatch"].includes(plan.job.state)
          ? "failed"
          : plan.job?.state === "running"
            ? "running"
            : plan.state;
    this.#database
      .prepare("UPDATE outlook_history_plans SET state=? WHERE id=?")
      .run(state, planId);
    return this.getById(planId);
  }

  #plan(row: Record<string, unknown>): GmailOrganizationPlan {
    const impacts = this.#database
      .prepare(
        "SELECT * FROM outlook_history_impacts WHERE plan_id=? ORDER BY existing_messages DESC,target_folder",
      )
      .all(row.id) as Array<Record<string, unknown>>;
    const actions = this.#database
      .prepare(
        "SELECT * FROM outlook_history_actions WHERE plan_id=? ORDER BY rowid",
      )
      .all(row.id) as Array<Record<string, unknown>>;
    const impactState = (id: string) => {
      const states = actions
        .filter((action) => action.impact_id === id)
        .map((action) => String(action.state));
      if (states.includes("verification_mismatch"))
        return "verification_mismatch";
      if (states.includes("failed")) return "failed";
      if (states.includes("running")) return "running";
      if (states.length && states.every((state) => state === "succeeded"))
        return "succeeded";
      return "pending";
    };
    return gmailOrganizationPlanSchema.parse({
      id: row.id,
      kind: row.plan_kind,
      revision: row.revision,
      state: row.state,
      proposalId: row.proposal_id,
      proposalRevision: row.proposal_revision,
      impactCount: impacts.length,
      batchCount: actions.length,
      existingMessageCount: impacts.reduce(
        (sum, impact) => sum + Number(impact.existing_messages),
        0,
      ),
      skippedAmbiguousStreams: row.skipped_ambiguous_streams,
      impacts: impacts.map((impact) => ({
        id: impact.id,
        scopeAddress: impact.scope_address,
        sourceCategory: impact.source_category,
        category: impact.category,
        targetLabel: impact.target_folder,
        markRead: Boolean(impact.mark_read),
        archive: true,
        spam: Boolean(impact.spam),
        trash: Boolean(impact.trash),
        existingMessages: impact.existing_messages,
        confidence: impact.confidence,
        state: impactState(String(impact.id)),
      })),
      job: row.job_id ? this.#jobs.getProgress(String(row.job_id)) : null,
      undoJob: row.undo_job_id
        ? this.#jobs.getProgress(String(row.undo_job_id))
        : null,
      failedBatches: actions
        .filter((action) =>
          ["failed", "verification_mismatch"].includes(String(action.state)),
        )
        .map((action) => ({
          id: action.id,
          targetLabel:
            impacts.find((impact) => impact.id === action.impact_id)
              ?.target_folder ?? "Unknown",
          state: action.state,
          errorCode: action.error_code,
        })),
      createdAt: row.created_at,
      approvedAt: row.approved_at,
    });
  }
}
