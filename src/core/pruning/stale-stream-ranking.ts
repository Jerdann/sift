import type { MailCategory, SenderStream } from '../../shared/contracts/analysis';

export interface StaleStreamCandidate {
  domain: string;
  latestAt: string | null;
  ageDays: number;
  messages: number;
  protected: number;
  addresses: string[];
}

export const TRASH_PROTECTED_CATEGORIES = new Set<MailCategory>([
  'personal', 'security', 'accounts', 'transactions', 'finance', 'suspicious',
]);

export const rankStaleStreams = (
  streams: readonly SenderStream[],
  olderThanDays = 180,
  now = Date.now(),
): StaleStreamCandidate[] => [...new Set(streams.map((stream) => stream.senderDomain))]
  .map((domain) => {
    const domainStreams = streams.filter((stream) => stream.senderDomain === domain);
    const latestAt = domainStreams.map((stream) => stream.latestAt).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
    const ageDays = latestAt ? Math.max(0, Math.floor((now - Date.parse(latestAt)) / 86_400_000)) : Number.POSITIVE_INFINITY;
    return {
      domain,
      latestAt,
      ageDays,
      messages: domainStreams.filter((stream) => !TRASH_PROTECTED_CATEGORIES.has(stream.category)).reduce((sum, stream) => sum + stream.messageCount, 0),
      protected: domainStreams.filter((stream) => TRASH_PROTECTED_CATEGORIES.has(stream.category)).reduce((sum, stream) => sum + stream.messageCount, 0),
      addresses: [...new Set(domainStreams.map((stream) => stream.receivingAddress))].sort(),
    };
  })
  .filter((candidate) => candidate.messages > 0 && candidate.ageDays > olderThanDays)
  .sort((left, right) => right.messages - left.messages || right.ageDays - left.ageDays || left.domain.localeCompare(right.domain));
