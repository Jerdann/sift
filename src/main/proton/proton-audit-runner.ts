import type { JobProgress } from '../../core/jobs/job-types';
import type { ProtonAuditProgress } from '../../shared/contracts/proton-audit';
import type { JobRepository } from '../jobs/job-repository';
import {
  createProtonAuditClient,
  type ProtonAuditClientFactory,
} from './bridge-client';
import type { ProtonConnectionRepository } from './proton-connection-repository';
import type { ProtonAuditRepository } from './proton-audit-repository';

const BATCH_SIZE = 100;

export type ProtonAuditProgressListener = (progress: ProtonAuditProgress) => void;

export class ProtonAuditRunner {
  readonly #jobs: JobRepository;
  readonly #audits: ProtonAuditRepository;
  readonly #connections: ProtonConnectionRepository;
  readonly #createClient: ProtonAuditClientFactory;
  readonly #listeners = new Set<ProtonAuditProgressListener>();
  readonly #pauseRequests = new Set<string>();
  #currentFolder: string | null = null;

  constructor(
    jobs: JobRepository,
    audits: ProtonAuditRepository,
    connections: ProtonConnectionRepository,
    createClient: ProtonAuditClientFactory = createProtonAuditClient,
  ) {
    this.#jobs = jobs;
    this.#audits = audits;
    this.#connections = connections;
    this.#createClient = createClient;
  }

  subscribe(listener: ProtonAuditProgressListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  requestPause(jobId: string): void {
    this.#pauseRequests.add(jobId);
  }

  async run(jobId: string): Promise<ProtonAuditProgress> {
    const run = this.#audits.getRun(jobId);
    const credentials = this.#connections.getCredentials();
    const connection = this.#connections.get();
    if (!credentials || connection?.id !== run.connectionId) throw new Error('proton_not_connected');
    const client = await this.#createClient(credentials);
    try {
      await client.connect();
      for (;;) {
        if (this.#pauseRequests.has(jobId)) break;
        const item = this.#jobs.claimNextPending(jobId);
        if (!item) break;
        this.#currentFolder = item.itemKey;
        this.#emit(jobId);
        let containerId: string | null = null;
        try {
          const container = this.#audits.containerForPath(run.connectionId, item.itemKey);
          containerId = container.id;
          for (;;) {
            const checkpoint = this.#audits.checkpoint(run.connectionId, container.id);
            const fromUid = (checkpoint?.lastUid ?? 0) + 1;
            const batch = await client.fetchAuditBatch(item.itemKey, fromUid, BATCH_SIZE, run.extractBodies);
            const validityChanged = Boolean(checkpoint && checkpoint.uidValidity !== batch.uidValidity);
            const effectiveFrom = validityChanged ? 1 : fromUid;
            const effectiveBatch = validityChanged && fromUid !== 1
              ? await client.fetchAuditBatch(item.itemKey, 1, BATCH_SIZE, run.extractBodies)
              : batch;
            const lastUid = effectiveBatch.messages.at(-1)?.uid ?? Math.max(0, effectiveBatch.uidNext - 1);
            this.#audits.commitBatch({
              jobId,
              connectionId: run.connectionId,
              containerId: container.id,
              uidValidity: effectiveBatch.uidValidity,
              completedThrough: lastUid,
              messages: effectiveBatch.messages,
            });
            this.#emit(jobId);
            if (this.#pauseRequests.has(jobId)) break;
            if (!effectiveBatch.messages.length || lastUid >= effectiveBatch.uidNext - 1) break;
            if (effectiveFrom === lastUid + 1) break;
          }
          if (this.#pauseRequests.has(jobId)) {
            this.#jobs.pause(jobId);
            break;
          }
          this.#jobs.transitionItem(item.id, 'succeeded', {
            result: { operation: 'proton-folder-index', verified: true },
          });
        } catch {
          this.#audits.recordFolderFailure(jobId, containerId, 'folder_scan_failed');
          this.#jobs.transitionItem(item.id, 'failed', { errorCode: 'folder_scan_failed' });
        }
        this.#emit(jobId);
      }
    } finally {
      this.#pauseRequests.delete(jobId);
      this.#currentFolder = null;
      await client.close().catch(() => undefined);
    }
    return this.progress(jobId);
  }

  progress(jobId: string): ProtonAuditProgress {
    return this.#audits.progress(this.#jobs.getProgress(jobId), this.#currentFolder);
  }

  #emit(jobId: string): void {
    const progress = this.progress(jobId);
    for (const listener of this.#listeners) listener(progress);
  }
}
