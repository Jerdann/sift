import type { MailCategory } from "../../shared/contracts/analysis";
import type {
  CategoryHandling,
  HandlingPreferences,
} from "../../shared/contracts/mail-handling";
import { CATEGORY_PRESENTATION } from "./mail-classifier";
import { attentionCategories, removableCategories } from "./message-purpose";

export const defaultHandling = (category: MailCategory): CategoryHandling => ({
  destination: ["other", "suspicious", "spam", "personal"].includes(category)
    ? "inbox"
    : "file",
  markRead:
    !attentionCategories.has(category) &&
    !["other", "suspicious", "spam"].includes(category),
  retentionDays: null,
});
export const handlingFor = (
  preferences: HandlingPreferences,
  category: MailCategory,
): CategoryHandling => {
  const value = preferences.categories[category] ?? defaultHandling(category);
  // Destructive defaults can never spill into records, unresolved actions or
  // unknown mail. Expired codes/registration records have a separate age review.
  return {
    ...value,
    destination:
      ["spam", "trash"].includes(value.destination) &&
      !removableCategories.has(category)
        ? "inbox"
        : value.destination,
    retentionDays:
      removableCategories.has(category) ||
      ["codes", "accounts"].includes(category)
        ? value.retentionDays
        : null,
  };
};
export const handlingTarget = (
  preferences: HandlingPreferences,
  category: MailCategory,
  container: string | null = null,
): string => {
  const handling = handlingFor(preferences, category);
  if (handling.destination !== "file")
    return { inbox: "INBOX", spam: "Spam", trash: "Trash" }[
      handling.destination
    ];
  const full = CATEGORY_PRESENTATION[category].folder;
  const folder = preferences.detail === "simple" ? full.split("/")[0]! : full;
  return container ? `${container}/${folder}` : folder;
};
export const handlingEligible = (
  preferences: HandlingPreferences,
  category: MailCategory,
  confidence: number,
): boolean => {
  if (["other", "suspicious", "spam"].includes(category)) return false;
  const destructive = ["spam", "trash"].includes(
    handlingFor(preferences, category).destination,
  );
  return (
    confidence >=
    (destructive
      ? 0.82
      : [0.82, 0.75, 0.7][
          handlingFor(preferences, category).matchLevel ??
            (preferences.strictness === "clear" ? 0 : 2)
        ]!)
  );
};
export const retentionEligible = (
  preferences: HandlingPreferences,
  category: MailCategory,
  confidence: number,
  receivedAt: string | null,
  now: string,
): boolean => {
  const days = handlingFor(preferences, category).retentionDays;
  // Verification links cannot be assumed completed. Code retention is limited
  // to old historical candidates and still requires a separate approval.
  return (
    days !== null &&
    confidence >= 0.82 &&
    Boolean(receivedAt) &&
    Number.isFinite(Date.parse(receivedAt!)) &&
    Date.parse(receivedAt!) < Date.parse(now) - days * 86400000
  );
};
export const handlingDescription = (
  preferences: HandlingPreferences,
  category: MailCategory,
): string => {
  const h = handlingFor(preferences, category);
  return `${h.destination === "file" ? "Move to folder" : h.destination === "inbox" ? "Leave in place" : h.destination === "spam" ? "Move to Spam" : "Move to Trash"} · ${h.markRead && h.destination !== "inbox" ? "mark read" : "preserve read status"}`;
};
