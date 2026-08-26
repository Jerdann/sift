import type BetterSqlite3 from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import type { MailCategory } from '../../shared/contracts/analysis';
import { gmailOrganizationPlanSchema, type GmailOrganizationPlan } from '../../shared/contracts/gmail-organize';
import type { GmailConnectionSummary } from '../../shared/contracts/gmail';
import type { JobRepository } from '../jobs/job-repository';

interface ProposalItemRow {
  id: string;
  scope_address: string | null;
  source_category: MailCategory;
  category: MailCategory;
  target_path: string;
  enabled: number;
  confidence: number;
}

interface MessageRow {
  gmail_message_id: string;
  sender_domain: string;
  received_at: string | null;
  source_category: MailCategory;
  confidence: number;
  receiving_addresses_json: string;
  label_ids_json: string;
}

export interface GmailHistoryBatchRecord {
  id: string;
  planId: string;
  connectionId: string;
  targetLabel: string;
  markRead: boolean;
  archive: boolean;
  spam: boolean;
  trash: boolean;
  messageIds: string[];
  priorLabels: Record<string, string[]>;
  resultingLabels: Record<string, string[]> | null;
}

const strings = (value: string): string[] => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string').sort() : [];
  } catch { return []; }
};

const labelMap = (value: string | null): Record<string, string[]> | null => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return Object.fromEntries(Object.entries(parsed).map(([id, labels]) => [id, Array.isArray(labels) ? labels.filter((label): label is string => typeof label === 'string').sort() : []]));
  } catch { return null; }
};

export class GmailOrganizationRepository {
  readonly #database: BetterSqlite3.Database;
  readonly #jobs: JobRepository;
  readonly #profileId: string;
  readonly #now: () => string;
  readonly #createId: () => string;

  constructor(database: BetterSqlite3.Database, jobs: JobRepository, profileId: string, options: { now?: () => string; createId?: () => string } = {}) {
    this.#database = database;
    this.#jobs = jobs;
    this.#profileId = profileId;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#createId = options.createId ?? randomUUID;
  }

  generate(connection: GmailConnectionSummary, input: { kind?: 'organize' | 'trash'; senderDomains?: readonly string[]; olderThanDays?: number } = {}): GmailOrganizationPlan {
    const kind = input.kind ?? 'organize';
    const proposal = kind === 'organize'
      ? this.#database.prepare("SELECT * FROM organization_proposals WHERE profile_id=? AND provider='gmail' AND connection_id=? AND state='draft' ORDER BY updated_at DESC,rowid DESC LIMIT 1")
        .get(this.#profileId, connection.id) as Record<string, unknown> | undefined
      : undefined;
    if (kind === 'organize' && !proposal) throw new Error('organization_proposal_required');
    const analysis = proposal ?? this.#database.prepare('SELECT id analysis_id FROM gmail_mailbox_analyses WHERE profile_id=? AND connection_id=?').get(this.#profileId, connection.id) as Record<string, unknown> | undefined;
    if (!analysis) throw new Error('gmail_analysis_required');
    const items = proposal ? this.#database.prepare('SELECT * FROM organization_proposal_items WHERE proposal_id=? ORDER BY scope_address,source_category')
      .all(proposal.id) as ProposalItemRow[] : [];
    const bySource = new Map<string, ProposalItemRow[]>();
    for (const item of items) bySource.set(item.source_category, [...(bySource.get(item.source_category) ?? []), item]);
    const messages = this.#database.prepare(`
      SELECT gim.gmail_message_id,gmc.sender_domain,gim.received_at,gmc.category source_category,gmc.confidence,
        gmc.receiving_addresses_json,gim.label_ids_json
      FROM gmail_message_classifications gmc
      JOIN gmail_indexed_messages gim ON gim.id=gmc.message_row_id
      WHERE gmc.analysis_id=? ORDER BY gim.gmail_message_id
    `).all(analysis.analysis_id) as MessageRow[];
    const trashDomains = new Set((input.senderDomains ?? []).map((domain) => domain.toLowerCase()));
    const trashCutoff = Date.parse(this.#now()) - (input.olderThanDays ?? 180) * 86_400_000;
    const trashProtected = new Set<MailCategory>(['security', 'accounts', 'transactions', 'finance', 'personal', 'suspicious']);
    const selected = new Map<string, { item: ProposalItemRow; message: MessageRow }>();
    let skipped = 0;
    for (const message of messages) {
      const addresses = new Set(strings(message.receiving_addresses_json).map((address) => address.toLowerCase()));
      const candidates = (bySource.get(message.source_category) ?? [])
        .filter((item) => !item.scope_address || addresses.has(item.scope_address.toLowerCase()))
        .sort((left, right) => Number(Boolean(right.scope_address)) - Number(Boolean(left.scope_address)) || (left.scope_address ?? '').localeCompare(right.scope_address ?? ''));
      const item = kind === 'trash'
        ? trashDomains.has(message.sender_domain.toLowerCase())
          && !trashProtected.has(message.source_category)
          && Boolean(message.received_at)
          && Date.parse(message.received_at!) < trashCutoff
          && !strings(message.label_ids_json).some((label) => label === 'TRASH' || label === 'SPAM')
          ? { id: `trash\0${message.sender_domain}\0${[...addresses].sort()[0] ?? ''}\0${message.source_category}`, scope_address: [...addresses].sort()[0] ?? null, source_category: message.source_category, category: message.source_category, target_path: 'TRASH', enabled: 1, confidence: message.confidence }
          : undefined
        : candidates[0];
      if (!item || !item.enabled) {
        skipped += 1;
        continue;
      }
      if (selected.has(message.gmail_message_id)) { skipped += 1; continue; }
      selected.set(message.gmail_message_id, { item, message });
    }
    const groups = new Map<string, { item: ProposalItemRow; messages: MessageRow[] }>();
    for (const value of selected.values()) {
      const group = groups.get(value.item.id) ?? { item: value.item, messages: [] };
      group.messages.push(value.message);
      groups.set(value.item.id, group);
    }
    const planId = this.#createId();
    const now = this.#now();
    const normalized = [...groups.values()].map((group) => ({ item: group.item, messages: group.messages.sort((left, right) => left.gmail_message_id.localeCompare(right.gmail_message_id)) }))
      .sort((left, right) => left.item.id.localeCompare(right.item.id));
    const revision = createHash('sha256').update(JSON.stringify({
      kind,
      olderThanDays: kind === 'trash' ? input.olderThanDays ?? 180 : null,
      proposalRevision: proposal?.revision ?? null,
      groups: normalized.map((group) => [group.item.id, group.item.category, group.item.target_path, group.messages.map((message) => [message.gmail_message_id, strings(message.label_ids_json)])]),
    })).digest('hex');
    this.#database.transaction(() => {
      this.#database.prepare('DELETE FROM gmail_organization_plans WHERE connection_id=? AND plan_kind=?').run(connection.id, kind);
      this.#database.prepare(`
        INSERT INTO gmail_organization_plans(
          id,connection_id,analysis_id,revision,state,skipped_ambiguous_streams,created_at,proposal_id,proposal_revision,plan_kind
        ) VALUES (?,?,?,?,'draft',?,?,?,?,?)
      `).run(planId, connection.id, analysis.analysis_id, revision, skipped, now, proposal?.id ?? null, proposal?.revision ?? null, kind);
      const insertImpact = this.#database.prepare(`
        INSERT INTO gmail_history_impacts(id,plan_id,scope_address,source_category,category,target_label,mark_read,archive,spam,confidence,existing_messages,trash)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      `);
      const insertBatch = this.#database.prepare(`
        INSERT INTO gmail_history_batches(id,plan_id,impact_id,message_ids_json,prior_labels_json,state,updated_at)
        VALUES (?,?,?,?,?,'pending',?)
      `);
      for (const group of normalized) {
        const impactId = this.#createId();
        const spam = kind !== 'trash' && group.item.category === 'spam';
        insertImpact.run(
          impactId, planId, group.item.scope_address, group.item.source_category, group.item.category,
          kind === 'trash' ? 'TRASH' : spam ? 'SPAM' : group.item.target_path, 1, 1, spam ? 1 : 0,
          group.item.confidence, group.messages.length, kind === 'trash' ? 1 : 0,
        );
        for (let offset = 0; offset < group.messages.length; offset += 100) {
          const batch = group.messages.slice(offset, offset + 100);
          insertBatch.run(
            this.#createId(), planId, impactId,
            JSON.stringify(batch.map((message) => message.gmail_message_id)),
            JSON.stringify(Object.fromEntries(batch.map((message) => [message.gmail_message_id, strings(message.label_ids_json)]))),
            now,
          );
        }
      }
    })();
    return this.get(connection.id, kind)!;
  }

  get(connectionId: string, kind: GmailOrganizationPlan['kind'] = 'organize'): GmailOrganizationPlan | null {
    const row = this.#database.prepare(`
      SELECT gop.* FROM gmail_organization_plans gop
      JOIN gmail_connections gc ON gc.id=gop.connection_id
      WHERE gop.connection_id=? AND gc.profile_id=? AND gop.plan_kind=? ORDER BY gop.rowid DESC LIMIT 1
    `).get(connectionId, this.#profileId, kind) as Record<string, unknown> | undefined;
    return row ? this.#plan(row) : null;
  }

  getById(planId: string): GmailOrganizationPlan {
    const row = this.#database.prepare(`
      SELECT gop.* FROM gmail_organization_plans gop JOIN gmail_connections gc ON gc.id=gop.connection_id
      WHERE gop.id=? AND gc.profile_id=?
    `).get(planId, this.#profileId) as Record<string, unknown> | undefined;
    if (!row) throw new Error('gmail_history_plan_not_found');
    return this.#plan(row);
  }

  approve(connectionId: string, planId: string, revision: string): GmailOrganizationPlan {
    const plan = this.getById(planId);
    if (plan.state !== 'draft' || plan.revision !== revision) throw new Error('gmail_plan_stale');
    if (plan.kind === 'organize') {
      const currentProposal = this.#database.prepare("SELECT id,revision FROM organization_proposals WHERE profile_id=? AND provider='gmail' AND connection_id=? AND state='draft' ORDER BY updated_at DESC,rowid DESC LIMIT 1")
        .get(this.#profileId, connectionId) as { id: string; revision: string } | undefined;
      if (!currentProposal || currentProposal.id !== plan.proposalId || currentProposal.revision !== plan.proposalRevision) throw new Error('gmail_plan_stale');
    }
    const batches = this.#database.prepare('SELECT id FROM gmail_history_batches WHERE plan_id=? ORDER BY rowid').all(planId) as Array<{ id: string }>;
    const job = this.#jobs.createJob({ profileId: this.#profileId, kind: 'gmail-history', idempotencyKey: `gmail-history:${planId}:${revision}`, itemKeys: batches.map((batch) => batch.id) });
    this.#database.prepare("UPDATE gmail_organization_plans SET state='approved',approved_at=?,job_id=? WHERE id=? AND connection_id=?")
      .run(this.#now(), job.id, planId, connectionId);
    return this.getById(planId);
  }

  planIdForJob(jobId: string): string {
    const row = this.#database.prepare('SELECT id FROM gmail_organization_plans WHERE job_id=? OR undo_job_id=?').get(jobId, jobId) as { id: string } | undefined;
    if (!row) throw new Error('gmail_history_plan_not_found');
    return row.id;
  }

  batch(batchId: string): GmailHistoryBatchRecord {
    const row = this.#database.prepare(`
      SELECT ghb.*,ghi.target_label,ghi.mark_read,ghi.archive,ghi.spam,ghi.trash,gop.connection_id
      FROM gmail_history_batches ghb JOIN gmail_history_impacts ghi ON ghi.id=ghb.impact_id
      JOIN gmail_organization_plans gop ON gop.id=ghb.plan_id JOIN gmail_connections gc ON gc.id=gop.connection_id
      WHERE ghb.id=? AND gc.profile_id=?
    `).get(batchId, this.#profileId) as Record<string, unknown> | undefined;
    if (!row) throw new Error('gmail_history_batch_not_found');
    return {
      id: String(row.id), planId: String(row.plan_id), connectionId: String(row.connection_id), targetLabel: String(row.target_label),
      markRead: Boolean(row.mark_read), archive: Boolean(row.archive), spam: Boolean(row.spam), trash: Boolean(row.trash),
      messageIds: strings(String(row.message_ids_json)), priorLabels: labelMap(String(row.prior_labels_json)) ?? {},
      resultingLabels: labelMap(row.resulting_labels_json ? String(row.resulting_labels_json) : null),
    };
  }

  markBatch(batchId: string, state: 'running' | 'succeeded' | 'failed' | 'verification_mismatch', errorCode: string | null = null, resultingLabels?: Record<string, string[]>): void {
    this.#database.prepare('UPDATE gmail_history_batches SET state=?,error_code=?,resulting_labels_json=COALESCE(?,resulting_labels_json),updated_at=? WHERE id=?')
      .run(state, errorCode, resultingLabels ? JSON.stringify(resultingLabels) : null, this.#now(), batchId);
  }

  syncIndexedLabels(connectionId: string, labels: Readonly<Record<string, readonly string[]>>): void {
    const update = this.#database.prepare('UPDATE gmail_indexed_messages SET label_ids_json=? WHERE connection_id=? AND gmail_message_id=?');
    this.#database.transaction(() => {
      for (const [messageId, messageLabels] of Object.entries(labels)) update.run(JSON.stringify([...messageLabels].sort()), connectionId, messageId);
    })();
  }

  retry(planId: string, batchIds: readonly string[]): GmailOrganizationPlan {
    const plan = this.getById(planId);
    if (!plan.job) throw new Error('gmail_history_job_missing');
    this.#jobs.retryItems(plan.job.id, batchIds);
    const placeholders = batchIds.map(() => '?').join(',');
    this.#database.prepare(`UPDATE gmail_history_batches SET state='pending',error_code=NULL,updated_at=? WHERE plan_id=? AND id IN (${placeholders})`)
      .run(this.#now(), planId, ...batchIds);
    this.#database.prepare("UPDATE gmail_organization_plans SET state='approved' WHERE id=?").run(planId);
    return this.getById(planId);
  }

  prepareUndo(planId: string): GmailOrganizationPlan {
    const plan = this.getById(planId);
    if (plan.job?.state !== 'succeeded') throw new Error('gmail_history_undo_not_ready');
    const batches = this.#database.prepare("SELECT id FROM gmail_history_batches WHERE plan_id=? AND state='succeeded' AND resulting_labels_json IS NOT NULL ORDER BY rowid DESC")
      .all(planId) as Array<{ id: string }>;
    if (!batches.length) throw new Error('gmail_history_undo_receipts_missing');
    const job = this.#jobs.createJob({ profileId: this.#profileId, kind: 'gmail-history', idempotencyKey: `gmail-history-undo:${planId}:${plan.revision}`, itemKeys: batches.map((batch) => `undo:${batch.id}`) });
    this.#database.transaction(() => {
      this.#database.prepare('UPDATE gmail_organization_plans SET undo_job_id=? WHERE id=?').run(job.id, planId);
      this.#database.prepare("UPDATE gmail_history_batches SET undo_state='pending',undo_error_code=NULL WHERE plan_id=? AND state='succeeded'").run(planId);
    })();
    return this.getById(planId);
  }

  markUndo(batchId: string, state: 'running' | 'succeeded' | 'failed' | 'verification_mismatch', errorCode: string | null = null): void {
    this.#database.prepare('UPDATE gmail_history_batches SET undo_state=?,undo_error_code=?,updated_at=? WHERE id=?').run(state, errorCode, this.#now(), batchId);
  }

  sync(planId: string): GmailOrganizationPlan {
    const plan = this.getById(planId);
    const state = plan.job?.state === 'succeeded' ? 'completed'
      : plan.job && ['failed', 'verification_mismatch'].includes(plan.job.state) ? 'failed'
      : plan.job?.state === 'running' ? 'running' : plan.state;
    this.#database.prepare('UPDATE gmail_organization_plans SET state=? WHERE id=?').run(state, planId);
    return this.getById(planId);
  }

  #plan(row: Record<string, unknown>): GmailOrganizationPlan {
    const impacts = this.#database.prepare('SELECT * FROM gmail_history_impacts WHERE plan_id=? ORDER BY existing_messages DESC,target_label').all(row.id) as Array<Record<string, unknown>>;
    const batches = this.#database.prepare('SELECT * FROM gmail_history_batches WHERE plan_id=? ORDER BY rowid').all(row.id) as Array<Record<string, unknown>>;
    const impactState = (impactId: string) => {
      const states = batches.filter((batch) => batch.impact_id === impactId).map((batch) => String(batch.state));
      if (states.includes('verification_mismatch')) return 'verification_mismatch';
      if (states.includes('failed')) return 'failed';
      if (states.includes('running')) return 'running';
      if (states.length && states.every((state) => state === 'succeeded')) return 'succeeded';
      return 'pending';
    };
    return gmailOrganizationPlanSchema.parse({
      id: row.id, kind: row.plan_kind, revision: row.revision, state: row.state, proposalId: row.proposal_id, proposalRevision: row.proposal_revision,
      impactCount: impacts.length, batchCount: batches.length,
      existingMessageCount: impacts.reduce((sum, impact) => sum + Number(impact.existing_messages), 0),
      skippedAmbiguousStreams: row.skipped_ambiguous_streams,
      impacts: impacts.map((impact) => ({
        id: impact.id, scopeAddress: impact.scope_address, sourceCategory: impact.source_category, category: impact.category,
        targetLabel: impact.target_label, markRead: Boolean(impact.mark_read), archive: Boolean(impact.archive), spam: Boolean(impact.spam),
        trash: Boolean(impact.trash),
        existingMessages: impact.existing_messages, confidence: impact.confidence, state: impactState(String(impact.id)),
      })),
      job: row.job_id ? this.#jobs.getProgress(String(row.job_id)) : null,
      undoJob: row.undo_job_id ? this.#jobs.getProgress(String(row.undo_job_id)) : null,
      failedBatches: batches.filter((batch) => ['failed', 'verification_mismatch'].includes(String(batch.state))).map((batch) => ({
        id: batch.id, targetLabel: impacts.find((impact) => impact.id === batch.impact_id)?.target_label ?? 'Unknown', state: batch.state, errorCode: batch.error_code,
      })),
      createdAt: row.created_at, approvedAt: row.approved_at,
    });
  }
}
