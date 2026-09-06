import type { AccountProvider } from "../../shared/contracts/accounts";
import type { ClassificationResult } from "./mail-classifier";
import type {
  HandlingPreferences,
  SenderHandlingRule,
} from "../../shared/contracts/mail-handling";
import { removableCategories, PURPOSE_RULES } from "./message-purpose";

export const senderRuleAllowed = (category: ClassificationResult["category"]) =>
  category === "other" || removableCategories.has(category);
export const ruleMarker = "User-selected sender rule: ";
export const ruleIdFromEvidence = (evidence: string): string | null => {
  const entry = (JSON.parse(evidence) as string[]).find((item) =>
    item.startsWith(ruleMarker),
  );
  return entry?.slice(ruleMarker.length) ?? null;
};
export const ruleFromEvidence = (
  preferences: HandlingPreferences,
  evidence: readonly string[],
) => preferences.rules?.find((rule) => evidence.includes(ruleMarker + rule.id));
export const preferencesForEvidence = (
  preferences: HandlingPreferences,
  evidence: readonly string[],
): HandlingPreferences => {
  const rule = ruleFromEvidence(preferences, evidence);
  return rule
    ? {
        ...preferences,
        categories: {
          ...preferences.categories,
          [rule.category]: rule.handling,
        },
      }
    : preferences;
};
export const applySenderHandling = (
  base: ClassificationResult,
  preferences: HandlingPreferences,
  sender: string,
  subject: string,
  address: string | null,
): ClassificationResult => {
  if (!address || !senderRuleAllowed(base.category)) return base;
  const rule = preferences.rules?.find(
    (rule) =>
      rule.address.toLowerCase() === address.toLowerCase() &&
      rule.sender.toLowerCase() === sender.toLowerCase() &&
      (!rule.subjectContains ||
        subject.toLowerCase().includes(rule.subjectContains.toLowerCase())),
  );
  return rule
    ? {
        ...base,
        category: rule.category,
        confidence: 1,
        evidence: [
          ruleMarker + rule.id,
          "You chose this sender and matching subjects.",
        ],
      }
    : base;
};
export const senderRuleConditions = (
  rule: SenderHandlingRule,
  aliases: string[],
  provider: AccountProvider = "proton",
) => ({
  senderAddresses: [rule.sender.toLowerCase()],
  receivingAddress: rule.address.toLowerCase(),
  excludedReceivingAddresses: aliases.filter(
    (a) => a.toLowerCase() !== rule.address.toLowerCase(),
  ),
  subjectPatterns: rule.subjectContains
    ? ["*" + rule.subjectContains + "*"]
    : ["*"],
  excludeSubjectPatterns: PURPOSE_RULES.filter(
    (r) => !senderRuleAllowed(r.category),
  )
    .flatMap((r) => r.patterns)
    .map((pattern) =>
      provider === "proton"
        ? pattern
        : "*" +
          (pattern
            .split("*")
            .filter(Boolean)
            .sort((a, b) => b.length - a.length)[0] ?? "") +
          "*",
    ),
});
