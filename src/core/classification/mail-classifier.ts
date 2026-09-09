import type { MailCategory } from "../../shared/contracts/analysis";
import { matchPurpose } from "./message-purpose";

export const CLASSIFIER_VERSION = "purpose-2.2.0";
export const CATEGORY_PRESENTATION: Readonly<
  Record<MailCategory, { label: string; folder: string }>
> = {
  personal: { label: "Personal conversations", folder: "Personal" },
  codes: {
    label: "Login codes & verification",
    folder: "Security/Login codes",
  },
  security: {
    label: "Account security changes",
    folder: "Security/Account changes",
  },
  accounts: {
    label: "Account registrations",
    folder: "Accounts/Registrations",
  },
  account_actions: {
    label: "Account actions & renewals",
    folder: "Accounts/Action required",
  },
  subscriptions: {
    label: "Subscription status",
    folder: "Accounts/Subscriptions",
  },
  service_notices: {
    label: "Service notices",
    folder: "Updates/Service notices",
  },
  transactions: { label: "Receipts", folder: "Money/Receipts" },
  finance: {
    label: "Statements & financial records",
    folder: "Money/Statements",
  },
  transfers: { label: "Transfers & deposits", folder: "Money/Transfers" },
  refunds: { label: "Refunds", folder: "Money/Refunds" },
  bills: {
    label: "Bills & payment issues",
    folder: "Money/Bills & payment issues",
  },
  orders: {
    label: "Order confirmations",
    folder: "Shopping/Order confirmations",
  },
  shopping: { label: "Shipping updates", folder: "Shopping/Shipping updates" },
  delivery_issues: {
    label: "Delivery problems & order questions",
    folder: "Shopping/Delivery problems",
  },
  travel: { label: "Travel bookings", folder: "Travel/Bookings" },
  tickets: { label: "Tickets & boarding passes", folder: "Travel/Tickets" },
  travel_updates: { label: "Trip updates", folder: "Travel/Trip updates" },
  games: { label: "Game updates", folder: "Updates/Games" },
  newsletters: { label: "Newsletters", folder: "Updates/Newsletters" },
  surveys: {
    label: "Surveys & feedback requests",
    folder: "Updates/Surveys & feedback",
  },
  reports: { label: "Activity reports", folder: "Updates/Reports" },
  promotions: { label: "Sales & offers", folder: "Promotions/Sales & offers" },
  announcements: {
    label: "Product announcements",
    folder: "Promotions/Product announcements",
  },
  social: { label: "Social activity", folder: "Updates/Social activity" },
  suspicious: { label: "Suspicious messages", folder: "Review/Suspicious" },
  spam: { label: "Likely spam", folder: "Review/Spam" },
  other: { label: "Needs classification", folder: "Review/Unsorted" },
  mailing_lists: {
    label: "Other mailing-list mail",
    folder: "Updates/Mailing lists",
  },
};
export interface ClassificationInput {
  subject: string | null;
  bodyText: string | null;
  senders: string[];
  recipients: string[];
  headers: Record<string, string>;
}
export interface ClassificationResult {
  category: MailCategory;
  confidence: number;
  evidence: string[];
  senderDomain: string;
  receivingAddresses: string[];
}
export const classifyMessage = (
  input: ClassificationInput,
): ClassificationResult => {
  const headers = Object.fromEntries(
    Object.entries(input.headers).map(([key, value]) => [
      key.toLowerCase(),
      value,
    ]),
  );
  const senderDomain =
    input.senders[0]?.split("@").at(-1)?.toLowerCase() ?? "unknown-sender";
  const receivingAddresses = [
    ...new Set(
      [
        ...[headers["delivered-to"], headers["x-original-to"]].flatMap(
          (value) =>
            value?.match(
              /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi,
            ) ?? [],
        ),
        ...input.recipients,
      ].map((address) => address.toLowerCase()),
    ),
  ];
  const result = (
    category: MailCategory,
    confidence: number,
    ...evidence: string[]
  ): ClassificationResult => ({
    category,
    confidence,
    evidence,
    senderDomain,
    receivingAddresses,
  });
  const subject = input.subject ?? "";
  const failedAuth = /(?:spf|dkim|dmarc)=(?:fail|softfail|permerror)\b/i.test(
    headers["authentication-results"] ?? "",
  );
  const junk =
    /\b(?:crypto giveaway|risk.free investment|wire transfer urgently|claim your prize|miracle cure)\b/i.test(
      subject,
    );
  if (junk)
    return result(
      failedAuth ? "spam" : "suspicious",
      failedAuth ? 0.94 : 0.72,
      "Unsolicited high-risk wording needs review",
    );
  if (failedAuth)
    return result(
      "suspicious",
      0.72,
      "Sender authentication failed; message purpose does not prove authenticity",
    );
  if (
    headers["in-reply-to"] ||
    headers.references ||
    /^\s*(?:re|fw|fwd):/i.test(subject)
  )
    return result(
      "personal",
      0.75,
      "A reply or forwarded message may be personal; do not apply automated sender-wide handling",
    );
  const match = matchPurpose(subject);
  if (match)
    return result(
      match.category,
      0.9,
      match.reason,
      "Subject evidence; score is a heuristic, not measured accuracy",
    );
  const looseMatch = matchPurpose(
    subject
      .normalize("NFKC")
      .replace(/[–—_:]+/g, " ")
      .replace(/\s+/g, " "),
  );
  if (looseMatch)
    return result(
      looseMatch.category,
      0.78,
      looseMatch.reason,
      "Possible subject match after spacing and punctuation changes; not used for Spam, Trash or future filters",
    );
  if (input.bodyText) {
    const firstParagraph =
      input.bodyText.split(/\r?\n\s*\r?\n/)[0]?.slice(0, 1500) ?? "";
    const bodyMatch = matchPurpose(firstParagraph);
    if (bodyMatch)
      return result(
        bodyMatch.category,
        0.7,
        bodyMatch.reason,
        "Body-only evidence: excluded from future rules and destructive handling",
      );
  }
  if (headers["list-id"]?.trim() || headers["list-unsubscribe"]?.trim())
    return result(
      "mailing_lists",
      0.86,
      "The sender included a mailing-list or unsubscribe header, but the message purpose is unclear",
      "File separately without marking read by default; this is not evidence of spam or a paid subscription",
    );
  return result(
    "other",
    0.45,
    headers["list-unsubscribe"] || headers["list-id"]
      ? "Mailing-list headers do not identify message purpose"
      : "The available content does not establish message purpose",
  );
};
