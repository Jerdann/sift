import { createHash } from 'node:crypto';
import type { AccountProvider } from '../../shared/contracts/accounts';
import type { MailCategory } from '../../shared/contracts/analysis';
import type {
  DesiredManagedRule,
  NormalizedRuleAction,
  NormalizedRuleCriteria,
  ProviderRuleSnapshot,
} from '../../shared/contracts/rule-management';

export interface GmailFilterResource {
  id: string;
  criteria?: {
    from?: string;
    to?: string;
    subject?: string;
    query?: string;
    negatedQuery?: string;
    hasAttachment?: boolean;
  };
  action?: { addLabelIds?: string[]; removeLabelIds?: string[] };
}

const normalizedText = (value?: string): string | null => value?.trim().toLowerCase() || null;
const canonical = (value: unknown): string => JSON.stringify(value);
export const sha256 = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex');

export const normalizeCriteria = (criteria: GmailFilterResource['criteria'] = {}): NormalizedRuleCriteria => ({
  from: normalizedText(criteria.from),
  to: normalizedText(criteria.to),
  subject: normalizedText(criteria.subject),
  query: normalizedText(criteria.query),
  negatedQuery: normalizedText(criteria.negatedQuery),
  hasAttachment: typeof criteria.hasAttachment === 'boolean' ? criteria.hasAttachment : null,
});

const normalizedLabels = (values: string[] | undefined, labelNames: ReadonlyMap<string, string>): string[] =>
  [...new Set((values ?? []).map((value) => labelNames.get(value) ?? value).map((value) => value.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));

export const normalizeGmailFilter = (
  filter: GmailFilterResource,
  labelNames: ReadonlyMap<string, string> = new Map(),
): Omit<ProviderRuleSnapshot, 'stableKey' | 'ownership'> => {
  const criteria = normalizeCriteria(filter.criteria);
  const action: NormalizedRuleAction = {
    addLabels: normalizedLabels(filter.action?.addLabelIds, labelNames),
    removeLabels: normalizedLabels(filter.action?.removeLabelIds, labelNames),
  };
  return {
    providerRuleId: filter.id,
    fingerprint: sha256({ criteria, action }),
    criteria,
    action,
  };
};

export const managedRuleIdentity = (
  provider: AccountProvider,
  connectionId: string,
  senderDomain: string,
  receivingAddress: string | null,
): string => sha256([
  'sift-managed-rule-v1', provider, connectionId,
  senderDomain.trim().toLowerCase(), receivingAddress?.trim().toLowerCase() ?? null,
]);

export const desiredRule = (input: {
  provider: AccountProvider;
  connectionId: string;
  senderDomain: string;
  receivingAddress: string | null;
  category: MailCategory;
  targetPath: string;
  markRead: boolean;
  archive: boolean;
  spam: boolean;
  observedMessages: number;
  confidence: number;
  categoryShare?: number;
}): DesiredManagedRule => {
  const senderDomain = input.senderDomain.trim().toLowerCase();
  const receivingAddress = input.receivingAddress?.trim().toLowerCase() ?? null;
  const criteria: NormalizedRuleCriteria = {
    from: `@${senderDomain}`,
    to: receivingAddress,
    subject: null,
    query: null,
    negatedQuery: null,
    hasAttachment: null,
  };
  const action: NormalizedRuleAction = {
    addLabels: [input.spam ? 'SPAM' : input.targetPath],
    removeLabels: [...(input.archive ? ['INBOX'] : []), ...(input.markRead ? ['UNREAD'] : [])].sort(),
  };
  return {
    stableKey: managedRuleIdentity(input.provider, input.connectionId, senderDomain, receivingAddress),
    fingerprint: sha256({ criteria, action }),
    senderDomain,
    receivingAddress,
    category: input.category,
    targetPath: input.targetPath,
    markRead: input.markRead,
    archive: input.archive,
    spam: input.spam,
    observedMessages: input.observedMessages,
    confidence: input.confidence,
    categoryShare: input.categoryShare ?? 1,
  };
};

export const snapshotForDesiredRule = (
  providerRuleId: string,
  rule: DesiredManagedRule,
): Omit<ProviderRuleSnapshot, 'stableKey' | 'ownership'> => ({
  providerRuleId,
  fingerprint: rule.fingerprint,
  criteria: {
    from: `@${rule.senderDomain}`,
    to: rule.receivingAddress,
    subject: null,
    query: null,
    negatedQuery: null,
    hasAttachment: null,
  },
  action: {
    addLabels: [rule.spam ? 'SPAM' : rule.targetPath],
    removeLabels: [...(rule.archive ? ['INBOX'] : []), ...(rule.markRead ? ['UNREAD'] : [])].sort(),
  },
});

const sieveEscape = (value: string): string => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

export const renderManagedProtonSieve = (rules: readonly DesiredManagedRule[]): string => {
  const lines = [
    'require ["fileinto", "imap4flags"];',
    '',
    '# Sift managed export. Review and import manually in Proton Mail.',
    '# Re-export replaces the Sift-managed script; unrelated Proton filters are outside this manifest.',
    '',
  ];
  for (const rule of [...rules].sort((left, right) => left.stableKey.localeCompare(right.stableKey))) {
    const conditions = [`address :domain :is "from" "${sieveEscape(rule.senderDomain)}"`];
    if (rule.receivingAddress) conditions.push(`address :is ["delivered-to", "x-original-to"] "${sieveEscape(rule.receivingAddress)}"`);
    lines.push(`# sift-rule:${rule.stableKey}`);
    lines.push(`# ${rule.category} · ${rule.observedMessages} observed · ${Math.round(rule.confidence * 100)}% confidence`);
    lines.push(conditions.length === 1 ? `if ${conditions[0]} {` : `if allof (${conditions.join(', ')}) {`);
    if (rule.markRead) lines.push('  addflag "\\\\Seen";');
    lines.push(`  fileinto "${sieveEscape(rule.targetPath)}";`);
    lines.push('  stop;', '}', '');
  }
  return `${lines.join('\n').trimEnd()}\n`;
};
