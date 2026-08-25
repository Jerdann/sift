import type { MailCategory } from '../../shared/contracts/analysis';

export const subscriptionPriorityScore = (
  messageCount: number,
  latestAt: string | null,
  categories: readonly MailCategory[],
  now = Date.now(),
): number => {
  const ageDays = latestAt ? Math.max(0, Math.floor((now - Date.parse(latestAt)) / 86_400_000)) : 730;
  const volume = Math.log2(Math.max(1, messageCount) + 1) * 18;
  const activity = Math.max(0, 120 - Math.min(120, ageDays));
  const lowValue = categories.includes('promotions') ? 24 : categories.includes('subscriptions') ? 14 : 0;
  return Math.round((volume + activity + lowValue) * 10) / 10;
};
