import type BetterSqlite3 from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type {
  DurableJob,
  DurableJobItem,
  JobKind,
  JobProgress,
  JobState,
  SafeJobResult,
} from '../../core/jobs/job-types';

const ALLOWED_ITEM_TRANSITIONS: Readonly<Record<JobState, readonly JobState[]>> = {
  pending: ['running', 'failed', 'skipped'],
  running: ['succeeded', 'failed', 'skipped', 'verification_mismatch'],
  succeeded: [],
  failed: ['pending'],
  skipped: [],
  verification_mismatch: ['pending'],
};

interface JobRepositoryOptions {
  now?: () => string;
  createId?: () => string;
}

interface CreateJobInput {
  profileId: string;
  kind: JobKind;
  idempotencyKey: string;
  itemKeys: readonly string[];
}

export class JobRepository {
  readonly #database: BetterSqlite3.Database;
  readonly #now: () => string;
  readonly #createId: () => string;

  constructor(database: BetterSqlite3.Database, options: JobRepositoryOptions = {}) {
    this.#database = database;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#createId = options.createId ?? randomUUID;
  }

  createJob(input: CreateJobInput): DurableJob {
    const existing = this.#database
      .prepare('SELECT * FROM jobs WHERE idempotency_key = ?')
      .get(input.idempotencyKey) as Record<string, unknown> | undefined;
    if (existing) return this.#jobFromRow(existing);

    const jobId = this.#createId();
    const createdAt = this.#now();
    this.#database.transaction(() => {
      this.#database
        .prepare(
          `INSERT INTO jobs(
             id, profile_id, kind, state, idempotency_key, total_items, created_at
           ) VALUES (?, ?, ?, 'pending', ?, ?, ?)`,
        )
        .run(
          jobId,
          input.profileId,
          input.kind,
          input.idempotencyKey,
          input.itemKeys.length,
          createdAt,
        );
      const insertItem = this.#database.prepare(
        `INSERT INTO job_items(id, job_id, item_key, state, attempts, updated_at)
         VALUES (?, ?, ?, 'pending', 0, ?)`,
      );
      for (const itemKey of input.itemKeys) {
        insertItem.run(this.#createId(), jobId, itemKey, createdAt);
      }
      this.#appendAudit(jobId, null, 'job.created', { itemCount: input.itemKeys.length });
    })();
    return this.getJob(jobId);
  }

  getJob(jobId: string): DurableJob {
    const row = this.#database.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    if (!row) throw new Error('Job was not found');
    return this.#jobFromRow(row as Record<string, unknown>);
  }

  findLatest(profileId: string, kind: JobKind): DurableJob | null {
    const row = this.#database
      .prepare('SELECT * FROM jobs WHERE profile_id = ? AND kind = ? ORDER BY rowid DESC LIMIT 1')
      .get(profileId, kind) as Record<string, unknown> | undefined;
    return row ? this.#jobFromRow(row) : null;
  }

  getProgress(jobId: string): JobProgress {
    const job = this.getJob(jobId);
    const rows = this.#database
      .prepare('SELECT state, COUNT(*) AS count FROM job_items WHERE job_id = ? GROUP BY state')
      .all(jobId) as Array<{ state: JobState; count: number }>;
    const count = (state: JobState) => rows.find((row) => row.state === state)?.count ?? 0;
    const counts = {
      pending: count('pending'),
      running: count('running'),
      succeeded: count('succeeded'),
      failed: count('failed'),
      skipped: count('skipped'),
      verificationMismatch: count('verification_mismatch'),
    };
    const completedItems =
      counts.succeeded + counts.failed + counts.skipped + counts.verificationMismatch;
    return {
      id: job.id,
      kind: job.kind,
      state: job.state,
      totalItems: job.totalItems,
      completedItems,
      percent: job.totalItems === 0 ? 100 : Math.round((completedItems / job.totalItems) * 100),
      counts,
      errorCode: job.errorCode,
    };
  }

  claimNextPending(jobId: string): DurableJobItem | null {
    return this.#database.transaction(() => {
      const row = this.#database
        .prepare(
          `SELECT * FROM job_items
           WHERE job_id = ? AND state = 'pending'
           ORDER BY rowid LIMIT 1`,
        )
        .get(jobId) as Record<string, unknown> | undefined;
      if (!row) return null;
      const timestamp = this.#now();
      this.#database
        .prepare(
          `UPDATE job_items
           SET state = 'running', attempts = attempts + 1, updated_at = ?
           WHERE id = ? AND state = 'pending'`,
        )
        .run(timestamp, row.id);
      this.#database
        .prepare(
          `UPDATE jobs SET state = 'running', started_at = COALESCE(started_at, ?)
           WHERE id = ? AND state = 'pending'`,
        )
        .run(timestamp, jobId);
      this.#appendAudit(jobId, String(row.id), 'job_item.running', {});
      return this.#itemFromRow(
        this.#database.prepare('SELECT * FROM job_items WHERE id = ?').get(row.id) as Record<string, unknown>,
      );
    })();
  }

  transitionItem(
    itemId: string,
    targetState: JobState,
    options: { result?: SafeJobResult; errorCode?: string } = {},
  ): void {
    this.#database.transaction(() => {
      const row = this.#database.prepare('SELECT * FROM job_items WHERE id = ?').get(itemId) as
        | Record<string, unknown>
        | undefined;
      if (!row) throw new Error('Job item was not found');
      const item = this.#itemFromRow(row);
      if (!ALLOWED_ITEM_TRANSITIONS[item.state].includes(targetState)) {
        throw new Error(`Illegal job item transition: ${item.state} -> ${targetState}`);
      }
      this.#database
        .prepare(
          `UPDATE job_items
           SET state = ?, result_json = ?, error_code = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          targetState,
          options.result ? JSON.stringify(options.result) : null,
          options.errorCode ?? null,
          this.#now(),
          itemId,
        );
      this.#appendAudit(item.jobId, itemId, `job_item.${targetState}`, {
        errorCode: options.errorCode ?? null,
        verified: options.result?.verified ?? null,
      });
      this.#reconcileJob(item.jobId);
    })();
  }

  recoverInterrupted(): number {
    return this.#database.transaction(() => {
      const running = this.#database
        .prepare("SELECT id, job_id FROM job_items WHERE state = 'running'")
        .all() as Array<{ id: string; job_id: string }>;
      const timestamp = this.#now();
      this.#database
        .prepare("UPDATE job_items SET state = 'pending', updated_at = ? WHERE state = 'running'")
        .run(timestamp);
      this.#database
        .prepare("UPDATE jobs SET state = 'pending' WHERE state = 'running'")
        .run();
      for (const item of running) {
        this.#appendAudit(item.job_id, item.id, 'job_item.recovered', {});
      }
      return running.length;
    })();
  }

  pause(jobId: string): void {
    this.#database.transaction(() => {
      const timestamp = this.#now();
      this.#database
        .prepare("UPDATE job_items SET state = 'pending', updated_at = ? WHERE job_id = ? AND state = 'running'")
        .run(timestamp, jobId);
      this.#database
        .prepare("UPDATE jobs SET state = 'pending' WHERE id = ? AND state = 'running'")
        .run(jobId);
      this.#appendAudit(jobId, null, 'job.paused', {});
    })();
  }

  retryItems(jobId: string, itemKeys: readonly string[]): number {
    if (!itemKeys.length) return 0;
    return this.#database.transaction(() => {
      const placeholders = itemKeys.map(() => '?').join(',');
      const rows = this.#database.prepare(`
        SELECT id,item_key,state FROM job_items
        WHERE job_id=? AND item_key IN (${placeholders})
      `).all(jobId, ...itemKeys) as Array<{ id: string; item_key: string; state: JobState }>;
      if (rows.length !== new Set(itemKeys).size) throw new Error('job_retry_item_not_found');
      if (rows.some((row) => !['failed', 'verification_mismatch'].includes(row.state))) {
        throw new Error('job_retry_item_not_retryable');
      }
      const now = this.#now();
      const update = this.#database.prepare("UPDATE job_items SET state='pending',error_code=NULL,result_json=NULL,updated_at=? WHERE id=?");
      for (const row of rows) {
        update.run(now, row.id);
        this.#appendAudit(jobId, row.id, 'job_item.retried', {});
      }
      this.#database.prepare("UPDATE jobs SET state='pending',error_code=NULL,finished_at=NULL WHERE id=?").run(jobId);
      this.#appendAudit(jobId, null, 'job.retried', { itemCount: rows.length });
      return rows.length;
    })();
  }

  #reconcileJob(jobId: string): void {
    const progress = this.getProgress(jobId);
    if (progress.counts.pending > 0 || progress.counts.running > 0) return;
    let state: JobState = 'succeeded';
    let errorCode: string | null = null;
    if (progress.counts.verificationMismatch > 0) {
      state = 'verification_mismatch';
      errorCode = 'verification_mismatch';
    } else if (progress.counts.failed > 0) {
      state = 'failed';
      errorCode = 'item_failed';
    } else if (progress.counts.succeeded === 0 && progress.counts.skipped > 0) {
      state = 'skipped';
    }
    this.#database
      .prepare('UPDATE jobs SET state = ?, error_code = ?, finished_at = ? WHERE id = ?')
      .run(state, errorCode, this.#now(), jobId);
    this.#appendAudit(jobId, null, `job.${state}`, { errorCode });
  }

  #appendAudit(
    jobId: string,
    itemId: string | null,
    eventType: string,
    safePayload: Record<string, unknown>,
  ): void {
    this.#database
      .prepare(
        `INSERT INTO audit_events(
           id, job_id, job_item_id, event_type, safe_payload_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        this.#createId(),
        jobId,
        itemId,
        eventType,
        JSON.stringify(safePayload),
        this.#now(),
      );
  }

  #jobFromRow(row: Record<string, unknown>): DurableJob {
    return {
      id: String(row.id),
      profileId: String(row.profile_id),
      kind: row.kind as JobKind,
      state: row.state as JobState,
      idempotencyKey: String(row.idempotency_key),
      totalItems: Number(row.total_items),
      createdAt: String(row.created_at),
      startedAt: row.started_at ? String(row.started_at) : null,
      finishedAt: row.finished_at ? String(row.finished_at) : null,
      errorCode: row.error_code ? String(row.error_code) : null,
    };
  }

  #itemFromRow(row: Record<string, unknown>): DurableJobItem {
    return {
      id: String(row.id),
      jobId: String(row.job_id),
      itemKey: String(row.item_key),
      state: row.state as JobState,
      attempts: Number(row.attempts),
      errorCode: row.error_code ? String(row.error_code) : null,
      updatedAt: String(row.updated_at),
    };
  }
}
