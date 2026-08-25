import { normalizeGmailFilter, type GmailFilterResource } from '../../core/rules/rule-reconciliation';
import type { RuleInventory } from '../../shared/contracts/rule-management';
import type { RuleReconciliationRepository } from '../rules/rule-reconciliation-repository';
import type { GmailConnectionRepository } from './gmail-connection-repository';
import { refreshGmailAccessToken, type OAuthFetch } from './gmail-oauth';

const gmailApi = async <T>(fetchPort: OAuthFetch, accessToken: string, url: string): Promise<T> => {
  const response = await fetchPort(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`gmail_api_${response.status}`);
  return await response.json() as T;
};

export class GmailRuleInventoryService {
  readonly #connections: GmailConnectionRepository;
  readonly #rules: RuleReconciliationRepository;
  readonly #fetchPort: OAuthFetch;

  constructor(connections: GmailConnectionRepository, rules: RuleReconciliationRepository, fetchPort: OAuthFetch = fetch) {
    this.#connections = connections;
    this.#rules = rules;
    this.#fetchPort = fetchPort;
  }

  async refresh(connectionId: string): Promise<RuleInventory> {
    const credentials = this.#connections.credentials(connectionId);
    if (!credentials) throw new Error('gmail_not_connected');
    const token = await refreshGmailAccessToken(
      credentials.connection.clientId,
      credentials.refreshToken,
      credentials.clientSecret,
      this.#fetchPort,
    );
    const [labelPayload, filterPayload] = await Promise.all([
      gmailApi<{ labels?: Array<{ id: string; name: string }> }>(this.#fetchPort, token, 'https://gmail.googleapis.com/gmail/v1/users/me/labels'),
      gmailApi<{ filter?: GmailFilterResource[] }>(this.#fetchPort, token, 'https://gmail.googleapis.com/gmail/v1/users/me/settings/filters'),
    ]);
    const labelNames = new Map((labelPayload.labels ?? []).map((label) => [label.id, label.name]));
    const snapshots = (filterPayload.filter ?? []).map((filter) => normalizeGmailFilter(filter, labelNames));
    return this.#rules.saveInventory('gmail', connectionId, 'live_api', snapshots, 1_000);
  }
}
