import type { JobRepository } from '../jobs/job-repository';
import type { GmailConnectionRepository } from './gmail-connection-repository';
import type { GmailHistoryBatchRecord, GmailOrganizationRepository } from './gmail-organization-repository';
import { refreshGmailAccessToken, type OAuthFetch } from './gmail-oauth';

const api = async <T>(fetchPort: OAuthFetch, token: string, url: string, init: RequestInit = {}): Promise<T> => {
  const response = await fetchPort(url, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!response.ok) throw new Error(`gmail_api_${response.status}`);
  return (response.status === 204 ? null : await response.json()) as T;
};

const same = (left: readonly string[] | undefined, right: readonly string[] | undefined): boolean =>
  JSON.stringify([...(left ?? [])].sort()) === JSON.stringify([...(right ?? [])].sort());

const mapMatches = (actual: Record<string, string[]>, expected: Record<string, string[]>, ids: readonly string[]): boolean =>
  ids.every((id) => same(actual[id], expected[id]));

export class GmailOrganizationRunner {
  readonly #connections: GmailConnectionRepository;
  readonly #plans: GmailOrganizationRepository;
  readonly #jobs: JobRepository;
  readonly #fetchPort: OAuthFetch;

  constructor(connections: GmailConnectionRepository, plans: GmailOrganizationRepository, jobs: JobRepository, fetchPort: OAuthFetch = fetch) {
    this.#connections = connections;
    this.#plans = plans;
    this.#jobs = jobs;
    this.#fetchPort = fetchPort;
  }

  async run(jobId: string, onProgress?: (plan: ReturnType<GmailOrganizationRepository['sync']>) => void) {
    const planId = this.#plans.planIdForJob(jobId);
    const labels = new Map<string, string>();
    const tokens = new Map<string, string>();
    for (;;) {
      const item = this.#jobs.claimNextPending(jobId);
      if (!item) break;
      const batch = this.#plans.batch(item.itemKey);
      this.#plans.markBatch(batch.id, 'running');
      try {
        const token = await this.#token(batch.connectionId, tokens);
        const targetLabelId = batch.trash ? 'TRASH' : batch.spam ? 'SPAM' : await this.#labelId(token, batch.targetLabel, labels);
        const desired = Object.fromEntries(batch.messageIds.map((id) => {
          const next = new Set(batch.priorLabels[id] ?? []);
          next.add(targetLabelId);
          if (batch.archive || batch.spam || batch.trash) next.delete('INBOX');
          if (batch.trash) next.delete('SPAM');
          if (batch.markRead) next.delete('UNREAD');
          return [id, [...next].sort()];
        }));
        const current = await this.#readLabels(token, batch.messageIds);
        if (!mapMatches(current, desired, batch.messageIds)) {
          if (!mapMatches(current, batch.priorLabels, batch.messageIds)) throw new Error('provider_verification_mismatch');
          await this.#batchModify(token, batch.messageIds, [targetLabelId], [
            ...((batch.archive || batch.spam || batch.trash) ? ['INBOX'] : []),
            ...(batch.trash ? ['SPAM'] : []),
            ...(batch.markRead ? ['UNREAD'] : []),
          ]);
        }
        const verified = await this.#readLabels(token, batch.messageIds);
        if (!mapMatches(verified, desired, batch.messageIds)) throw new Error('provider_verification_mismatch');
        this.#plans.syncIndexedLabels(batch.connectionId, verified);
        this.#plans.markBatch(batch.id, 'succeeded', null, verified);
        this.#jobs.transitionItem(item.id, 'succeeded', { result: { operation: 'gmail-history-batch', verified: true } });
      } catch (error) {
        const code = error instanceof Error ? error.message : 'gmail_history_failed';
        const state = code === 'provider_verification_mismatch' ? 'verification_mismatch' : 'failed';
        this.#plans.markBatch(batch.id, state, code);
        this.#jobs.transitionItem(item.id, state, { errorCode: code });
      }
      onProgress?.(this.#plans.sync(planId));
    }
    return this.#plans.sync(planId);
  }

  async undo(jobId: string, onProgress?: (plan: ReturnType<GmailOrganizationRepository['sync']>) => void) {
    const planId = this.#plans.planIdForJob(jobId);
    const tokens = new Map<string, string>();
    for (;;) {
      const item = this.#jobs.claimNextPending(jobId);
      if (!item) break;
      const batch = this.#plans.batch(item.itemKey.replace(/^undo:/, ''));
      this.#plans.markUndo(batch.id, 'running');
      try {
        if (!batch.resultingLabels) throw new Error('gmail_history_undo_receipt_missing');
        const token = await this.#token(batch.connectionId, tokens);
        const current = await this.#readLabels(token, batch.messageIds);
        if (!mapMatches(current, batch.resultingLabels, batch.messageIds)) throw new Error('provider_verification_mismatch');
        const groups = new Map<string, { ids: string[]; add: string[]; remove: string[] }>();
        for (const id of batch.messageIds) {
          const prior = new Set(batch.priorLabels[id] ?? []);
          const resulting = new Set(batch.resultingLabels[id] ?? []);
          const add = [...prior].filter((label) => !resulting.has(label)).sort();
          const remove = [...resulting].filter((label) => !prior.has(label)).sort();
          const key = JSON.stringify([add, remove]);
          const group = groups.get(key) ?? { ids: [], add, remove };
          group.ids.push(id);
          groups.set(key, group);
        }
        for (const group of groups.values()) await this.#batchModify(token, group.ids, group.add, group.remove);
        const verified = await this.#readLabels(token, batch.messageIds);
        if (!mapMatches(verified, batch.priorLabels, batch.messageIds)) throw new Error('provider_verification_mismatch');
        this.#plans.syncIndexedLabels(batch.connectionId, verified);
        this.#plans.markUndo(batch.id, 'succeeded');
        this.#jobs.transitionItem(item.id, 'succeeded', { result: { operation: 'gmail-history-batch', verified: true } });
      } catch (error) {
        const code = error instanceof Error ? error.message : 'gmail_history_undo_failed';
        const state = code === 'provider_verification_mismatch' ? 'verification_mismatch' : 'failed';
        this.#plans.markUndo(batch.id, state, code);
        this.#jobs.transitionItem(item.id, state, { errorCode: code });
      }
      onProgress?.(this.#plans.sync(planId));
    }
    return this.#plans.sync(planId);
  }

  async #token(connectionId: string, cache: Map<string, string>): Promise<string> {
    const cached = cache.get(connectionId);
    if (cached) return cached;
    const credentials = this.#connections.credentials(connectionId);
    if (!credentials) throw new Error('gmail_not_connected');
    const token = await refreshGmailAccessToken(credentials.connection.clientId, credentials.refreshToken, credentials.clientSecret, this.#fetchPort);
    cache.set(connectionId, token);
    return token;
  }

  async #labelId(token: string, name: string, cache: Map<string, string>): Promise<string> {
    if (!cache.size) {
      const payload = await api<{ labels?: Array<{ id: string; name: string }> }>(this.#fetchPort, token, 'https://gmail.googleapis.com/gmail/v1/users/me/labels');
      for (const label of payload.labels ?? []) cache.set(label.name, label.id);
    }
    let id = cache.get(name);
    if (id) return id;
    const created = await api<{ id: string }>(this.#fetchPort, token, 'https://gmail.googleapis.com/gmail/v1/users/me/labels', {
      method: 'POST', body: JSON.stringify({ name, labelListVisibility: 'labelShow', messageListVisibility: 'show' }),
    });
    id = created.id;
    cache.set(name, id);
    return id;
  }

  async #readLabels(token: string, ids: readonly string[]): Promise<Record<string, string[]>> {
    const result: Record<string, string[]> = {};
    for (let offset = 0; offset < ids.length; offset += 10) {
      await Promise.all(ids.slice(offset, offset + 10).map(async (id) => {
        const message = await api<{ id: string; labelIds?: string[] }>(this.#fetchPort, token, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=minimal`);
        result[id] = [...(message.labelIds ?? [])].sort();
      }));
    }
    return result;
  }

  async #batchModify(token: string, ids: readonly string[], addLabelIds: readonly string[], removeLabelIds: readonly string[]): Promise<void> {
    await api(this.#fetchPort, token, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/batchModify', {
      method: 'POST', body: JSON.stringify({ ids, addLabelIds, removeLabelIds }),
    });
  }
}
