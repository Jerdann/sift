import { createHash } from "node:crypto";
import type { AccountProvider } from "../../shared/contracts/accounts";
import type { MailCategory } from "../../shared/contracts/analysis";
import {
  gmailPurposeCriteria,
  outlookPurposePredicates,
  serializePredicates,
  type PurposeConditions,
} from "./purpose-filter";
import type {
  DesiredManagedRule,
  NormalizedRuleAction,
  NormalizedRuleCriteria,
  ProviderRuleSnapshot,
} from "../../shared/contracts/rule-management";

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

const normalizedText = (value?: string): string | null =>
  value?.trim().toLowerCase() || null;
const canonical = (value: unknown): string => JSON.stringify(value);
export const sha256 = (value: unknown): string =>
  createHash("sha256").update(canonical(value)).digest("hex");

export const normalizeCriteria = (
  criteria: GmailFilterResource["criteria"] = {},
): NormalizedRuleCriteria => ({
  from: normalizedText(criteria.from),
  to: normalizedText(criteria.to),
  subject: normalizedText(criteria.subject),
  query: normalizedText(criteria.query),
  negatedQuery: normalizedText(criteria.negatedQuery),
  hasAttachment:
    typeof criteria.hasAttachment === "boolean" ? criteria.hasAttachment : null,
});

const normalizedLabels = (
  values: string[] | undefined,
  labelNames: ReadonlyMap<string, string>,
): string[] =>
  [
    ...new Set(
      (values ?? [])
        .map((value) => labelNames.get(value) ?? value)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ].sort((left, right) => left.localeCompare(right));

export const normalizeGmailFilter = (
  filter: GmailFilterResource,
  labelNames: ReadonlyMap<string, string> = new Map(),
): Omit<ProviderRuleSnapshot, "stableKey" | "ownership"> => {
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
): string =>
  sha256([
    "sift-managed-rule-v1",
    provider,
    connectionId,
    senderDomain.trim().toLowerCase(),
    receivingAddress?.trim().toLowerCase() ?? null,
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
  identityCategory?: MailCategory;
  senderRuleId?: string;
  purposeConditions?: PurposeConditions;
  trash?: boolean;
  matchNote?: string;
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
    addLabels: [input.trash ? "TRASH" : input.spam ? "SPAM" : input.targetPath],
    removeLabels: [
      ...(input.archive ? ["INBOX"] : []),
      ...(input.markRead ? ["UNREAD"] : []),
    ].sort(),
  };
  if (input.purposeConditions) {
    if (input.provider === "gmail")
      Object.assign(
        criteria,
        normalizeCriteria(gmailPurposeCriteria(input.purposeConditions)),
      );
    else if (input.provider === "outlook") {
      Object.assign(criteria, {
        from: null,
        to: null,
        query: serializePredicates(
          outlookPurposePredicates(input.purposeConditions),
        ),
      });
    } else criteria.query = JSON.stringify(input.purposeConditions);
  }
  return {
    stableKey: input.purposeConditions
      ? sha256([
          "sift-purpose-rule-v2",
          input.provider,
          input.connectionId,
          senderDomain,
          receivingAddress,
          input.senderRuleId ?? input.identityCategory ?? input.category,
        ])
      : managedRuleIdentity(
          input.provider,
          input.connectionId,
          senderDomain,
          receivingAddress,
        ),
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
    ...(input.purposeConditions
      ? {
          purposeConditions: input.purposeConditions,
          compiledCriteria: criteria,
          trash: input.trash ?? false,
          matchNote: input.matchNote,
        }
      : {}),
  };
};

export const snapshotForDesiredRule = (
  providerRuleId: string,
  rule: DesiredManagedRule,
): Omit<ProviderRuleSnapshot, "stableKey" | "ownership"> => ({
  providerRuleId,
  fingerprint: rule.fingerprint,
  criteria: rule.compiledCriteria ?? {
    from: `@${rule.senderDomain}`,
    to: rule.receivingAddress,
    subject: null,
    query: null,
    negatedQuery: null,
    hasAttachment: null,
  },
  action: {
    addLabels: [rule.trash ? "TRASH" : rule.spam ? "SPAM" : rule.targetPath],
    removeLabels: [
      ...(rule.archive ? ["INBOX"] : []),
      ...(rule.markRead ? ["UNREAD"] : []),
    ].sort(),
  },
});

const sieveEscape = (value: string): string =>
  value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

export const renderManagedProtonSieve = (
  rules: readonly DesiredManagedRule[],
): string => {
  const list = (values: readonly string[]) =>
    "[" +
    values.map((value) => '"' + sieveEscape(value) + '"').join(", ") +
    "]";
  const groups = new Map<string, DesiredManagedRule[]>();
  for (const rule of [...rules].sort((a, b) =>
    a.stableKey.localeCompare(b.stableKey),
  )) {
    const c = rule.purposeConditions;
    if (!c?.subjectPatterns.length || !c.senderAddresses.length)
      throw new Error("purpose_conditions_required");
    const key = JSON.stringify([
      c.subjectPatterns,
      c.excludeSubjectPatterns,
      c.mailingList ?? false,
    ]);
    groups.set(key, [...(groups.get(key) ?? []), rule]);
  }
  const lines = [
    'require ["fileinto", "imap4flags"];',
    "# Sift: review this file, then replace the previous Sift script in Proton Mail.",
    "# Only observed sender addresses and the chosen delivery address are matched.",
    "# Replies and failed authentication are left unchanged by this script.",
    'if allof (not anyof (exists "in-reply-to", exists "references"),',
    '  not header :matches "subject" ["Re:*", "Fwd:*", "Fw:*"],',
    '  not header :contains "authentication-results" ["spf=fail", "spf=softfail", "dkim=fail", "dmarc=fail", "permerror"]) {',
  ];
  // Evaluate each purpose once, not once per sender. All saved exclusions remain
  // present even when an earlier category has no enabled destination.
  for (const group of groups.values()) {
    const c = group[0]!.purposeConditions!;
    const tests = ['header :matches "subject" ' + list(c.subjectPatterns)];
    if (c.mailingList)
      tests.push(
        'anyof (header :matches "list-id" "?*", header :matches "list-unsubscribe" "?*")',
      );
    if (c.excludeSubjectPatterns.length)
      tests.push(
        'not header :matches "subject" ' + list(c.excludeSubjectPatterns),
      );
    lines.push("  if allof (" + tests.join(", ") + ") {");
    const routes = new Map<string, DesiredManagedRule[]>();
    for (const rule of group) {
      const key = JSON.stringify([
        rule.receivingAddress,
        rule.targetPath,
        rule.markRead,
        rule.purposeConditions?.excludedReceivingAddresses ?? [],
      ]);
      routes.set(key, [...(routes.get(key) ?? []), rule]);
    }
    for (const route of routes.values()) {
      const rule = route[0]!,
        conditions = rule.purposeConditions!;
      const tests = [
        'address :is "from" ' +
          list([
            ...new Set(
              route.flatMap((r) => r.purposeConditions!.senderAddresses),
            ),
          ]),
      ];
      tests.push(
        'address :is ["delivered-to", "x-original-to"] "' +
          sieveEscape(conditions.receivingAddress) +
          '"',
      );
      if (conditions.excludedReceivingAddresses?.length)
        tests.push(
          'not address :is ["to", "cc", "delivered-to", "x-original-to"] ' +
            list(conditions.excludedReceivingAddresses),
        );
      for (const r of route) lines.push("    # sift-rule:" + r.stableKey);
      lines.push("    if allof (" + tests.join(", ") + ") {");
      if (rule.markRead) lines.push('      addflag "\\\\Seen";');
      lines.push(
        '      fileinto "' + sieveEscape(rule.targetPath) + '";',
        "      stop;",
        "    }",
      );
    }
    lines.push("  }");
  }
  lines.push("}");
  return lines.join("\n") + "\n";
};
