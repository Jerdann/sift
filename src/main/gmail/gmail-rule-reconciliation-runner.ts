import { normalizeGmailFilter, type GmailFilterResource } from '../../core/rules/rule-reconciliation';
import type { DesiredManagedRule } from '../../shared/contracts/rule-management';
import type { JobRepository } from '../jobs/job-repository';
import type { RuleOperationRecord, RuleReconciliationRepository } from '../rules/rule-reconciliation-repository';
import type { GmailConnectionRepository } from './gmail-connection-repository';
import { refreshGmailAccessToken, type OAuthFetch } from './gmail-oauth';

interface ProviderState {
  labelsById: Map<string, string>;
  labelIdsByName: Map<string, string>;
  filters: Array<ReturnType<typeof normalizeGmailFilter>>;
}

const api = async <T>(fetchPort: OAuthFetch, token: string, url: string, init: RequestInit = {}): Promise<T> => {
  const response = await fetchPort(url, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!response.ok) throw new Error(`gmail_api_${response.status}`);
  return (response.status === 204 ? null : await response.json()) as T;
};

export class GmailRuleReconciliationRunner {
  readonly #connections: GmailConnectionRepository;
  readonly #rules: RuleReconciliationRepository;
  readonly #jobs: JobRepository;
  readonly #fetchPort: OAuthFetch;

  constructor(
    connections: GmailConnectionRepository,
    rules: RuleReconciliationRepository,
    jobs: JobRepository,
    fetchPort: OAuthFetch = fetch,
  ) {
    this.#connections = connections;
    this.#rules = rules;
    this.#jobs = jobs;
    this.#fetchPort = fetchPort;
  }

  async run(jobId: string) {
    const planId = this.#rules.planIdForJob(jobId);
    for (;;) {
      const item = this.#jobs.claimNextPending(jobId);
      if (!item) break;
      const operation = this.#rules.operation(item.itemKey);
      this.#rules.setOperationRunning(operation.id);
      try {
        if (operation.provider !== 'gmail') throw new Error('gmail_rule_provider_mismatch');
        const credentials = this.#connections.credentials(operation.connectionId);
        if (!credentials) throw new Error('gmail_not_connected');
        const token = await refreshGmailAccessToken(
          credentials.connection.clientId,
          credentials.refreshToken,
          credentials.clientSecret,
          this.#fetchPort,
        );
        await this.#apply(token, operation);
        this.#jobs.transitionItem(item.id, 'succeeded', {
          result: { operation: 'provider-rule-action', verified: true },
        });
      } catch (error) {
        const code = error instanceof Error ? error.message : 'gmail_rule_failed';
        const mismatch = code === 'provider_verification_mismatch';
        this.#rules.setOperationResult(operation.id, mismatch ? 'verification_mismatch' : 'failed', { errorCode: code });
        this.#jobs.transitionItem(item.id, mismatch ? 'verification_mismatch' : 'failed', { errorCode: code });
      }
    }
    return this.#rules.syncPlanState(planId);
  }

  async undo(jobId: string) {
    const planId = this.#rules.planIdForUndoJob(jobId);
    for (;;) {
      const item = this.#jobs.claimNextPending(jobId);
      if (!item) break;
      const operation = this.#rules.operation(item.itemKey.replace(/^undo:/, ''));
      try {
        const credentials = this.#connections.credentials(operation.connectionId);
        if (!credentials) throw new Error('gmail_not_connected');
        const token = await refreshGmailAccessToken(
          credentials.connection.clientId,
          credentials.refreshToken,
          credentials.clientSecret,
          this.#fetchPort,
        );
        await this.#undoOperation(token, operation);
        this.#rules.setOperationResult(operation.id, 'undone');
        this.#jobs.transitionItem(item.id, 'succeeded', {
          result: { operation: 'provider-rule-action', verified: true },
        });
      } catch (error) {
        const code = error instanceof Error ? error.message : 'gmail_rule_undo_failed';
        const mismatch = code === 'provider_verification_mismatch';
        this.#rules.setOperationResult(operation.id, mismatch ? 'verification_mismatch' : 'failed', { errorCode: code });
        this.#jobs.transitionItem(item.id, mismatch ? 'verification_mismatch' : 'failed', { errorCode: code });
      }
    }
    return this.#rules.syncUndoState(planId);
  }

  async #apply(token: string, operation: RuleOperationRecord): Promise<void> {
    let state = await this.#state(token);
    const exact = operation.desired
      ? state.filters.find((filter) => filter.fingerprint === operation.desired!.fingerprint)
      : undefined;
    const managed = this.#rules.managedRule('gmail', operation.connectionId, operation.stableKey);

    if (operation.kind === 'unchanged') {
      const current = state.filters.find((filter) => filter.providerRuleId === managed?.provider_rule_id);
      if (!operation.desired || !current || current.fingerprint !== operation.desired.fingerprint) {
        throw new Error('provider_verification_mismatch');
      }
      this.#rules.setOperationResult(operation.id, 'succeeded', { providerRuleId: current.providerRuleId, verifiedFingerprint: current.fingerprint });
      return;
    }

    if (operation.kind === 'adopt') {
      if (!operation.desired || !exact) throw new Error('provider_verification_mismatch');
      this.#rules.activateManagedRule('gmail', operation.connectionId, operation.desired, exact.providerRuleId, 'adopted');
      this.#rules.setOperationResult(operation.id, 'succeeded', { providerRuleId: exact.providerRuleId, verifiedFingerprint: exact.fingerprint });
      return;
    }

    if (operation.kind === 'remove') {
      if (managed?.ownership === 'managed' && managed.provider_rule_id) {
        const exists = state.filters.some((filter) => filter.providerRuleId === managed.provider_rule_id);
        if (exists) await this.#deleteFilter(token, managed.provider_rule_id);
        state = await this.#state(token);
        if (state.filters.some((filter) => filter.providerRuleId === managed.provider_rule_id)) {
          throw new Error('provider_verification_mismatch');
        }
      }
      this.#rules.removeManagedRule('gmail', operation.connectionId, operation.stableKey);
      this.#rules.setOperationResult(operation.id, 'succeeded', { verifiedFingerprint: operation.prior?.fingerprint ?? null });
      return;
    }

    if (!operation.desired) throw new Error('rule_desired_state_missing');
    if (exact) {
      const ownership = operation.providerRuleId === exact.providerRuleId ? 'managed' : 'adopted';
      this.#rules.activateManagedRule('gmail', operation.connectionId, operation.desired, exact.providerRuleId, ownership);
      this.#rules.setOperationResult(operation.id, 'succeeded', { providerRuleId: exact.providerRuleId, verifiedFingerprint: exact.fingerprint });
      return;
    }

    if (operation.kind === 'replace' && managed?.ownership === 'managed' && managed.provider_rule_id) {
      if (state.filters.some((filter) => filter.providerRuleId === managed.provider_rule_id)) {
        await this.#deleteFilter(token, managed.provider_rule_id);
      }
    }
    const labelId = await this.#ensureLabel(token, state, operation.desired);
    const created = await api<{ id: string }>(this.#fetchPort, token, 'https://gmail.googleapis.com/gmail/v1/users/me/settings/filters', {
      method: 'POST',
      body: JSON.stringify(this.#filterPayload(operation.desired, labelId)),
    });
    this.#rules.setOperationProviderId(operation.id, created.id);
    state = await this.#state(token);
    const verified = state.filters.find((filter) => filter.providerRuleId === created.id);
    if (!verified || verified.fingerprint !== operation.desired.fingerprint) {
      throw new Error('provider_verification_mismatch');
    }
    this.#rules.activateManagedRule('gmail', operation.connectionId, operation.desired, created.id, 'managed');
    this.#rules.setOperationResult(operation.id, 'succeeded', { providerRuleId: created.id, verifiedFingerprint: verified.fingerprint });
  }

  async #undoOperation(token: string, operation: RuleOperationRecord): Promise<void> {
    let state = await this.#state(token);
    const current = this.#rules.managedRule('gmail', operation.connectionId, operation.stableKey);
    if (current?.ownership === 'managed' && current.provider_rule_id) {
      if (state.filters.some((filter) => filter.providerRuleId === current.provider_rule_id)) {
        await this.#deleteFilter(token, current.provider_rule_id);
      }
      state = await this.#state(token);
      if (state.filters.some((filter) => filter.providerRuleId === current.provider_rule_id)) {
        throw new Error('provider_verification_mismatch');
      }
    }

    if (operation.kind === 'create' || operation.kind === 'adopt') {
      this.#rules.removeManagedRule('gmail', operation.connectionId, operation.stableKey);
      return;
    }

    if (!operation.prior || !operation.priorManaged) {
      this.#rules.removeManagedRule('gmail', operation.connectionId, operation.stableKey);
      return;
    }
    state = await this.#state(token);
    let restored = state.filters.find((filter) => filter.fingerprint === operation.prior!.fingerprint);
    let ownership: 'managed' | 'adopted' = operation.prior.ownership === 'adopted' ? 'adopted' : 'managed';
    if (!restored) {
      const labelId = await this.#ensureLabel(token, state, operation.priorManaged);
      const created = await api<{ id: string }>(this.#fetchPort, token, 'https://gmail.googleapis.com/gmail/v1/users/me/settings/filters', {
        method: 'POST',
        body: JSON.stringify(this.#filterPayload(operation.priorManaged, labelId)),
      });
      state = await this.#state(token);
      restored = state.filters.find((filter) => filter.providerRuleId === created.id);
      ownership = 'managed';
    }
    if (!restored || restored.fingerprint !== operation.prior.fingerprint) {
      throw new Error('provider_verification_mismatch');
    }
    this.#rules.activateManagedRule('gmail', operation.connectionId, operation.priorManaged, restored.providerRuleId, ownership);
  }

  async #state(token: string): Promise<ProviderState> {
    const [labelsPayload, filtersPayload] = await Promise.all([
      api<{ labels?: Array<{ id: string; name: string }> }>(this.#fetchPort, token, 'https://gmail.googleapis.com/gmail/v1/users/me/labels'),
      api<{ filter?: GmailFilterResource[] }>(this.#fetchPort, token, 'https://gmail.googleapis.com/gmail/v1/users/me/settings/filters'),
    ]);
    const labelsById = new Map((labelsPayload.labels ?? []).map((label) => [label.id, label.name]));
    return {
      labelsById,
      labelIdsByName: new Map((labelsPayload.labels ?? []).map((label) => [label.name, label.id])),
      filters: (filtersPayload.filter ?? []).map((filter) => normalizeGmailFilter(filter, labelsById)),
    };
  }

  async #ensureLabel(token: string, state: ProviderState, desired: DesiredManagedRule): Promise<string> {
    if (desired.spam) return 'SPAM';
    const existing = state.labelIdsByName.get(desired.targetPath);
    if (existing) return existing;
    const created = await api<{ id: string; name: string }>(this.#fetchPort, token, 'https://gmail.googleapis.com/gmail/v1/users/me/labels', {
      method: 'POST',
      body: JSON.stringify({ name: desired.targetPath, labelListVisibility: 'labelShow', messageListVisibility: 'show' }),
    });
    state.labelsById.set(created.id, desired.targetPath);
    state.labelIdsByName.set(desired.targetPath, created.id);
    return created.id;
  }

  #filterPayload(desired: DesiredManagedRule, labelId: string) {
    return {
      criteria: {
        from: `@${desired.senderDomain}`,
        ...(desired.receivingAddress ? { to: desired.receivingAddress } : {}),
      },
      action: {
        addLabelIds: [labelId],
        removeLabelIds: [...(desired.archive ? ['INBOX'] : []), ...(desired.markRead ? ['UNREAD'] : [])],
      },
    };
  }

  async #deleteFilter(token: string, providerRuleId: string): Promise<void> {
    await api<null>(
      this.#fetchPort,
      token,
      `https://gmail.googleapis.com/gmail/v1/users/me/settings/filters/${encodeURIComponent(providerRuleId)}`,
      { method: 'DELETE' },
    );
  }
}
