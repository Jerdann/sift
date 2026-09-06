import type { MailCategory } from "../../shared/contracts/analysis";
import type { AccountProvider } from "../../shared/contracts/accounts";
import {
  patternsFor,
  exclusionsFor,
  matchesPattern,
} from "../classification/message-purpose";

export interface PurposeConditions {
  subjectPatterns: string[];
  excludeSubjectPatterns: string[];
  senderAddresses: string[];
  receivingAddress: string;
  excludedReceivingAddresses?: string[];
}

// Graph and Gmail cannot express ordered wildcard gaps. Use only contiguous
// positive phrases; negative guards deliberately over-exclude rather than let
// a protected message fall through to a destructive or mark-read rule.
export const purposeConditions = (
  provider: AccountProvider,
  category: MailCategory,
  senders: string[],
  address: string,
): PurposeConditions => {
  const positive = [...patternsFor(category)];
  const negative = [...exclusionsFor(category)];
  const longest = (pattern: string) =>
    pattern
      .split("*")
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)[0] ?? "";
  return {
    subjectPatterns:
      provider === "proton"
        ? positive
        : positive.filter(
            (pattern) =>
              pattern.startsWith("*") &&
              pattern.endsWith("*") &&
              pattern.split("*").filter(Boolean).length === 1,
          ),
    excludeSubjectPatterns:
      provider === "proton"
        ? negative
        : [...new Set(negative.map((pattern) => `*${longest(pattern)}*`))],
    senderAddresses: [
      ...new Set(senders.map((sender) => sender.trim().toLowerCase())),
    ].sort(),
    receivingAddress: address.toLowerCase(),
  };
};

export const matchesPurposeConditions = (
  conditions: PurposeConditions,
  subject: string,
  sender: string,
  addresses: readonly string[],
): boolean =>
  conditions.senderAddresses.includes(sender.toLowerCase()) &&
  addresses.map((a) => a.toLowerCase()).includes(conditions.receivingAddress) &&
  !addresses.some((a) =>
    conditions.excludedReceivingAddresses?.includes(a.toLowerCase()),
  ) &&
  conditions.subjectPatterns.some((pattern) =>
    matchesPattern(subject, pattern),
  ) &&
  !conditions.excludeSubjectPatterns.some((pattern) =>
    matchesPattern(subject, pattern),
  );

const phrase = (pattern: string): string => pattern.replace(/^\*|\*$/g, "");
const quote = (value: string): string => `"${value.replace(/["\\]/g, " ")}"`;
export const gmailPurposeCriteria = (conditions: PurposeConditions) => ({
  from: `{${conditions.senderAddresses.map(quote).join(" ")}}`,
  to: conditions.receivingAddress,
  query: conditions.subjectPatterns.includes("*")
    ? ""
    : `{${conditions.subjectPatterns.map((pattern) => `subject:${quote(phrase(pattern))}`).join(" ")}}`,
  negatedQuery: `{${conditions.excludeSubjectPatterns
    .map((pattern) => `subject:${quote(phrase(pattern))}`)
    .concat(
      ['subject:"re:"', 'subject:"fwd:"'],
      (conditions.excludedReceivingAddresses ?? []).flatMap((a) => [
        `to:${quote(a)}`,
        `cc:${quote(a)}`,
      ]),
    )
    .join(" ")}}`,
});
export const outlookPurposePredicates = (conditions: PurposeConditions) => ({
  conditions: {
    fromAddresses: conditions.senderAddresses.map((address) => ({
      emailAddress: { address },
    })),
    sentToAddresses: [
      { emailAddress: { address: conditions.receivingAddress } },
    ],
    ...(conditions.subjectPatterns.includes("*")
      ? {}
      : { subjectContains: conditions.subjectPatterns.map(phrase) }),
  },
  exceptions: {
    ...(conditions.excludedReceivingAddresses?.length
      ? {
          sentToAddresses: conditions.excludedReceivingAddresses.map(
            (address) => ({ emailAddress: { address } }),
          ),
        }
      : {}),
    subjectContains: [
      ...conditions.excludeSubjectPatterns.map(phrase),
      "Re:",
      "Fwd:",
    ],
    headerContains: [
      "spf=fail",
      "dkim=fail",
      "dmarc=fail",
      "spf=softfail",
      "spf=permerror",
      "dkim=permerror",
      "dmarc=permerror",
      "In-Reply-To:",
      "References:",
    ],
  },
});

export const serializePredicates = (value: unknown): string => {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input))
      return input
        .map(normalize)
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    if (input && typeof input === "object")
      return Object.fromEntries(
        Object.entries(input)
          .filter(
            ([key, v]) =>
              key !== "@" + "odata.type" &&
              key !== "name" &&
              v !== null &&
              v !== undefined &&
              v !== false &&
              !(Array.isArray(v) && !v.length),
          )
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, v]) => [key, normalize(v)]),
      );
    return typeof input === "string" ? input.toLowerCase() : input;
  };
  return JSON.stringify(normalize(value));
};
