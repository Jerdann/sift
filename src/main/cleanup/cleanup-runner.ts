import type { CleanupProgress } from '../../shared/contracts/cleanup';
import type { JobRepository } from '../jobs/job-repository';
import type { ProtonConnectionRepository } from '../proton/proton-connection-repository';
import {
  createProtonMutationClient,
  type ProtonMutationClientFactory,
} from '../proton/proton-mutation-client';
import type { CleanupPlanRepository } from './cleanup-plan-repository';

const PROTON_CLEANUP_BATCH_SIZE = 100;

const providerMessage = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).toLowerCase();

export const cleanupTargetErrorCode = (error: unknown): string => {
  const message = providerMessage(error);
  if (
    message.includes('invalid mailbox name') ||
    message.includes('operation not allowed') ||
    message.includes('proton_folders_root_missing')
  ) return 'proton_target_rejected';
  if (
    message.includes('econnrefused') ||
    message.includes('connection closed') ||
    message.includes('timeout')
  ) return 'proton_bridge_unavailable';
  return 'proton_target_preparation_failed';
};

export const cleanupActionErrorCode = (error: unknown): string => {
  const message = providerMessage(error);
  if (
    message.includes('provider_seen_rejected') ||
    message.includes('provider_move_rejected')
  ) return 'provider_action_rejected';
  if (
    message.includes('econnrefused') ||
    message.includes('connection closed') ||
    message.includes('timeout')
  ) return 'proton_bridge_unavailable';
  return 'provider_action_failed';
};

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

  async prepareTargets(planId: string): Promise<void> {
    this.#plans.assertMutableSources(planId);
    const credentials = this.#connections.getCredentials();
    if (!credentials) throw new Error('proton_not_connected');
    const client = await this.#createClient(credentials);
    try {
      await client.connect();
      try {
        for (const target of this.#plans.targets(planId)) {
          await client.prepareTarget(
            target.targetPath,
            target.actionKind === 'native_spam',
            target.actionKind === 'native_trash',
          );
        }
      } catch (error) {
        const errorCode = cleanupTargetErrorCode(error);
        throw new Error(errorCode, { cause: error });
      }
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  async run(jobId: string): Promise<CleanupProgress> {
    const credentials = this.#connections.getCredentials();
    if (!credentials) throw new Error('proton_not_connected');
    const planId = this.#plans.planIdForJob(jobId);
    this.#plans.assertMutableSources(planId);
    const client = await this.#createClient(credentials);
    const targets = new Map<string, string>();
    try {
      await client.connect();
      try {
        for (const target of this.#plans.targets(planId)) {
          const targetKey = `${target.actionKind}:${target.targetPath}`;
          targets.set(targetKey, await client.prepareTarget(
            target.targetPath,
            target.actionKind === 'native_spam',
            target.actionKind === 'native_trash',
          ));
        }
      } catch (error) {
        const errorCode = cleanupTargetErrorCode(error);
        this.#jobs.blockPendingJob(jobId, errorCode);
        this.#emit(planId);
        throw new Error(errorCode, { cause: error });
      }
      let verificationDeferred = false;
      for (;;) {
        const items = this.#jobs.claimNextPendingBatch(jobId, PROTON_CLEANUP_BATCH_SIZE);
        if (!items.length) break;
        const retirementItems = items.filter((item) => item.itemKey.startsWith('retire:'));
        const messageItems = items.filter((item) => !item.itemKey.startsWith('retire:'));
        const groups = new Map<string, Array<{ item: (typeof items)[number]; action: ReturnType<CleanupPlanRepository['action']> }>>();
        for (const item of messageItems) {
          const action = this.#plans.action(item.itemKey);
          const key = `${action.sourcePath}\0${action.actionKind}\0${action.targetPath}`;
          const group = groups.get(key) ?? [];
          group.push({ item, action });
          groups.set(key, group);
        }
        for (const group of groups.values()) {
          if (verificationDeferred) break;
          group.sort((left, right) => left.action.uid - right.action.uid);
          const representative = group[0]!.action;
          this.#currentTarget = representative.targetPath;
          this.#emit(planId);

          const moved = group.filter(({ action }) =>
            action.resultingPath !== null && action.resultingUid !== null && action.resultingUidValidity === null,
          );
          if (moved.length) {
            const byTarget = new Map<string, typeof moved>();
            for (const entry of moved) {
              const targetGroup = byTarget.get(entry.action.resultingPath!) ?? [];
              targetGroup.push(entry);
              byTarget.set(entry.action.resultingPath!, targetGroup);
            }
            for (const [targetPath, targetGroup] of byTarget) {
              let resulting: Map<number, { uidValidity: string; flags: string[] }>;
              try {
                resulting = await client.inspectMany(targetPath, targetGroup.map(({ action }) => action.resultingUid!));
              } catch {
                this.#jobs.requeueRunning(jobId, 'provider_verification_pending');
                verificationDeferred = true;
                this.#emit(planId);
                break;
              }
              for (const { item, action } of targetGroup) {
                const state = resulting.get(action.resultingUid!);
                if (!state) continue;
                this.#plans.markResult(action.id, 'succeeded', null, {
                  path: targetPath,
                  uid: action.resultingUid!,
                  ...state,
                });
                this.#jobs.transitionItem(item.id, 'succeeded', {
                  result: { operation: 'proton-cleanup-action', verified: true },
                });
              }
              if (targetGroup.some(({ action }) => !resulting.has(action.resultingUid!))) {
                this.#jobs.requeueRunning(jobId, 'provider_verification_pending');
                verificationDeferred = true;
                this.#emit(planId);
                break;
              }
            }
          }
          if (verificationDeferred) break;

          const fresh = group.filter(({ action }) =>
            action.resultingPath === null || action.resultingUid === null,
          );
          if (!fresh.length) continue;
          let inspected: Map<number, { uidValidity: string; flags: string[] }>;
          try {
            inspected = await client.inspectMany(representative.sourcePath, fresh.map(({ action }) => action.uid));
          } catch (error) {
            const errorCode = cleanupActionErrorCode(error);
            for (const { item, action } of fresh) this.#failAction(item.id, action.id, errorCode);
            this.#emit(planId);
            continue;
          }
          const ready: typeof fresh = [];
          for (const entry of fresh) {
            const prior = inspected.get(entry.action.uid);
            if (!prior || prior.uidValidity !== entry.action.uidValidity) {
              this.#plans.markResult(entry.action.id, 'verification_mismatch', 'source_message_changed');
              this.#jobs.transitionItem(entry.item.id, 'verification_mismatch', { errorCode: 'source_message_changed' });
              continue;
            }
            this.#plans.markRunning(entry.action.id, prior.flags);
            ready.push(entry);
          }
          if (!ready.length) {
            this.#emit(planId);
            continue;
          }
          const targetKey = `${representative.actionKind}:${representative.targetPath}`;
          let target = targets.get(targetKey);
          let pointers: Map<number, { path: string; uid: number }>;
          try {
            if (!target) {
              target = await client.prepareTarget(
                representative.targetPath,
                representative.actionKind === 'native_spam',
                representative.actionKind === 'native_trash',
              );
              targets.set(targetKey, target);
            }
            pointers = await client.moveMany(representative.sourcePath, ready.map(({ action }) => action.uid), target);
          } catch (error) {
            const errorCode = cleanupActionErrorCode(error);
            if (errorCode === 'provider_action_rejected') {
              for (const { item, action } of ready) this.#failAction(item.id, action.id, errorCode);
              this.#emit(planId);
              continue;
            }
            this.#jobs.requeueRunning(jobId, 'provider_move_state_unknown');
            verificationDeferred = true;
            this.#emit(planId);
            break;
          }
          for (const { action } of ready) {
            const pointer = pointers.get(action.uid);
            if (pointer) this.#plans.markMovePending(action.id, pointer);
          }

          let resulting: Map<number, { uidValidity: string; flags: string[] }>;
          try {
            resulting = await client.inspectMany(target, [...pointers.values()].map((pointer) => pointer.uid));
          } catch {
            this.#jobs.requeueRunning(jobId, 'provider_verification_pending');
            verificationDeferred = true;
            this.#emit(planId);
            break;
          }
          for (const { item, action } of ready) {
            const pointer = pointers.get(action.uid);
            const state = pointer ? resulting.get(pointer.uid) : null;
            if (!pointer || !state) continue;
            this.#plans.markResult(action.id, 'succeeded', null, { ...pointer, ...state });
            this.#jobs.transitionItem(item.id, 'succeeded', {
              result: { operation: 'proton-cleanup-action', verified: true },
            });
          }
          if (ready.some(({ action }) => {
            const pointer = pointers.get(action.uid);
            return !pointer || !resulting.has(pointer.uid);
          })) {
            this.#jobs.requeueRunning(jobId, 'provider_verification_pending');
            verificationDeferred = true;
          }
          this.#emit(planId);
        }
        if (verificationDeferred) break;
        if (retirementItems.length) {
          const cleanupFailed = this.#plans.get(planId).failedActions.length > 0;
          for (const item of retirementItems) {
            const containerId = item.itemKey.slice('retire:'.length);
            const container = this.#plans.legacyContainer(containerId);
            this.#currentTarget = container.providerPath;
            this.#plans.markLegacyContainer(container.id, 'running');
            this.#emit(planId);
            if (cleanupFailed) {
              this.#plans.markLegacyContainer(container.id, 'failed', 'legacy_retirement_cleanup_incomplete');
              this.#jobs.transitionItem(item.id, 'failed', { errorCode: 'legacy_retirement_cleanup_incomplete' });
              continue;
            }
            try {
              const result = await client.retireContainer(container.providerPath);
              if (result === 'not_empty') {
                this.#plans.markLegacyContainer(container.id, 'retained_nonempty', 'legacy_container_not_empty');
                this.#jobs.transitionItem(item.id, container.kind === 'folder' ? 'skipped' : 'failed', {
                  errorCode: container.kind === 'folder'
                    ? 'legacy_container_retained_nonempty'
                    : 'legacy_label_retirement_failed',
                });
              } else {
                this.#plans.markLegacyContainer(container.id, 'retired');
                this.#jobs.transitionItem(item.id, 'succeeded', {
                  result: { operation: 'proton-cleanup-action', verified: true },
                });
              }
            } catch {
              this.#plans.markLegacyContainer(container.id, 'failed', 'legacy_container_retirement_failed');
              this.#jobs.transitionItem(item.id, 'failed', { errorCode: 'legacy_container_retirement_failed' });
            }
            this.#emit(planId);
          }
        }
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
          this.#plans.markUndoSucceeded(action.id, restored);
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

  #failAction(itemId: string, actionId: string, errorCode = 'provider_action_failed'): void {
    this.#plans.markResult(actionId, 'failed', errorCode);
    this.#jobs.transitionItem(itemId, 'failed', { errorCode });
  }
}
