import type BetterSqlite3 from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import type { JobRepository } from '../jobs/job-repository';
import { CATEGORY_PRESENTATION } from '../../core/classification/mail-classifier';
import type { MailCategory } from '../../shared/contracts/analysis';
import { type CleanupPlan, cleanupPlanSchema, type GenerateCleanupInput } from '../../shared/contracts/cleanup';

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
  uid_validity: string;
  uid: number;
}

export interface CleanupActionRecord {
  id: string;
  planId: string;
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
    const candidates = this.#database.prepare(`
      SELECT ma.id AS analysis_id, mc.message_row_id, mc.canonical_key,
             mc.category, mc.sender_domain, mc.confidence, mc.receiving_addresses_json, im.uid_validity, im.uid,
             containers.provider_container_id AS source_path, containers.special_use
      FROM mailbox_analyses ma
      JOIN message_classifications mc ON mc.analysis_id = ma.id
      JOIN indexed_messages im ON im.id = mc.message_row_id
      JOIN mail_containers containers ON containers.id = im.container_id
      WHERE ma.connection_id = ? AND ma.profile_id = ?
      ORDER BY mc.canonical_key
    `).all(connectionId, this.#profileId) as CandidateRow[];
    if (!candidates.length) throw new Error('mailbox_analysis_required');
    const analysisId = candidates[0]!.analysis_id;
    const excludedSpecialUse = new Set(['\\all', '\\sent', '\\drafts', '\\trash', '\\junk']);
    const trashDomains = new Set(input.trashSenderDomains.map((domain) => domain.toLowerCase()));
    const actionable = candidates.filter((candidate) => {
      if (excludedSpecialUse.has(candidate.special_use?.toLowerCase() ?? '')) return false;
      if (input.kind === 'trash') {
        return trashDomains.has(candidate.sender_domain.toLowerCase()) &&
          !['personal', 'security', 'accounts', 'transactions', 'finance', 'suspicious'].includes(candidate.category);
      }
      return candidate.confidence >= 0.7 && !['other', 'suspicious', 'personal'].includes(candidate.category);
    });
    const planId = this.#createId();
    const actionValues = actionable.map((candidate) => {
      const receivingAddresses = JSON.parse(candidate.receiving_addresses_json) as string[];
      const container = receivingAddresses.map((address) => input.containers[address]).find(Boolean);
      const categoryPath = CATEGORY_PRESENTATION[candidate.category].folder;
      return {
        ...candidate,
        targetPath: input.kind === 'trash' ? 'Trash' : candidate.category === 'spam' ? 'Spam' : container ? `${container}/${categoryPath}` : categoryPath,
        actionKind: input.kind === 'trash' ? 'native_trash' as const : candidate.category === 'spam' ? 'native_spam' as const : 'sort_read_archive' as const,
      };
    });
    const revision = createHash('sha256').update(JSON.stringify(actionValues.map((action) => [
      action.canonical_key, action.source_path, action.uid_validity, action.uid, action.targetPath, action.actionKind,
    ]))).digest('hex');
    const timestamp = this.#now();
    this.#database.transaction(() => {
      this.#database.prepare("DELETE FROM cleanup_plans WHERE connection_id = ? AND plan_kind = ? AND state = 'draft'").run(connectionId, input.kind);
      this.#database.prepare(`
        INSERT INTO cleanup_plans(
          id, connection_id, analysis_id, revision, state, skipped_count, created_at, plan_kind
        ) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)
      `).run(planId, connectionId, analysisId, revision, candidates.length - actionValues.length, timestamp, input.kind);
      const insert = this.#database.prepare(`
        INSERT INTO cleanup_actions(
          id, plan_id, message_row_id, canonical_key, category, source_path,
          uid_validity, uid, target_path, action_kind, state, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
      `);
      for (const action of actionValues) {
        insert.run(
          this.#createId(), planId, action.message_row_id, action.canonical_key, action.category,
          action.source_path, action.uid_validity, action.uid, action.targetPath, action.actionKind, timestamp,
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
      skipped_count: number; job_id: string | null; undo_job_id: string | null; created_at: string; approved_at: string | null;
    } | undefined;
    if (!row) throw new Error('Cleanup plan was not found');
    const impacts = this.#database.prepare(`
      SELECT category, target_path, action_kind, COUNT(*) AS message_count
      FROM cleanup_actions WHERE plan_id = ?
      GROUP BY category, target_path, action_kind ORDER BY message_count DESC
    `).all(planId) as Array<{ category: MailCategory; target_path: string; action_kind: 'sort_read_archive' | 'native_spam' | 'native_trash'; message_count: number }>;
    const actionCount = impacts.reduce((sum, impact) => sum + impact.message_count, 0);
    return cleanupPlanSchema.parse({
      id: row.id,
      connectionId: row.connection_id,
      kind: row.plan_kind,
      revision: row.revision,
      state: row.state,
      createdAt: row.created_at,
      approvedAt: row.approved_at,
      actionCount,
      spamCount: impacts.filter((impact) => impact.action_kind === 'native_spam').reduce((sum, impact) => sum + impact.message_count, 0),
      trashCount: impacts.filter((impact) => impact.action_kind === 'native_trash').reduce((sum, impact) => sum + impact.message_count, 0),
      skippedCount: row.skipped_count,
      impacts: impacts.map((impact) => ({
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
    });
  }

  approve(planId: string, revision: string): CleanupPlan {
    const plan = this.get(planId);
    if (plan.state !== 'draft' || plan.revision !== revision) throw new Error('cleanup_plan_changed');
    const actions = this.#database.prepare('SELECT id FROM cleanup_actions WHERE plan_id = ? ORDER BY rowid').all(planId) as Array<{ id: string }>;
    const job = this.#jobs.createJob({
      profileId: this.#profileId,
      kind: 'proton-cleanup',
      idempotencyKey: `cleanup:${planId}:${revision}`,
      itemKeys: actions.map((action) => action.id),
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

  markRunning(actionId: string, priorFlags: readonly string[]): void {
    this.#database.prepare(`
      UPDATE cleanup_actions SET state = 'running', prior_flags_json = ?, updated_at = ? WHERE id = ?
    `).run(JSON.stringify(priorFlags), this.#now(), actionId);
  }

  markResult(
    actionId: string,
    state: 'succeeded' | 'failed' | 'verification_mismatch',
    errorCode: string | null = null,
    receipt?: { path: string; uidValidity: string; uid: number; flags: readonly string[] },
  ): void {
    this.#database.prepare(`
      UPDATE cleanup_actions SET state=?,error_code=?,resulting_path=?,resulting_uid_validity=?,
        resulting_uid=?,resulting_flags_json=?,updated_at=? WHERE id=?
    `).run(
      state, errorCode, receipt?.path ?? null, receipt?.uidValidity ?? null, receipt?.uid ?? null,
      receipt ? JSON.stringify([...receipt.flags].sort()) : null, this.#now(), actionId,
    );
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
