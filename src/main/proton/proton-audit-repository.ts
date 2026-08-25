import type BetterSqlite3 from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { JobProgress, JobState } from '../../core/jobs/job-types';
import {
  type ProtonAuditProgress,
  protonAuditProgressSchema,
} from '../../shared/contracts/proton-audit';
import type { ProtonAuditMessage } from './bridge-client';

interface AuditRunRow {
  job_id: string;
  connection_id: string;
  extract_bodies: number;
}

interface ContainerRow {
  id: string;
  provider_container_id: string;
  message_count: number;
}

export class ProtonAuditRepository {
  readonly #database: BetterSqlite3.Database;
  readonly #now: () => string;
  readonly #createId: () => string;

  constructor(
    database: BetterSqlite3.Database,
    options: { now?: () => string; createId?: () => string } = {},
  ) {
    this.#database = database;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#createId = options.createId ?? randomUUID;
  }

  registerRun(jobId: string, connectionId: string, extractBodies: boolean): void {
    this.#database.prepare(`
      INSERT INTO proton_audit_runs(job_id, connection_id, extract_bodies, created_at)
      VALUES (?, ?, ?, ?)
    `).run(jobId, connectionId, extractBodies ? 1 : 0, this.#now());
  }

  getRun(jobId: string): { connectionId: string; extractBodies: boolean } {
    const row = this.#database.prepare('SELECT * FROM proton_audit_runs WHERE job_id = ?').get(jobId) as AuditRunRow | undefined;
    if (!row) throw new Error('Proton audit was not found');
    return { connectionId: row.connection_id, extractBodies: Boolean(row.extract_bodies) };
  }

  findLatestJobId(profileId: string): string | null {
    const row = this.#database.prepare(`
      SELECT jobs.id FROM jobs
      JOIN proton_audit_runs ON proton_audit_runs.job_id = jobs.id
      WHERE jobs.profile_id = ? AND jobs.kind = 'proton-audit'
      ORDER BY jobs.rowid DESC LIMIT 1
    `).get(profileId) as { id: string } | undefined;
    return row?.id ?? null;
  }

  containers(connectionId: string): ContainerRow[] {
    return this.#database.prepare(`
      SELECT id, provider_container_id, message_count FROM mail_containers
      WHERE connection_id = ? AND flags_json NOT LIKE '%\\\\Noselect%'
      ORDER BY display_name COLLATE NOCASE
    `).all(connectionId) as ContainerRow[];
  }

  containerForPath(connectionId: string, path: string): ContainerRow {
    const row = this.#database.prepare(`
      SELECT id, provider_container_id, message_count FROM mail_containers
      WHERE connection_id = ? AND provider_container_id = ?
    `).get(connectionId, path) as ContainerRow | undefined;
    if (!row) throw new Error('Audit folder was not found');
    return row;
  }

  checkpoint(connectionId: string, containerId: string): { uidValidity: string; lastUid: number } | null {
    const row = this.#database.prepare(`
      SELECT uid_validity, last_uid FROM proton_folder_checkpoints
      WHERE connection_id = ? AND container_id = ?
    `).get(connectionId, containerId) as { uid_validity: string; last_uid: number } | undefined;
    return row ? { uidValidity: row.uid_validity, lastUid: row.last_uid } : null;
  }

  commitBatch(input: {
    jobId: string;
    connectionId: string;
    containerId: string;
    uidValidity: string;
    completedThrough: number;
    messages: readonly ProtonAuditMessage[];
  }): void {
    this.#database.transaction(() => {
      const previous = this.checkpoint(input.connectionId, input.containerId);
      if (previous && previous.uidValidity !== input.uidValidity) {
        this.#database.prepare('DELETE FROM indexed_messages WHERE connection_id = ? AND container_id = ?')
          .run(input.connectionId, input.containerId);
        this.#database.prepare('DELETE FROM proton_folder_checkpoints WHERE connection_id = ? AND container_id = ?')
          .run(input.connectionId, input.containerId);
      }

      const insert = this.#database.prepare(`
        INSERT INTO indexed_messages(
          id, connection_id, container_id, uid_validity, uid, message_id,
          received_at, subject, sender_json, recipients_json, headers_json,
          flags_json, size_bytes, body_text, body_truncated, indexed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(connection_id, container_id, uid_validity, uid) DO UPDATE SET
          message_id = excluded.message_id,
          received_at = excluded.received_at,
          subject = excluded.subject,
          sender_json = excluded.sender_json,
          recipients_json = excluded.recipients_json,
          headers_json = excluded.headers_json,
          flags_json = excluded.flags_json,
          size_bytes = excluded.size_bytes,
          body_text = COALESCE(excluded.body_text, indexed_messages.body_text),
          body_truncated = MAX(excluded.body_truncated, indexed_messages.body_truncated),
          indexed_at = excluded.indexed_at
      `);
      const addFailure = this.#database.prepare(`
        INSERT INTO proton_scan_failures(id, job_id, container_id, uid, category, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const message of input.messages) {
        insert.run(
          this.#createId(), input.connectionId, input.containerId, input.uidValidity, message.uid,
          message.messageId, message.receivedAt, message.subject, JSON.stringify(message.senders),
          JSON.stringify(message.recipients), JSON.stringify(message.headers), JSON.stringify(message.flags),
          message.sizeBytes, message.bodyText, message.bodyTruncated ? 1 : 0, this.#now(),
        );
        if (message.bodyError) {
          addFailure.run(this.#createId(), input.jobId, input.containerId, message.uid, 'body_extract_failed', this.#now());
        }
      }

      const aggregate = this.#database.prepare(`
        SELECT COUNT(*) AS count, MIN(received_at) AS earliest, MAX(received_at) AS latest
        FROM indexed_messages WHERE connection_id = ? AND container_id = ?
      `).get(input.connectionId, input.containerId) as { count: number; earliest: string | null; latest: string | null };
      this.#database.prepare(`
        INSERT INTO proton_folder_checkpoints(
          connection_id, container_id, uid_validity, last_uid, indexed_count,
          earliest_at, latest_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(connection_id, container_id) DO UPDATE SET
          uid_validity = excluded.uid_validity,
          last_uid = MAX(proton_folder_checkpoints.last_uid, excluded.last_uid),
          indexed_count = excluded.indexed_count,
          earliest_at = excluded.earliest_at,
          latest_at = excluded.latest_at,
          updated_at = excluded.updated_at
      `).run(
        input.connectionId, input.containerId, input.uidValidity, input.completedThrough,
        aggregate.count, aggregate.earliest, aggregate.latest, this.#now(),
      );
    })();
  }

  recordFolderFailure(jobId: string, containerId: string | null, category: string): void {
    this.#database.prepare(`
      INSERT INTO proton_scan_failures(id, job_id, container_id, uid, category, created_at)
      VALUES (?, ?, ?, NULL, ?, ?)
    `).run(this.#createId(), jobId, containerId, category, this.#now());
  }

  progress(job: JobProgress, currentFolder: string | null): ProtonAuditProgress {
    const run = this.getRun(job.id);
    const owner = this.#database.prepare('SELECT profile_id FROM jobs WHERE id = ?').get(job.id) as { profile_id: string };
    const folders = this.#database.prepare(`
      SELECT mc.provider_container_id AS path, mc.message_count,
             ji.state, COALESCE(cp.indexed_count, 0) AS indexed_count,
             cp.earliest_at, cp.latest_at,
             (SELECT COUNT(*) FROM proton_scan_failures sf
              WHERE sf.job_id = ji.job_id AND sf.container_id = mc.id) AS failure_count
      FROM job_items ji
      JOIN mail_containers mc
        ON mc.connection_id = ? AND mc.provider_container_id = ji.item_key
      LEFT JOIN proton_folder_checkpoints cp
        ON cp.connection_id = mc.connection_id AND cp.container_id = mc.id
      WHERE ji.job_id = ? ORDER BY ji.rowid
    `).all(run.connectionId, job.id) as Array<{
      path: string; message_count: number; state: JobState; indexed_count: number;
      earliest_at: string | null; latest_at: string | null; failure_count: number;
    }>;
    const failureCount = (this.#database.prepare('SELECT COUNT(*) AS count FROM proton_scan_failures WHERE job_id = ?').get(job.id) as { count: number }).count;
    const earliest = folders.map((folder) => folder.earliest_at).filter(Boolean).sort()[0] ?? null;
    const latest = folders.map((folder) => folder.latest_at).filter(Boolean).sort().at(-1) ?? null;
    return protonAuditProgressSchema.parse({
      profileId: owner.profile_id,
      job,
      extractBodies: run.extractBodies,
      indexedMessages: folders.reduce((sum, folder) => sum + folder.indexed_count, 0),
      totalEstimate: folders.reduce((sum, folder) => sum + folder.message_count, 0),
      currentFolder,
      earliestAt: earliest,
      latestAt: latest,
      failureCount,
      folders: folders.map((folder) => ({
        path: folder.path,
        state: folder.state,
        indexedCount: folder.indexed_count,
        messageEstimate: folder.message_count,
        earliestAt: folder.earliest_at,
        latestAt: folder.latest_at,
        failureCount: folder.failure_count,
      })),
    });
  }
}
