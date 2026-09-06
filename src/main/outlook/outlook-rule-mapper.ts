import { sha256 } from "../../core/rules/rule-reconciliation";
import { serializePredicates } from "../../core/rules/purpose-filter";
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
    fromAddresses?: Array<{ emailAddress: { address: string; name?: string } }>;
    sentToAddresses?: Array<{
      emailAddress: { address: string; name?: string };
    }>;
    [key: string]: unknown;
  };
  exceptions?: Record<string, unknown>;
  isEnabled?: boolean;
  isReadOnly?: boolean;
  hasError?: boolean;
  actions?: {
    moveToFolder?: string;
    markAsRead?: boolean;
    delete?: boolean;
    stopProcessingRules?: boolean;
    [key: string]: unknown;
  };
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
  const label = rule.actions?.delete
    ? "TRASH"
    : destination === specialFolders.junkId
      ? "SPAM"
      : destination
        ? (folders.get(destination) ?? destination)
        : null;
  const criteria: NormalizedRuleCriteria = {
    from: sender,
    to: recipient,
    subject: rule.conditions?.fromAddresses ? null : subject,
    query:
      rule.conditions?.fromAddresses ||
      (rule.exceptions && Object.keys(rule.exceptions).length) ||
      Object.values(rule.conditions ?? {}).some(
        (v) => Array.isArray(v) && v.length > 1,
      ) ||
      Object.keys(rule.conditions ?? {}).some(
        (key) =>
          !["senderContains", "recipientContains", "subjectContains"].includes(
            key,
          ),
      )
        ? serializePredicates({
            conditions: rule.conditions ?? {},
            exceptions: rule.exceptions ?? {},
          })
        : null,
    // A disabled, broken or more powerful external rule is not identical to a
    // Sift rule. Preserve opaque effects so it cannot be silently adopted.
    negatedQuery:
      rule.isEnabled === false ||
      rule.isReadOnly ||
      rule.hasError ||
      rule.actions?.stopProcessingRules === false ||
      Object.entries(rule.actions ?? {}).some(
        ([key, value]) =>
          ![
            "moveToFolder",
            "markAsRead",
            "delete",
            "stopProcessingRules",
          ].includes(key) &&
          value !== false &&
          value !== null &&
          !(Array.isArray(value) && !value.length),
      )
        ? serializePredicates({
            externalRule: true,
            disabled: rule.isEnabled === false,
            readOnly: rule.isReadOnly,
            hasError: rule.hasError,
            continues: rule.actions?.stopProcessingRules === false,
            actions: rule.actions,
          })
        : null,
    hasAttachment: null,
  };
  const action: NormalizedRuleAction = {
    addLabels: label ? [label] : [],
    removeLabels: [
      ...(rule.actions?.delete ||
      (destination && destination !== specialFolders.inboxId)
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
