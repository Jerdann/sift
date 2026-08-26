import type BetterSqlite3 from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { AccountProvider } from "../../shared/contracts/accounts";
import type { MailCategory } from "../../shared/contracts/analysis";
import {
  desiredManagedRuleSchema,
  providerRuleSnapshotSchema,
  ruleInventorySchema,
  ruleReconciliationPlanSchema,
  type DesiredManagedRule,
  type ProviderRuleSnapshot,
  type RuleInventory,
  type RuleReconciliationOperation,
  type RuleReconciliationPlan,
} from "../../shared/contracts/rule-management";
import {
  desiredRule,
  sha256,
  snapshotForDesiredRule,
} from "../../core/rules/rule-reconciliation";
import type { JobRepository } from "../jobs/job-repository";

interface StreamRow {
  sender_domain: string;
  category: MailCategory;
  receiving_address: string;
  message_count: number;
  confidence: number;
}

interface ProposalItemRow {
  scope_address: string | null;
  source_category: MailCategory;
  category: MailCategory;
  target_path: string;
  enabled: number;
}

interface ManagedRow {
  stable_key: string;
  provider_rule_id: string | null;
  fingerprint: string;
  desired_json: string;
  ownership: "managed" | "adopted" | "exported";
  state: "active" | "removed" | "mismatched";
}

export interface RuleOperationRecord {
  id: string;
  planId: string;
  provider: AccountProvider;
  connectionId: string;
  stableKey: string;
  kind: RuleReconciliationOperation["kind"];
  desired: DesiredManagedRule | null;
  prior: ProviderRuleSnapshot | null;
  priorManaged: DesiredManagedRule | null;
  providerRuleId: string | null;
}

const parseJson = <T>(value: unknown): T => JSON.parse(String(value)) as T;

export class RuleReconciliationRepository {
  readonly #database: BetterSqlite3.Database;
  readonly #profileId: string;
  readonly #jobs?: JobRepository;
  readonly #now: () => string;
  readonly #createId: () => string;

  constructor(
    database: BetterSqlite3.Database,
    profileId: string,
    options: {
      jobs?: JobRepository;
      now?: () => string;
      createId?: () => string;
    } = {},
  ) {
    this.#database = database;
    this.#profileId = profileId;
    this.#jobs = options.jobs;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#createId = options.createId ?? randomUUID;
  }

  saveInventory(
    provider: AccountProvider,
    connectionId: string,
    capability: RuleInventory["capability"],
    snapshots: Array<Omit<ProviderRuleSnapshot, "stableKey" | "ownership">>,
    providerLimit: number | null,
  ): RuleInventory {
    this.#assertConnection(provider, connectionId);
    const managed = this.#managed(provider, connectionId);
    const byProviderId = new Map(
      managed
        .filter((row) => row.provider_rule_id)
        .map((row) => [row.provider_rule_id!, row]),
    );
    if (provider === "proton") {
      for (const row of managed)
        byProviderId.set(
          row.provider_rule_id ?? `export:${row.stable_key}`,
          row,
        );
    }
    const inventoryId = this.#createId();
    const capturedAt = this.#now();
    this.#database.transaction(() => {
      this.#database
        .prepare(
          "INSERT INTO rule_inventories(id,profile_id,provider,connection_id,capability,provider_limit,captured_at) VALUES (?,?,?,?,?,?,?)",
        )
        .run(
          inventoryId,
          this.#profileId,
          provider,
          connectionId,
          capability,
          providerLimit,
          capturedAt,
        );
      const insert = this.#database.prepare(
        "INSERT INTO rule_inventory_items(id,inventory_id,provider_rule_id,stable_key,fingerprint,ownership,criteria_json,action_json) VALUES (?,?,?,?,?,?,?,?)",
      );
      for (const snapshot of snapshots) {
        const record = byProviderId.get(snapshot.providerRuleId);
        insert.run(
          this.#createId(),
          inventoryId,
          snapshot.providerRuleId,
          record?.stable_key ?? null,
          snapshot.fingerprint,
          record?.ownership ?? "external",
          JSON.stringify(snapshot.criteria),
          JSON.stringify(snapshot.action),
        );
      }
    })();
    return this.getInventory(inventoryId);
  }

  getCurrentInventory(
    provider: AccountProvider,
    connectionId: string,
  ): RuleInventory | null {
    this.#assertConnection(provider, connectionId);
    const row = this.#database
      .prepare(
        "SELECT id FROM rule_inventories WHERE profile_id=? AND provider=? AND connection_id=? ORDER BY captured_at DESC,rowid DESC LIMIT 1",
      )
      .get(this.#profileId, provider, connectionId) as
      | { id: string }
      | undefined;
    return row ? this.getInventory(row.id) : null;
  }

  managedExportSnapshots(
    connectionId: string,
  ): Array<Omit<ProviderRuleSnapshot, "stableKey" | "ownership">> {
    this.#assertConnection("proton", connectionId);
    return this.#managed("proton", connectionId)
      .filter((row) => row.state === "active")
      .map((row) =>
        snapshotForDesiredRule(
          row.provider_rule_id ?? `export:${row.stable_key}`,
          desiredManagedRuleSchema.parse(parseJson(row.desired_json)),
        ),
      );
  }

  getInventory(inventoryId: string): RuleInventory {
    const inventory = this.#database
      .prepare("SELECT * FROM rule_inventories WHERE id=? AND profile_id=?")
      .get(inventoryId, this.#profileId) as Record<string, unknown> | undefined;
    if (!inventory) throw new Error("rule_inventory_not_found");
    const items = this.#database
      .prepare(
        "SELECT * FROM rule_inventory_items WHERE inventory_id=? ORDER BY ownership,provider_rule_id",
      )
      .all(inventoryId) as Array<Record<string, unknown>>;
    return ruleInventorySchema.parse({
      id: inventory.id,
      provider: inventory.provider,
      connectionId: inventory.connection_id,
      capability: inventory.capability,
      capturedAt: inventory.captured_at,
      providerLimit: inventory.provider_limit,
      rules: items.map((item) => ({
        providerRuleId: item.provider_rule_id,
        stableKey: item.stable_key,
        fingerprint: item.fingerprint,
        ownership: item.ownership,
        criteria: parseJson(item.criteria_json),
        action: parseJson(item.action_json),
      })),
    });
  }

  desired(
    provider: AccountProvider,
    connectionId: string,
  ): {
    proposalId: string;
    proposalRevision: string;
    rules: DesiredManagedRule[];
  } {
    this.#assertConnection(provider, connectionId);
    const proposal = this.#database
      .prepare(
        "SELECT * FROM organization_proposals WHERE profile_id=? AND provider=? AND connection_id=? AND state='draft' ORDER BY updated_at DESC,rowid DESC LIMIT 1",
      )
      .get(this.#profileId, provider, connectionId) as
      | Record<string, unknown>
      | undefined;
    if (!proposal) throw new Error("organization_proposal_required");
    const proposalItems = this.#database
      .prepare(
        "SELECT scope_address,source_category,category,target_path,enabled FROM organization_proposal_items WHERE proposal_id=?",
      )
      .all(proposal.id) as ProposalItemRow[];
    const itemBySource = new Map(
      proposalItems.map((item) => [
        `${item.scope_address ?? ""}\0${item.source_category}`,
        item,
      ]),
    );
    const streams = this.#streams(provider, String(proposal.analysis_id));
    const groups = new Map<string, StreamRow[]>();
    for (const stream of streams) {
      if (
        stream.sender_domain === "unknown-sender" ||
        stream.receiving_address === "unknown"
      )
        continue;
      const key = `${stream.sender_domain}\0${stream.receiving_address}`;
      groups.set(key, [...(groups.get(key) ?? []), stream]);
    }
    const rules: DesiredManagedRule[] = [];
    for (const group of groups.values()) {
      const ordered = [...group].sort(
        (left, right) =>
          right.message_count - left.message_count ||
          left.category.localeCompare(right.category),
      );
      const dominant = ordered[0]!;
      const total = ordered.reduce((sum, item) => sum + item.message_count, 0);
      if (
        dominant.message_count / total < 0.75 ||
        dominant.confidence < (dominant.category === "spam" ? 0.94 : 0.82)
      )
        continue;
      const item = itemBySource.get(
        `${dominant.receiving_address}\0${dominant.category}`,
      );
      if (
        !item?.enabled ||
        ["personal", "suspicious", "other"].includes(item.category)
      )
        continue;
      const spam = item.category === "spam";
      rules.push(
        desiredRule({
          provider,
          connectionId,
          senderDomain: dominant.sender_domain,
          receivingAddress: dominant.receiving_address,
          category: item.category,
          targetPath: spam ? "SPAM" : item.target_path,
          markRead: item.category !== "security" && !spam,
          archive:
            provider !== "proton" && item.category !== "security" && !spam,
          spam,
          observedMessages: dominant.message_count,
          confidence: dominant.confidence,
        }),
      );
    }
    rules.sort((left, right) => left.stableKey.localeCompare(right.stableKey));
    return {
      proposalId: String(proposal.id),
      proposalRevision: String(proposal.revision),
      rules,
    };
  }

  generate(
    provider: AccountProvider,
    connectionId: string,
  ): RuleReconciliationPlan {
    const inventory = this.getCurrentInventory(provider, connectionId);
    if (!inventory) throw new Error("rule_inventory_required");
    const desired = this.desired(provider, connectionId);
    const managed = this.#managed(provider, connectionId).filter(
      (row) => row.state === "active",
    );
    const managedByKey = new Map(managed.map((row) => [row.stable_key, row]));
    const inventoryById = new Map(
      inventory.rules.map((rule) => [rule.providerRuleId, rule]),
    );
    const externalByFingerprint = new Map(
      inventory.rules
        .filter((rule) => rule.ownership === "external")
        .map((rule) => [rule.fingerprint, rule]),
    );
    const operations: Array<
      Omit<
        RuleReconciliationOperation,
        "id" | "state" | "providerRuleId" | "errorCode"
      >
    > = [];
    for (const rule of desired.rules) {
      const current = managedByKey.get(rule.stableKey);
      const prior = current?.provider_rule_id
        ? (inventoryById.get(current.provider_rule_id) ?? null)
        : null;
      if (
        current &&
        prior &&
        current.fingerprint === rule.fingerprint &&
        prior.fingerprint === rule.fingerprint
      ) {
        operations.push({
          stableKey: rule.stableKey,
          kind: "unchanged",
          desired: rule,
          prior,
          priorManaged: desiredManagedRuleSchema.parse(
            parseJson(current.desired_json),
          ),
        });
      } else if (current && prior) {
        operations.push({
          stableKey: rule.stableKey,
          kind: "replace",
          desired: rule,
          prior,
          priorManaged: desiredManagedRuleSchema.parse(
            parseJson(current.desired_json),
          ),
        });
      } else {
        const exact = externalByFingerprint.get(rule.fingerprint) ?? null;
        operations.push({
          stableKey: rule.stableKey,
          kind: exact ? "adopt" : "create",
          desired: rule,
          prior: exact,
          priorManaged: current
            ? desiredManagedRuleSchema.parse(parseJson(current.desired_json))
            : null,
        });
      }
      managedByKey.delete(rule.stableKey);
    }
    for (const current of managedByKey.values()) {
      const prior = current.provider_rule_id
        ? (inventoryById.get(current.provider_rule_id) ?? null)
        : null;
      operations.push({
        stableKey: current.stable_key,
        kind: "remove",
        desired: null,
        prior,
        priorManaged: desiredManagedRuleSchema.parse(
          parseJson(current.desired_json),
        ),
      });
    }
    operations.sort((left, right) =>
      left.stableKey.localeCompare(right.stableKey),
    );
    const revision = sha256(
      operations.map((operation) => [
        operation.stableKey,
        operation.kind,
        operation.desired?.fingerprint ?? null,
        operation.prior?.fingerprint ?? null,
      ]),
    );
    const planId = this.#createId();
    const now = this.#now();
    this.#database.transaction(() => {
      this.#database
        .prepare(
          "DELETE FROM rule_reconciliation_plans WHERE profile_id=? AND provider=? AND connection_id=? AND state='draft'",
        )
        .run(this.#profileId, provider, connectionId);
      this.#database
        .prepare(
          "INSERT INTO rule_reconciliation_plans(id,profile_id,provider,connection_id,proposal_id,proposal_revision,inventory_id,revision,state,created_at) VALUES (?,?,?,?,?,?,?,?,'draft',?)",
        )
        .run(
          planId,
          this.#profileId,
          provider,
          connectionId,
          desired.proposalId,
          desired.proposalRevision,
          inventory.id,
          revision,
          now,
        );
      const insert = this.#database.prepare(
        "INSERT INTO rule_reconciliation_operations(id,plan_id,stable_key,operation_kind,desired_json,prior_json,prior_managed_json,state,provider_rule_id,updated_at) VALUES (?,?,?,?,?,?,?,'pending',?,?)",
      );
      for (const operation of operations)
        insert.run(
          this.#createId(),
          planId,
          operation.stableKey,
          operation.kind,
          operation.desired ? JSON.stringify(operation.desired) : null,
          operation.prior ? JSON.stringify(operation.prior) : null,
          operation.priorManaged
            ? JSON.stringify(operation.priorManaged)
            : null,
          operation.prior?.providerRuleId ?? null,
          now,
        );
    })();
    return this.getPlan(planId);
  }

  getCurrentPlan(
    provider: AccountProvider,
    connectionId: string,
  ): RuleReconciliationPlan | null {
    this.#assertConnection(provider, connectionId);
    const row = this.#database
      .prepare(
        "SELECT id FROM rule_reconciliation_plans WHERE profile_id=? AND provider=? AND connection_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1",
      )
      .get(this.#profileId, provider, connectionId) as
      | { id: string }
      | undefined;
    return row ? this.getPlan(row.id) : null;
  }

  getPlan(planId: string): RuleReconciliationPlan {
    const plan = this.#database
      .prepare(
        "SELECT * FROM rule_reconciliation_plans WHERE id=? AND profile_id=?",
      )
      .get(planId, this.#profileId) as Record<string, unknown> | undefined;
    if (!plan) throw new Error("rule_plan_not_found");
    const operations = this.#database
      .prepare(
        "SELECT * FROM rule_reconciliation_operations WHERE plan_id=? ORDER BY operation_kind,stable_key",
      )
      .all(planId) as Array<Record<string, unknown>>;
    return ruleReconciliationPlanSchema.parse({
      id: plan.id,
      provider: plan.provider,
      connectionId: plan.connection_id,
      proposalId: plan.proposal_id,
      proposalRevision: plan.proposal_revision,
      inventoryId: plan.inventory_id,
      revision: plan.revision,
      state: plan.state,
      createdAt: plan.created_at,
      approvedAt: plan.approved_at,
      operations: operations.map((operation) => ({
        id: operation.id,
        stableKey: operation.stable_key,
        kind: operation.operation_kind,
        desired: operation.desired_json
          ? desiredManagedRuleSchema.parse(parseJson(operation.desired_json))
          : null,
        prior: operation.prior_json
          ? providerRuleSnapshotSchema.parse(parseJson(operation.prior_json))
          : null,
        priorManaged: operation.prior_managed_json
          ? desiredManagedRuleSchema.parse(
              parseJson(operation.prior_managed_json),
            )
          : null,
        state: operation.state,
        providerRuleId: operation.provider_rule_id,
        errorCode: operation.error_code,
      })),
      job:
        plan.job_id && this.#jobs
          ? this.#jobs.getProgress(String(plan.job_id))
          : null,
      undoJob:
        plan.undo_job_id && this.#jobs
          ? this.#jobs.getProgress(String(plan.undo_job_id))
          : null,
    });
  }

  approve(planId: string, revision: string): RuleReconciliationPlan {
    if (!this.#jobs) throw new Error("rule_jobs_unavailable");
    const plan = this.getPlan(planId);
    if (plan.state !== "draft" || plan.revision !== revision)
      throw new Error("rule_plan_changed");
    const currentProposal = this.#database
      .prepare(
        "SELECT revision,state FROM organization_proposals WHERE id=? AND profile_id=?",
      )
      .get(plan.proposalId, this.#profileId) as
      | { revision: string; state: string }
      | undefined;
    if (
      !currentProposal ||
      currentProposal.state !== "draft" ||
      currentProposal.revision !== plan.proposalRevision
    ) {
      throw new Error("organization_proposal_changed");
    }
    const operationIds = plan.operations.map((operation) => operation.id);
    const now = this.#now();
    if (!operationIds.length) {
      this.#database
        .prepare(
          "UPDATE rule_reconciliation_plans SET state='completed',approved_at=? WHERE id=?",
        )
        .run(now, planId);
      return this.getPlan(planId);
    }
    const job = this.#jobs.createJob({
      profileId: this.#profileId,
      kind: "provider-rules",
      idempotencyKey: `provider-rules:${planId}:${revision}`,
      itemKeys: operationIds,
    });
    this.#database
      .prepare(
        "UPDATE rule_reconciliation_plans SET state='approved',approved_at=?,job_id=? WHERE id=?",
      )
      .run(now, job.id, planId);
    return this.getPlan(planId);
  }

  planIdForJob(jobId: string): string {
    const row = this.#database
      .prepare(
        "SELECT id FROM rule_reconciliation_plans WHERE job_id=? AND profile_id=?",
      )
      .get(jobId, this.#profileId) as { id: string } | undefined;
    if (!row) throw new Error("rule_plan_not_found");
    return row.id;
  }

  operation(operationId: string): RuleOperationRecord {
    const row = this.#database
      .prepare(
        `
      SELECT operation.*,plan.provider,plan.connection_id FROM rule_reconciliation_operations operation
      JOIN rule_reconciliation_plans plan ON plan.id=operation.plan_id
      WHERE operation.id=? AND plan.profile_id=?
    `,
      )
      .get(operationId, this.#profileId) as Record<string, unknown> | undefined;
    if (!row) throw new Error("rule_operation_not_found");
    return {
      id: String(row.id),
      planId: String(row.plan_id),
      provider: row.provider as AccountProvider,
      connectionId: String(row.connection_id),
      stableKey: String(row.stable_key),
      kind: row.operation_kind as RuleReconciliationOperation["kind"],
      desired: row.desired_json
        ? desiredManagedRuleSchema.parse(parseJson(row.desired_json))
        : null,
      prior: row.prior_json
        ? providerRuleSnapshotSchema.parse(parseJson(row.prior_json))
        : null,
      priorManaged: row.prior_managed_json
        ? desiredManagedRuleSchema.parse(parseJson(row.prior_managed_json))
        : null,
      providerRuleId: row.provider_rule_id
        ? String(row.provider_rule_id)
        : null,
    };
  }

  managedRule(
    provider: AccountProvider,
    connectionId: string,
    stableKey: string,
  ): ManagedRow | null {
    return (
      (this.#database
        .prepare(
          "SELECT stable_key,provider_rule_id,fingerprint,desired_json,ownership,state FROM managed_rules WHERE profile_id=? AND provider=? AND connection_id=? AND stable_key=?",
        )
        .get(this.#profileId, provider, connectionId, stableKey) as
        | ManagedRow
        | undefined) ?? null
    );
  }

  setOperationRunning(operationId: string): void {
    this.#database
      .prepare(
        "UPDATE rule_reconciliation_operations SET state='running',error_code=NULL,updated_at=? WHERE id=?",
      )
      .run(this.#now(), operationId);
  }

  setOperationProviderId(operationId: string, providerRuleId: string): void {
    this.#database
      .prepare(
        "UPDATE rule_reconciliation_operations SET provider_rule_id=?,updated_at=? WHERE id=?",
      )
      .run(providerRuleId, this.#now(), operationId);
  }

  setOperationResult(
    operationId: string,
    state: "succeeded" | "failed" | "verification_mismatch" | "undone",
    options: {
      providerRuleId?: string | null;
      verifiedFingerprint?: string | null;
      errorCode?: string | null;
    } = {},
  ): void {
    this.#database
      .prepare(
        `
      UPDATE rule_reconciliation_operations SET state=?,provider_rule_id=COALESCE(?,provider_rule_id),
        verified_fingerprint=?,error_code=?,updated_at=? WHERE id=?
    `,
      )
      .run(
        state,
        options.providerRuleId ?? null,
        options.verifiedFingerprint ?? null,
        options.errorCode ?? null,
        this.#now(),
        operationId,
      );
  }

  activateManagedRule(
    provider: AccountProvider,
    connectionId: string,
    desired: DesiredManagedRule,
    providerRuleId: string,
    ownership: "managed" | "adopted" | "exported",
  ): void {
    const now = this.#now();
    this.#database
      .prepare(
        `
      INSERT INTO managed_rules(id,profile_id,provider,connection_id,stable_key,provider_rule_id,fingerprint,desired_json,ownership,state,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,'active',?,?)
      ON CONFLICT(connection_id,stable_key) DO UPDATE SET provider_rule_id=excluded.provider_rule_id,
        fingerprint=excluded.fingerprint,desired_json=excluded.desired_json,ownership=excluded.ownership,state='active',updated_at=excluded.updated_at
    `,
      )
      .run(
        this.#createId(),
        this.#profileId,
        provider,
        connectionId,
        desired.stableKey,
        providerRuleId,
        desired.fingerprint,
        JSON.stringify(desired),
        ownership,
        now,
        now,
      );
  }

  removeManagedRule(
    provider: AccountProvider,
    connectionId: string,
    stableKey: string,
  ): void {
    this.#database
      .prepare(
        "UPDATE managed_rules SET state='removed',updated_at=? WHERE profile_id=? AND provider=? AND connection_id=? AND stable_key=?",
      )
      .run(this.#now(), this.#profileId, provider, connectionId, stableKey);
  }

  retry(
    planId: string,
    operationIds: readonly string[],
  ): RuleReconciliationPlan {
    if (!this.#jobs) throw new Error("rule_jobs_unavailable");
    const plan = this.getPlan(planId);
    if (!plan.job) throw new Error("rule_plan_not_approved");
    const selected = plan.operations.filter((operation) =>
      operationIds.includes(operation.id),
    );
    if (selected.length !== new Set(operationIds).size)
      throw new Error("rule_operation_not_found");
    this.#jobs.retryItems(plan.job.id, operationIds);
    const placeholders = operationIds.map(() => "?").join(",");
    this.#database
      .prepare(
        `UPDATE rule_reconciliation_operations SET state='pending',error_code=NULL,updated_at=? WHERE plan_id=? AND id IN (${placeholders})`,
      )
      .run(this.#now(), planId, ...operationIds);
    this.#database
      .prepare(
        "UPDATE rule_reconciliation_plans SET state='approved' WHERE id=?",
      )
      .run(planId);
    return this.getPlan(planId);
  }

  syncPlanState(planId: string): RuleReconciliationPlan {
    const plan = this.getPlan(planId);
    if (!plan.job) return plan;
    const state =
      plan.job.state === "succeeded"
        ? "completed"
        : ["failed", "verification_mismatch"].includes(plan.job.state)
          ? "failed"
          : plan.job.state === "running"
            ? "executing"
            : "approved";
    this.#database
      .prepare("UPDATE rule_reconciliation_plans SET state=? WHERE id=?")
      .run(state, planId);
    return this.getPlan(planId);
  }

  prepareUndo(planId: string): RuleReconciliationPlan {
    if (!this.#jobs) throw new Error("rule_jobs_unavailable");
    const plan = this.getPlan(planId);
    if (!["completed", "failed"].includes(plan.state))
      throw new Error("rule_plan_not_undoable");
    if (plan.undoJob) return plan;
    const operationIds = plan.operations
      .filter(
        (operation) =>
          operation.state === "succeeded" && operation.kind !== "unchanged",
      )
      .map((operation) => `undo:${operation.id}`);
    if (!operationIds.length) throw new Error("rule_plan_nothing_to_undo");
    const job = this.#jobs.createJob({
      profileId: this.#profileId,
      kind: "provider-rules",
      idempotencyKey: `provider-rules-undo:${plan.id}:${plan.revision}`,
      itemKeys: operationIds,
    });
    this.#database
      .prepare(
        "UPDATE rule_reconciliation_plans SET state='executing',undo_job_id=? WHERE id=?",
      )
      .run(job.id, planId);
    return this.getPlan(planId);
  }

  planIdForUndoJob(jobId: string): string {
    const row = this.#database
      .prepare(
        "SELECT id FROM rule_reconciliation_plans WHERE undo_job_id=? AND profile_id=?",
      )
      .get(jobId, this.#profileId) as { id: string } | undefined;
    if (!row) throw new Error("rule_plan_not_found");
    return row.id;
  }

  syncUndoState(planId: string): RuleReconciliationPlan {
    const plan = this.getPlan(planId);
    if (!plan.undoJob) return plan;
    const state =
      plan.undoJob.state === "succeeded"
        ? "undone"
        : ["failed", "verification_mismatch"].includes(plan.undoJob.state)
          ? "failed"
          : "executing";
    this.#database
      .prepare("UPDATE rule_reconciliation_plans SET state=? WHERE id=?")
      .run(state, planId);
    return this.getPlan(planId);
  }

  rulesForPlan(planId: string, revision: string): DesiredManagedRule[] {
    const plan = this.getPlan(planId);
    if (
      plan.provider !== "proton" ||
      plan.revision !== revision ||
      plan.state !== "draft"
    ) {
      throw new Error("proton_rule_plan_changed");
    }
    return plan.operations.flatMap((operation) =>
      operation.desired ? [operation.desired] : [],
    );
  }

  finalizeProtonExport(
    planId: string,
    revision: string,
    checksum: string,
    exportedPath: string,
  ): RuleReconciliationPlan {
    const plan = this.getPlan(planId);
    if (
      plan.provider !== "proton" ||
      plan.revision !== revision ||
      plan.state !== "draft"
    ) {
      throw new Error("proton_rule_plan_changed");
    }
    const rules = this.rulesForPlan(planId, revision);
    const now = this.#now();
    this.#database.transaction(() => {
      for (const operation of plan.operations) {
        if (operation.desired) {
          this.activateManagedRule(
            "proton",
            plan.connectionId,
            operation.desired,
            `export:${operation.stableKey}`,
            "exported",
          );
        } else {
          this.removeManagedRule(
            "proton",
            plan.connectionId,
            operation.stableKey,
          );
        }
        this.setOperationResult(operation.id, "succeeded", {
          providerRuleId: operation.desired
            ? `export:${operation.stableKey}`
            : null,
          verifiedFingerprint:
            operation.desired?.fingerprint ??
            operation.prior?.fingerprint ??
            null,
        });
      }
      this.#database
        .prepare(
          `
        INSERT INTO proton_rule_exports(id,profile_id,connection_id,plan_id,revision,checksum,exported_path,exported_at,import_status,created_at)
        VALUES (?,?,?,?,?,?,?,?, 'awaiting_manual_import',?)
      `,
        )
        .run(
          this.#createId(),
          this.#profileId,
          plan.connectionId,
          planId,
          revision,
          checksum,
          exportedPath,
          now,
          now,
        );
      this.#database
        .prepare(
          "UPDATE rule_reconciliation_plans SET state='completed',approved_at=? WHERE id=?",
        )
        .run(now, planId);
    })();
    if (
      rules.length !==
      plan.operations.filter((operation) => operation.desired).length
    )
      throw new Error("proton_rule_export_mismatch");
    return this.getPlan(planId);
  }

  #managed(provider: AccountProvider, connectionId: string): ManagedRow[] {
    return this.#database
      .prepare(
        "SELECT stable_key,provider_rule_id,fingerprint,desired_json,ownership,state FROM managed_rules WHERE profile_id=? AND provider=? AND connection_id=?",
      )
      .all(this.#profileId, provider, connectionId) as ManagedRow[];
  }

  #streams(provider: AccountProvider, analysisId: string): StreamRow[] {
    if (provider === "gmail")
      return this.#database
        .prepare(
          "SELECT sender_domain,category,receiving_address,message_count,confidence FROM gmail_analysis_streams WHERE analysis_id=?",
        )
        .all(analysisId) as StreamRow[];
    if (provider === "outlook")
      return this.#database
        .prepare(
          "SELECT sender_domain,category,receiving_address,message_count,confidence FROM outlook_analysis_streams WHERE analysis_id=?",
        )
        .all(analysisId) as StreamRow[];
    return this.#database
      .prepare(
        "SELECT sender_domain,category,receiving_address,message_count,confidence FROM analysis_streams WHERE analysis_id=?",
      )
      .all(analysisId) as StreamRow[];
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
