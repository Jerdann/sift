import type { CleanupProgress } from '../../shared/contracts/cleanup';
import type { JobRepository } from '../jobs/job-repository';
import type { ProtonConnectionRepository } from '../proton/proton-connection-repository';
import {
  createProtonMutationClient,
  type ProtonMutationClientFactory,
} from '../proton/proton-mutation-client';
import type { CleanupPlanRepository } from './cleanup-plan-repository';

export class CleanupRunner {
  readonly #jobs: JobRepository;
  readonly #plans: CleanupPlanRepository;
  readonly #connections: ProtonConnectionRepository;
  readonly #createClient: ProtonMutationClientFactory;
  readonly #listeners = new Set<(progress: CleanupProgress) => void>();
  #currentTarget: string | null = null;

  constructor(
    jobs: JobRepository,
    plans: CleanupPlanRepository,
    connections: ProtonConnectionRepository,
    createClient: ProtonMutationClientFactory = createProtonMutationClient,
  ) {
    this.#jobs = jobs;
    this.#plans = plans;
    this.#connections = connections;
    this.#createClient = createClient;
  }

  subscribe(listener: (progress: CleanupProgress) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async run(jobId: string): Promise<CleanupProgress> {
    const credentials = this.#connections.getCredentials();
    if (!credentials) throw new Error('proton_not_connected');
    const planId = this.#plans.planIdForJob(jobId);
    const client = await this.#createClient(credentials);
    const targets = new Map<string, string>();
    try {
      await client.connect();
      for (;;) {
        const item = this.#jobs.claimNextPending(jobId);
        if (!item) break;
        const action = this.#plans.action(item.itemKey);
        this.#currentTarget = action.targetPath;
        this.#emit(planId);
        try {
          const prior = await client.inspect(action.sourcePath, action.uid);
          if (!prior || prior.uidValidity !== action.uidValidity) {
            this.#plans.markResult(action.id, 'verification_mismatch', 'source_message_changed');
            this.#jobs.transitionItem(item.id, 'verification_mismatch', { errorCode: 'source_message_changed' });
            this.#emit(planId);
            continue;
          }
          this.#plans.markRunning(action.id, prior.flags);
          const targetKey = `${action.actionKind}:${action.targetPath}`;
          let target = targets.get(targetKey);
          if (!target) {
            target = await client.prepareTarget(
              action.targetPath,
              action.actionKind === 'native_spam',
              action.actionKind === 'native_trash',
            );
            targets.set(targetKey, target);
          }
          const applied = await client.apply(action.sourcePath, action.uid, target);
          if (!applied || applied.path !== target) throw new Error('provider_verification_failed');
          this.#plans.markResult(action.id, 'succeeded', null, applied);
          this.#jobs.transitionItem(item.id, 'succeeded', {
            result: { operation: 'proton-cleanup-action', verified: true },
          });
        } catch {
          this.#plans.markResult(action.id, 'failed', 'provider_action_failed');
          this.#jobs.transitionItem(item.id, 'failed', { errorCode: 'provider_action_failed' });
        }
        this.#emit(planId);
      }
    } finally {
      this.#currentTarget = null;
      await client.close().catch(() => undefined);
    }
    return this.progress(planId);
  }

  async undo(jobId: string): Promise<CleanupProgress> {
    const credentials = this.#connections.getCredentials();
    if (!credentials) throw new Error('proton_not_connected');
    const planId = this.#plans.planIdForJob(jobId);
    const client = await this.#createClient(credentials);
    try {
      await client.connect();
      for (;;) {
        const item = this.#jobs.claimNextPending(jobId);
        if (!item) break;
        const actionId = item.itemKey.startsWith('undo:') ? item.itemKey.slice(5) : '';
        const action = this.#plans.action(actionId);
        this.#currentTarget = action.sourcePath;
        this.#plans.markUndo(action.id, 'running');
        this.#emit(planId);
        try {
          if (!action.resultingPath || !action.resultingUidValidity || !action.resultingUid) throw new Error('cleanup_undo_receipt_missing');
          const current = await client.inspect(action.resultingPath, action.resultingUid);
          if (!current || current.uidValidity !== action.resultingUidValidity) {
            this.#plans.markUndo(action.id, 'verification_mismatch', 'destination_message_changed');
            this.#jobs.transitionItem(item.id, 'verification_mismatch', { errorCode: 'destination_message_changed' });
            continue;
          }
          const restored = await client.restore(action.resultingPath, action.resultingUid, action.sourcePath, action.priorFlags);
          const expectedFlags = [...action.priorFlags].sort();
          if (!restored || restored.path !== action.sourcePath || JSON.stringify(restored.flags) !== JSON.stringify(expectedFlags)) {
            throw new Error('provider_undo_verification_failed');
          }
          this.#plans.markUndo(action.id, 'succeeded');
          this.#jobs.transitionItem(item.id, 'succeeded', { result: { operation: 'proton-cleanup-action', verified: true } });
        } catch {
          this.#plans.markUndo(action.id, 'failed', 'provider_undo_failed');
          this.#jobs.transitionItem(item.id, 'failed', { errorCode: 'provider_undo_failed' });
        }
        this.#emit(planId);
      }
    } finally {
      this.#currentTarget = null;
      await client.close().catch(() => undefined);
    }
    return this.progress(planId);
  }

  progress(planId: string): CleanupProgress {
    return {
      profileId: this.#plans.profileId,
      plan: this.#plans.syncPlanState(planId),
      currentTarget: this.#currentTarget,
    };
  }

  #emit(planId: string) {
    const progress = this.progress(planId);
    for (const listener of this.#listeners) listener(progress);
  }
}
