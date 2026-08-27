import type BetterSqlite3 from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import type { JobRepository } from '../jobs/job-repository';
import { isSameProtonFolder, protonFolderPath } from '../proton/proton-paths';
import { CATEGORY_PRESENTATION } from '../../core/classification/mail-classifier';
import type { MailCategory } from '../../shared/contracts/analysis';
import { type CleanupPlan, cleanupPlanSchema, type GenerateCleanupInput } from '../../shared/contracts/cleanup';
import { analyzeMailbox } from '../analysis/mailbox-analysis-service';

interface CandidateRow {
  analysis_id: string;
  message_row_id: string;
  canonical_key: string;
  category: MailCategory;
  sender_domain: string;
  confidence: number;
  receiving_addresses_json: string;
  source_path: string;
  special_use: string | null;
  container_flags_json: string;
  uid_validity: string;
  uid: number;
}

interface ProposalItemRow {
  scope_address: string | null;
  container_name: string | null;
  source_category: MailCategory;
  category: MailCategory;
  target_path: string;
  enabled: number;
}

export interface CleanupActionRecord {
  id: string;
  planId: string;
  messageRowId: string;
  connectionId: string;
  category: MailCategory;
  sourcePath: string;
  uidValidity: string;
  uid: number;
  targetPath: string;
  actionKind: 'sort_read_archive' | 'native_spam' | 'native_trash';
  priorFlags: string[];
  resultingPath: string | null;
  resultingUidValidity: string | null;
  resultingUid: number | null;
}

export interface CleanupTargetRecord {
  targetPath: string;
  actionKind: CleanupActionRecord['actionKind'];
}

export interface CleanupLegacyContainerRecord {
  id: string;
  planId: string;
  providerPath: string;
  kind: 'folder' | 'label';
  observedMessages: number;
  state: 'pending' | 'running' | 'retired' | 'retained_nonempty' | 'failed';
}

export class CleanupPlanRepository {
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

  get profileId(): string { return this.#profileId; }

  generate(connectionId: string, input: GenerateCleanupInput): CleanupPlan {
    // A Proton audit can legitimately replace indexed rows when Bridge reports a
    // new UIDVALIDITY. Classifications reference those rows and are therefore
    // invalidated with them. Refresh the local-only classification snapshot at
    // the exact-review boundary so a still-visible organization proposal never
    // produces an empty or partial filing plan. The proposal itself remains
    // untouched, preserving the user's category edits and alias containers.
    analyzeMailbox(this.#database, this.#profileId, connectionId);
    const existingSetup = input.existingSetup ?? 'extend';
    const candidates = this.#database.prepare(`
      SELECT ma.id AS analysis_id, mc.message_row_id, mc.canonical_key,
             mc.category, mc.sender_domain, mc.confidence, mc.receiving_addresses_json, im.uid_validity, im.uid,
             containers.provider_container_id AS source_path, containers.special_use,
             containers.flags_json AS container_flags_json
      FROM mailbox_analyses ma
      JOIN message_classifications mc ON mc.analysis_id = ma.id
      JOIN indexed_messages im ON im.id = mc.message_row_id
      JOIN mail_containers containers ON containers.id = im.container_id
      WHERE ma.connection_id = ? AND ma.profile_id = ?
      ORDER BY mc.canonical_key
    `).all(connectionId, this.#profileId) as CandidateRow[];
    if (!candidates.length) throw new Error('mailbox_analysis_required');
    const analysisId = candidates[0]!.analysis_id;
    const proposal = input.kind === 'organize' ? this.#database.prepare("SELECT id,revision FROM organization_proposals WHERE profile_id=? AND provider='proton' AND connection_id=? AND state='draft' ORDER BY updated_at DESC,rowid DESC LIMIT 1")
      .get(this.#profileId, connectionId) as { id: string; revision: string } | undefined : undefined;
    if (input.kind === 'organize' && !proposal) throw new Error('organization_proposal_required');
    const proposalItems = proposal ? this.#database.prepare('SELECT scope_address,container_name,source_category,category,target_path,enabled FROM organization_proposal_items WHERE proposal_id=?')
      .all(proposal.id) as ProposalItemRow[] : [];
    const proposalBySource = new Map<string, ProposalItemRow[]>();
    for (const item of proposalItems) proposalBySource.set(item.source_category, [...(proposalBySource.get(item.source_category) ?? []), item]);
    const proposedItem = (candidate: CandidateRow): ProposalItemRow | null => {
      if (input.kind !== 'organize') return null;
      const receiving = new Set((JSON.parse(candidate.receiving_addresses_json) as string[]).map((address) => address.toLowerCase()));
      return (proposalBySource.get(candidate.category) ?? [])
        .filter((item) => !item.scope_address || receiving.has(item.scope_address.toLowerCase()))
        .sort((left, right) => Number(Boolean(right.scope_address)) - Number(Boolean(left.scope_address)) || (left.scope_address ?? '').localeCompare(right.scope_address ?? ''))[0] ?? null;
    };
    const excludedContainerRoles = new Set(['\\all', '\\sent', '\\drafts', '\\trash', '\\junk']);
    const trashDomains = new Set(input.trashSenderDomains.map((domain) => domain.toLowerCase()));
    const actionable = candidates.filter((candidate) => {
      const roles = new Set([
        candidate.special_use?.toLowerCase() ?? '',
        ...(JSON.parse(candidate.container_flags_json) as string[]).map((flag) => flag.toLowerCase()),
      ]);
      if ([...roles].some((role) => excludedContainerRoles.has(role))) return false;
      if (input.kind === 'trash') {
        return trashDomains.has(candidate.sender_domain.toLowerCase()) &&
          !['personal', 'security', 'accounts', 'transactions', 'finance', 'suspicious'].includes(candidate.category);
      }
      const item = proposedItem(candidate);
      // The proposal is the explicit historical-cleanup boundary. Every enabled
      // category is filed and marked read during the approved initial pass;
      // conservative confidence thresholds still apply later to future rules.
      return Boolean(item?.enabled);
    });
    const planId = this.#createId();
    const actionValues = actionable.map((candidate) => {
      const item = proposedItem(candidate);
      const effectiveCategory = item?.category ?? candidate.category;
      const categoryPath = item?.target_path ?? CATEGORY_PRESENTATION[effectiveCategory].folder;
      return {
        ...candidate,
        scopeAddress: item?.scope_address ?? null,
        containerName: item?.container_name ?? null,
        category: effectiveCategory,
        targetPath: input.kind === 'trash' ? 'Trash' : effectiveCategory === 'spam' ? 'Spam' : categoryPath,
        actionKind: input.kind === 'trash' ? 'native_trash' as const : effectiveCategory === 'spam' ? 'native_spam' as const : 'sort_read_archive' as const,
      };
    }).filter((action) => action.actionKind !== 'sort_read_archive' || !isSameProtonFolder(action.source_path, action.targetPath));
    const targetPaths = actionValues
      .filter((action) => action.actionKind === 'sort_read_archive')
      .map((action) => action.targetPath);
    const legacyContainers = existingSetup === 'replace'
      ? (this.#database.prepare(`
          SELECT provider_container_id,delimiter,special_use,message_count
          FROM mail_containers WHERE connection_id=?
          ORDER BY length(provider_container_id) DESC,provider_container_id
        `).all(connectionId) as Array<{
          provider_container_id: string; delimiter: string; special_use: string | null; message_count: number;
        }>).flatMap((container) => {
          if (container.special_use) return [];
          const delimiter = container.delimiter || '/';
          const parts = container.provider_container_id.split(delimiter).filter(Boolean);
          const root = parts[0]?.toLowerCase();
          if (!['folders', 'labels'].includes(root ?? '') || parts.length < 2) return [];
          const providerTargets = targetPaths.map((target) => protonFolderPath(target, delimiter).toLowerCase());
          const path = container.provider_container_id.toLowerCase();
          if (providerTargets.some((target) => target === path || target.startsWith(`${path.toLowerCase()}${delimiter}`))) return [];
          return [{
            id: this.#createId(),
            providerPath: container.provider_container_id,
            kind: root === 'labels' ? 'label' as const : 'folder' as const,
            observedMessages: container.message_count,
          }];
        })
      : [];
    const revision = createHash('sha256').update(JSON.stringify({
      existingSetup,
      actions: actionValues.map((action) => [
        action.canonical_key, action.source_path, action.uid_validity, action.uid, action.targetPath, action.actionKind,
      ]),
      legacyContainers: legacyContainers.map((container) => [container.providerPath, container.observedMessages]),
    })).digest('hex');
    const timestamp = this.#now();
    this.#database.transaction(() => {
      this.#database.prepare("DELETE FROM cleanup_plans WHERE connection_id = ? AND plan_kind = ? AND state = 'draft'").run(connectionId, input.kind);
      this.#database.prepare(`
        INSERT INTO cleanup_plans(
          id, connection_id, analysis_id, revision, state, skipped_count, created_at, plan_kind,
          proposal_id, proposal_revision, existing_setup
        ) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)
      `).run(
        planId, connectionId, analysisId, revision, candidates.length - actionValues.length,
        timestamp, input.kind, proposal?.id ?? null, proposal?.revision ?? null, existingSetup,
      );
      const insert = this.#database.prepare(`
        INSERT INTO cleanup_actions(
          id, plan_id, message_row_id, canonical_key, category, source_path,
          uid_validity, uid, target_path, action_kind, scope_address, container_name,
          state, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
      `);
      for (const action of actionValues) {
        insert.run(
          this.#createId(), planId, action.message_row_id, action.canonical_key, action.category,
          action.source_path, action.uid_validity, action.uid, action.targetPath, action.actionKind,
          action.scopeAddress, action.containerName, timestamp,
        );
      }
      const insertLegacy = this.#database.prepare(`
        INSERT INTO cleanup_legacy_containers(
          id,plan_id,provider_path,container_kind,observed_messages,state,updated_at
        ) VALUES (?,?,?,?,?,'pending',?)
      `);
      for (const container of legacyContainers) {
        insertLegacy.run(
          container.id, planId, container.providerPath, container.kind,
          container.observedMessages, timestamp,
        );
      }
    })();
    return this.get(planId);
  }

  getCurrent(connectionId: string, kind: CleanupPlan['kind'] = 'organize'): CleanupPlan | null {
    const row = this.#database.prepare('SELECT id FROM cleanup_plans WHERE connection_id = ? AND plan_kind = ? ORDER BY rowid DESC LIMIT 1').get(connectionId, kind) as { id: string } | undefined;
    return row ? this.get(row.id) : null;
  }

  planIdForJob(jobId: string): string {
    const row = this.#database.prepare('SELECT id FROM cleanup_plans WHERE job_id = ? OR undo_job_id = ?').get(jobId, jobId) as { id: string } | undefined;
    if (!row) throw new Error('Cleanup plan was not found');
    return row.id;
  }

  get(planId: string): CleanupPlan {
    const row = this.#database.prepare(`
      SELECT cleanup_plans.* FROM cleanup_plans
      JOIN provider_connections pc ON pc.id = cleanup_plans.connection_id
      WHERE cleanup_plans.id = ? AND pc.profile_id = ?
    `).get(planId, this.#profileId) as {
      id: string; connection_id: string; revision: string; state: CleanupPlan['state']; plan_kind: CleanupPlan['kind'];
      proposal_id: string | null; proposal_revision: string | null; existing_setup: 'extend' | 'reuse' | 'replace';
      skipped_count: number; job_id: string | null; undo_job_id: string | null; created_at: string; approved_at: string | null;
    } | undefined;
    if (!row) throw new Error('Cleanup plan was not found');
    const impacts = this.#database.prepare(`
      SELECT
        CASE WHEN container_name IS NULL THEN NULL ELSE scope_address END AS scope_address,
        container_name,category,target_path,action_kind,COUNT(*) AS message_count
      FROM cleanup_actions WHERE plan_id = ?
      GROUP BY
        CASE WHEN container_name IS NULL THEN NULL ELSE scope_address END,
        container_name,category,target_path,action_kind
      ORDER BY CASE WHEN container_name IS NULL THEN 0 ELSE 1 END,container_name,message_count DESC
    `).all(planId) as Array<{ scope_address: string | null; container_name: string | null; category: MailCategory; target_path: string; action_kind: 'sort_read_archive' | 'native_spam' | 'native_trash'; message_count: number }>;
    const actionCount = impacts.reduce((sum, impact) => sum + impact.message_count, 0);
    const requiresRebuild = Boolean(this.#database.prepare(`
      SELECT 1 FROM cleanup_actions ca
      JOIN cleanup_plans cp ON cp.id=ca.plan_id
      JOIN mail_containers mc ON mc.connection_id=cp.connection_id
        AND lower(mc.provider_container_id)=lower(ca.source_path)
      WHERE ca.plan_id=? AND ca.state!='succeeded'
        AND (
          lower(COALESCE(mc.special_use,''))='\\all'
          OR lower(mc.flags_json) LIKE '%\\\\all%'
        )
      LIMIT 1
    `).get(planId));
    return cleanupPlanSchema.parse({
      id: row.id,
      connectionId: row.connection_id,
      kind: row.plan_kind,
      existingSetup: row.existing_setup,
      revision: row.revision,
      proposalId: row.proposal_id,
      proposalRevision: row.proposal_revision,
      state: row.state,
      createdAt: row.created_at,
      approvedAt: row.approved_at,
      actionCount,
      spamCount: impacts.filter((impact) => impact.action_kind === 'native_spam').reduce((sum, impact) => sum + impact.message_count, 0),
      trashCount: impacts.filter((impact) => impact.action_kind === 'native_trash').reduce((sum, impact) => sum + impact.message_count, 0),
      skippedCount: row.skipped_count,
      requiresRebuild,
      impacts: impacts.map((impact) => ({
        scopeAddress: impact.scope_address,
        containerName: impact.container_name,
        category: impact.category,
        targetFolder: impact.target_path,
        action: impact.action_kind,
        messageCount: impact.message_count,
      })),
      job: row.job_id ? this.#jobs.getProgress(row.job_id) : null,
      undoJob: row.undo_job_id ? this.#jobs.getProgress(row.undo_job_id) : null,
      failedActions: (this.#database.prepare(`
        SELECT id,target_path,state,error_code FROM cleanup_actions
        WHERE plan_id=? AND state IN ('failed','verification_mismatch') ORDER BY rowid
      `).all(planId) as Array<{ id: string; target_path: string; state: 'failed' | 'verification_mismatch'; error_code: string | null }>).map((action) => ({
        id: action.id,
        targetPath: action.target_path,
        state: action.state,
        errorCode: action.error_code,
      })),
      legacyContainers: (this.#database.prepare(`
        SELECT id,provider_path,container_kind,observed_messages,state,error_code
        FROM cleanup_legacy_containers WHERE plan_id=?
        ORDER BY length(provider_path) DESC,provider_path
      `).all(planId) as Array<{
        id: string; provider_path: string; container_kind: 'folder' | 'label'; observed_messages: number;
        state: CleanupLegacyContainerRecord['state']; error_code: string | null;
      }>).map((container) => ({
        id: container.id,
        providerPath: container.provider_path,
        kind: container.container_kind,
        observedMessages: container.observed_messages,
        state: container.state,
        errorCode: container.error_code,
      })),
    });
  }

  assertMutableSources(planId: string): void {
    if (this.get(planId).requiresRebuild) {
      throw new Error('cleanup_plan_virtual_source_rebuild_required');
    }
  }

  approve(planId: string, revision: string): CleanupPlan {
    const plan = this.get(planId);
    if (plan.state !== 'draft' || plan.revision !== revision) throw new Error('cleanup_plan_changed');
    const planScope = this.#database.prepare('SELECT connection_id,plan_kind,proposal_id,proposal_revision FROM cleanup_plans WHERE id=?').get(planId) as { connection_id: string; plan_kind: CleanupPlan['kind']; proposal_id: string | null; proposal_revision: string | null };
    if (planScope.plan_kind === 'organize') {
      const current = this.#database.prepare("SELECT id,revision FROM organization_proposals WHERE profile_id=? AND provider='proton' AND connection_id=? AND state='draft' ORDER BY updated_at DESC,rowid DESC LIMIT 1")
        .get(this.#profileId, planScope.connection_id) as { id: string; revision: string } | undefined;
      if (!current || current.id !== planScope.proposal_id || current.revision !== planScope.proposal_revision) throw new Error('cleanup_plan_changed');
    }
    const actions = this.#database.prepare('SELECT id FROM cleanup_actions WHERE plan_id = ? ORDER BY rowid').all(planId) as Array<{ id: string }>;
    const legacyContainers = this.#database.prepare('SELECT id FROM cleanup_legacy_containers WHERE plan_id=? ORDER BY rowid')
      .all(planId) as Array<{ id: string }>;
    const job = this.#jobs.createJob({
      profileId: this.#profileId,
      kind: 'proton-cleanup',
      idempotencyKey: `cleanup:${planId}:${revision}`,
      itemKeys: [
        ...actions.map((action) => action.id),
        ...legacyContainers.map((container) => `retire:${container.id}`),
      ],
    });
    this.#database.prepare(`
      UPDATE cleanup_plans SET state = 'approved', approved_at = ?, job_id = ? WHERE id = ?
    `).run(this.#now(), job.id, planId);
    return this.get(planId);
  }

  action(actionId: string): CleanupActionRecord {
    const row = this.#database.prepare(`
      SELECT ca.*, cp.connection_id FROM cleanup_actions ca
      JOIN cleanup_plans cp ON cp.id = ca.plan_id
      JOIN provider_connections pc ON pc.id = cp.connection_id
      WHERE ca.id = ? AND pc.profile_id = ?
    `).get(actionId, this.#profileId) as Record<string, unknown> | undefined;
    if (!row) throw new Error('Cleanup action was not found');
    return {
      id: String(row.id),
      planId: String(row.plan_id),
      messageRowId: String(row.message_row_id),
      connectionId: String(row.connection_id),
      category: row.category as MailCategory,
      sourcePath: String(row.source_path),
      uidValidity: String(row.uid_validity),
      uid: Number(row.uid),
      targetPath: String(row.target_path),
      actionKind: row.action_kind as CleanupActionRecord['actionKind'],
      priorFlags: row.prior_flags_json ? JSON.parse(String(row.prior_flags_json)) as string[] : [],
      resultingPath: row.resulting_path ? String(row.resulting_path) : null,
      resultingUidValidity: row.resulting_uid_validity ? String(row.resulting_uid_validity) : null,
      resultingUid: row.resulting_uid ? Number(row.resulting_uid) : null,
    };
  }

  legacyContainer(containerId: string): CleanupLegacyContainerRecord {
    const row = this.#database.prepare(`
      SELECT clc.*,cp.id AS plan_id FROM cleanup_legacy_containers clc
      JOIN cleanup_plans cp ON cp.id=clc.plan_id
      JOIN provider_connections pc ON pc.id=cp.connection_id
      WHERE clc.id=? AND pc.profile_id=?
    `).get(containerId, this.#profileId) as Record<string, unknown> | undefined;
    if (!row) throw new Error('Cleanup legacy container was not found');
    return {
      id: String(row.id),
      planId: String(row.plan_id),
      providerPath: String(row.provider_path),
      kind: row.container_kind as CleanupLegacyContainerRecord['kind'],
      observedMessages: Number(row.observed_messages),
      state: row.state as CleanupLegacyContainerRecord['state'],
    };
  }

  markLegacyContainer(
    containerId: string,
    state: CleanupLegacyContainerRecord['state'],
    errorCode: string | null = null,
  ): void {
    this.#database.prepare(`
      UPDATE cleanup_legacy_containers SET state=?,error_code=?,updated_at=? WHERE id=?
    `).run(state, errorCode, this.#now(), containerId);
  }

  targets(planId: string): CleanupTargetRecord[] {
    const plan = this.#database.prepare(`
      SELECT cleanup_plans.id FROM cleanup_plans
      JOIN provider_connections pc ON pc.id=cleanup_plans.connection_id
      WHERE cleanup_plans.id=? AND pc.profile_id=?
    `).get(planId, this.#profileId);
    if (!plan) throw new Error('Cleanup plan was not found');
    return (this.#database.prepare(`
      SELECT DISTINCT target_path,action_kind FROM cleanup_actions
      WHERE plan_id=? ORDER BY target_path,action_kind
    `).all(planId) as Array<{ target_path: string; action_kind: CleanupActionRecord['actionKind'] }>).map((row) => ({
      targetPath: row.target_path,
      actionKind: row.action_kind,
    }));
  }

  markRunning(actionId: string, priorFlags: readonly string[]): void {
    this.#database.prepare(`
      UPDATE cleanup_actions SET state = 'running',
        prior_flags_json = COALESCE(prior_flags_json, ?), updated_at = ? WHERE id = ?
    `).run(JSON.stringify(priorFlags), this.#now(), actionId);
  }

  markResult(
    actionId: string,
    state: 'succeeded' | 'failed' | 'verification_mismatch',
    errorCode: string | null = null,
    receipt?: { path: string; uidValidity: string; uid: number; flags: readonly string[] },
  ): void {
    const timestamp = this.#now();
    this.#database.transaction(() => {
      this.#database.prepare(`
        UPDATE cleanup_actions SET state=?,error_code=?,resulting_path=?,resulting_uid_validity=?,
          resulting_uid=?,resulting_flags_json=?,updated_at=? WHERE id=?
      `).run(
        state, errorCode, receipt?.path ?? null, receipt?.uidValidity ?? null, receipt?.uid ?? null,
        receipt ? JSON.stringify([...receipt.flags].sort()) : null, timestamp, actionId,
      );
      if (!receipt || state !== 'succeeded') return;
      this.#syncIndexedLocation(actionId, receipt, timestamp);
    })();
  }

  markMovePending(actionId: string, pointer: { path: string; uid: number }): void {
    this.#database.prepare(`
      UPDATE cleanup_actions SET state='running',error_code=NULL,resulting_path=?,
        resulting_uid=?,resulting_uid_validity=NULL,resulting_flags_json=NULL,updated_at=?
      WHERE id=?
    `).run(pointer.path, pointer.uid, this.#now(), actionId);
  }

  markUndoSucceeded(
    actionId: string,
    receipt: { path: string; uidValidity: string; uid: number; flags: readonly string[] },
  ): void {
    const timestamp = this.#now();
    this.#database.transaction(() => {
      this.#database.prepare(
        "UPDATE cleanup_actions SET undo_state='succeeded',undo_error_code=NULL,updated_at=? WHERE id=?",
      ).run(timestamp, actionId);
      this.#syncIndexedLocation(actionId, receipt, timestamp);
    })();
  }

  #syncIndexedLocation(
    actionId: string,
    receipt: { path: string; uidValidity: string; uid: number; flags: readonly string[] },
    timestamp: string,
  ): void {
      const action = this.action(actionId);
      let container = this.#database.prepare(`
        SELECT id FROM mail_containers
        WHERE connection_id=? AND lower(provider_container_id)=lower(?)
      `).get(action.connectionId, receipt.path) as { id: string } | undefined;
      if (!container) {
        container = { id: this.#createId() };
        const specialUse = action.actionKind === 'native_spam' ? '\\Junk'
          : action.actionKind === 'native_trash' ? '\\Trash'
          : null;
        this.#database.prepare(`
          INSERT INTO mail_containers(
            id,connection_id,profile_id,provider_container_id,display_name,delimiter,
            special_use,flags_json,message_count,unread_count,uid_validity,uid_next,observed_at
          ) VALUES (?,?,?,?,?,'/',?,'[]',0,0,?,?,?)
        `).run(
          container.id, action.connectionId, this.#profileId, receipt.path,
          receipt.path.split('/').at(-1) ?? receipt.path, specialUse,
          receipt.uidValidity, receipt.uid + 1, timestamp,
        );
      }
      this.#database.prepare(`
        UPDATE mail_containers SET uid_validity=?,uid_next=MAX(uid_next,?),observed_at=?
        WHERE id=?
      `).run(receipt.uidValidity, receipt.uid + 1, timestamp, container.id);
      const occupied = this.#database.prepare(`
        SELECT id FROM indexed_messages
        WHERE connection_id=? AND container_id=? AND uid_validity=? AND uid=?
      `).get(action.connectionId, container.id, receipt.uidValidity, receipt.uid) as { id: string } | undefined;
      if (!occupied || occupied.id === action.messageRowId) {
        this.#database.prepare(`
          UPDATE indexed_messages SET container_id=?,uid_validity=?,uid=?,flags_json=?,indexed_at=?
          WHERE id=? AND connection_id=?
        `).run(
          container.id, receipt.uidValidity, receipt.uid,
          JSON.stringify([...receipt.flags].sort()), timestamp,
          action.messageRowId, action.connectionId,
        );
      }
  }

  retry(planId: string, actionIds: readonly string[]): CleanupPlan {
    const plan = this.get(planId);
    if (!plan.job) throw new Error('cleanup_job_missing');
    this.#jobs.retryItems(plan.job.id, actionIds);
    const placeholders = actionIds.map(() => '?').join(',');
    this.#database.prepare(`
      UPDATE cleanup_actions SET state='pending',error_code=NULL,updated_at=?
      WHERE plan_id=? AND id IN (${placeholders})
    `).run(this.#now(), planId, ...actionIds);
    this.#database.prepare("UPDATE cleanup_plans SET state='approved' WHERE id=?").run(planId);
    return this.get(planId);
  }

  prepareUndo(planId: string): CleanupPlan {
    const plan = this.get(planId);
    if (plan.job?.state !== 'succeeded') throw new Error('cleanup_undo_not_ready');
    const actions = this.#database.prepare(`
      SELECT id FROM cleanup_actions WHERE plan_id=? AND state='succeeded'
        AND resulting_path IS NOT NULL AND resulting_uid_validity IS NOT NULL AND resulting_uid IS NOT NULL
      ORDER BY rowid DESC
    `).all(planId) as Array<{ id: string }>;
    if (!actions.length) throw new Error('cleanup_undo_receipts_missing');
    const job = this.#jobs.createJob({
      profileId: this.#profileId,
      kind: 'proton-cleanup',
      idempotencyKey: `cleanup-undo:${planId}:${plan.revision}`,
      itemKeys: actions.map((action) => `undo:${action.id}`),
    });
    this.#database.transaction(() => {
      this.#database.prepare('UPDATE cleanup_plans SET undo_job_id=? WHERE id=?').run(job.id, planId);
      this.#database.prepare("UPDATE cleanup_actions SET undo_state='pending',undo_error_code=NULL WHERE plan_id=? AND state='succeeded'").run(planId);
    })();
    return this.get(planId);
  }

  markUndo(actionId: string, state: 'running' | 'succeeded' | 'failed' | 'verification_mismatch', errorCode: string | null = null): void {
    this.#database.prepare('UPDATE cleanup_actions SET undo_state=?,undo_error_code=?,updated_at=? WHERE id=?')
      .run(state, errorCode, this.#now(), actionId);
  }

  syncPlanState(planId: string): CleanupPlan {
    const plan = this.get(planId);
    const state = plan.job?.state === 'succeeded' ? 'completed'
      : plan.job && ['failed', 'verification_mismatch'].includes(plan.job.state) ? 'failed'
      : plan.job?.state === 'running' ? 'executing'
      : plan.state;
    this.#database.prepare('UPDATE cleanup_plans SET state = ? WHERE id = ?').run(state, planId);
    return this.get(planId);
  }
}
