import { sha256 } from "../../core/rules/rule-reconciliation";
import type {
  NormalizedRuleAction,
  NormalizedRuleCriteria,
  ProviderRuleSnapshot,
} from "../../shared/contracts/rule-management";

export interface GraphMessageRule {
  id: string;
  displayName?: string;
  conditions?: {
    senderContains?: string[];
    recipientContains?: string[];
    subjectContains?: string[];
  };
  actions?: { moveToFolder?: string; markAsRead?: boolean; delete?: boolean };
}

export const normalizeOutlookRule = (
  rule: GraphMessageRule,
  folders: ReadonlyMap<string, string>,
  specialFolders: { inboxId: string; junkId: string },
): Omit<ProviderRuleSnapshot, "stableKey" | "ownership"> => {
  const sender =
    rule.conditions?.senderContains?.[0]?.trim().toLowerCase() ?? null;
  const recipient =
    rule.conditions?.recipientContains?.[0]?.trim().toLowerCase() ?? null;
  const subject =
    rule.conditions?.subjectContains?.[0]?.trim().toLowerCase() ?? null;
  const destination = rule.actions?.moveToFolder;
  const label =
    destination === specialFolders.junkId
      ? "SPAM"
      : destination
        ? (folders.get(destination) ?? destination)
        : null;
  const criteria: NormalizedRuleCriteria = {
    from: sender,
    to: recipient,
    subject,
    query: null,
    negatedQuery: null,
    hasAttachment: null,
  };
  const action: NormalizedRuleAction = {
    addLabels: label ? [label] : [],
    removeLabels: [
      ...(destination && destination !== specialFolders.inboxId
        ? ["INBOX"]
        : []),
      ...(rule.actions?.markAsRead ? ["UNREAD"] : []),
    ].sort(),
  };
  return {
    providerRuleId: rule.id,
    fingerprint: sha256({ criteria, action }),
    criteria,
    action,
  };
};
