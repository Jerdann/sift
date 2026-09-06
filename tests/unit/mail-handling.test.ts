import { describe, expect, it } from "vitest";
import {
  classifyMessage,
  CATEGORY_PRESENTATION,
} from "../../src/core/classification/mail-classifier";
import { handlingPreferencesSchema } from "../../src/shared/contracts/mail-handling";
import {
  handlingFor,
  handlingEligible,
  handlingTarget,
  retentionEligible,
} from "../../src/core/classification/mail-handling";
import {
  purposeConditions,
  matchesPurposeConditions,
} from "../../src/core/rules/purpose-filter";
import {
  desiredRule,
  renderManagedProtonSieve,
  snapshotForDesiredRule,
} from "../../src/core/rules/rule-reconciliation";
import { normalizeOutlookRule } from "../../src/main/outlook/outlook-rule-mapper";
import { outlookPurposePredicates } from "../../src/core/rules/purpose-filter";

const classify = (
  subject: string,
  headers: Record<string, string> = {},
  bodyText: string | null = null,
) =>
  classifyMessage({
    subject,
    headers,
    bodyText,
    senders: ["mail@service.example"],
    recipients: ["owner@example.test"],
  });
describe("purpose-first mail handling", () => {
  it.each([
    ["Save up to 45% during the summer sale", "promotions"],
    ["Do not miss our game deals", "promotions"],
    ["Welcome to our shop — special offer inside", "promotions"],
    ["New season is now live", "announcements"],
    ["Your account has been suspended", "account_actions"],
    ["Your sign-in code", "codes"],
    ["Please confirm your email", "codes"],
    ["You added a passkey", "security"],
    ["A new device is using your account", "security"],
    ["Your payment was unsuccessful", "bills"],
    ["Your order has shipped", "shopping"],
    ["Delay in shipping your order", "delivery_issues"],
    ["Your order receipt", "transactions"],
    ["Your refund is on its way", "refunds"],
    ["Your order has been confirmed", "orders"],
    ["Member Trip Confirmation", "travel"],
    ["Your boarding pass", "tickets"],
    ["Flight cancelled — contact support", "travel_updates"],
    ["Here is a check-in on your release", "reports"],
    ["Your e-transfer was successfully deposited", "transfers"],
    ["Your account was activated", "accounts"],
    ["Thanks for subscribing", "subscriptions"],
    ["Weekly engineering digest", "newsletters"],
    ["Please rate your purchase", "surveys"],
    ["Scheduled system maintenance", "service_notices"],
    ["A person mentioned you", "social"],
  ])("classifies %s as %s", (subject, expected) =>
    expect(classify(subject).category).toBe(expected),
  );
  it("does not infer purpose from a list header or a domain substring", () => {
    for (const sender of [
      "hello@someflix.example",
      "mail@courierx.example",
      "mail@gamex.example",
    ])
      expect(
        classifyMessage({
          subject: "An update",
          senders: [sender],
          recipients: [],
          headers: { "list-unsubscribe": "<https://example.test/unsubscribe>" },
          bodyText: null,
        }).category,
      ).toBe("other");
  });
  it("protects reply context and authentication failures even when the subject sounds promotional", () => {
    expect(
      classify("50% off", { "in-reply-to": "<conversation@example.test>" })
        .category,
    ).toBe("personal");
    expect(classify("Fwd: summer sale").category).toBe("personal");
    expect(
      classify("50% off", { "authentication-results": "dkim=fail" }).category,
    ).toBe("suspicious");
    expect(classify("Wholesale account question").category).not.toBe(
      "promotions",
    );
  });
  it("keeps read status independent of folder detail", () => {
    const prefs = handlingPreferencesSchema.parse({});
    for (const category of [
      "codes",
      "security",
      "shopping",
      "delivery_issues",
      "bills",
      "travel",
    ] as const) {
      expect(handlingFor(prefs, category).markRead).toBe(false);
      expect(
        handlingFor({ ...prefs, detail: "simple" }, category).markRead,
      ).toBe(false);
    }
    expect(handlingFor(prefs, "transactions").markRead).toBe(true);
    expect(handlingTarget(prefs, "shopping", "House")).toBe(
      "House/Shopping/Shipping updates",
    );
    expect(
      handlingTarget({ ...prefs, detail: "simple" }, "shopping", "House"),
    ).toBe("House/Shopping");
  });
  it("never lets aggressive settings delete protected or uncertain messages", () => {
    const prefs = handlingPreferencesSchema.parse({
      strictness: "broader",
      categories: {
        security: { destination: "trash", markRead: false, retentionDays: 7 },
        promotions: { destination: "spam", markRead: true, retentionDays: 30 },
      },
    });
    expect(handlingFor(prefs, "security")).toMatchObject({
      destination: "inbox",
      retentionDays: null,
    });
    expect(handlingEligible(prefs, "other", 0.99)).toBe(false);
    expect(handlingEligible(prefs, "promotions", 0.7)).toBe(false);
    expect(
      retentionEligible(
        prefs,
        "promotions",
        0.9,
        "2025-01-01T00:00:00Z",
        "2026-01-01T00:00:00Z",
      ),
    ).toBe(true);
    expect(
      retentionEligible(
        prefs,
        "promotions",
        0.9,
        "2026-01-01T00:00:00Z",
        "2026-01-01T00:00:00Z",
      ),
    ).toBe(false);
    expect(
      retentionEligible(
        prefs,
        "promotions",
        0.9,
        "invalid",
        "2026-01-01T00:00:00Z",
      ),
    ).toBe(false);
  });
  it("holds body-only evidence at the default setting and excludes it from destructive handling", () => {
    const result = classify("An update", {}, "Your order has shipped");
    expect(result).toMatchObject({ category: "shopping", confidence: 0.7 });
    expect(
      handlingEligible(
        handlingPreferencesSchema.parse({}),
        result.category,
        result.confidence,
      ),
    ).toBe(false);
    expect(
      handlingEligible(
        handlingPreferencesSchema.parse({ strictness: "broader" }),
        result.category,
        result.confidence,
      ),
    ).toBe(true);
  });
  it("uses sender, address and purpose together and excludes protected-purpose matches", () => {
    const conditions = purposeConditions(
      "proton",
      "promotions",
      ["mail@service.example"],
      "home@example.test",
    );
    const matches = (
      subject: string,
      sender = "mail@service.example",
      addresses = ["home@example.test"],
    ) => matchesPurposeConditions(conditions, subject, sender, addresses);
    expect(matches("Save up to 50% today")).toBe(true);
    expect(matches("Your receipt — save up to 50% next time")).toBe(false);
    expect(matches("Verification code for your discount")).toBe(false);
    expect(
      matches("Save big", "mail@service.example", ["work@example.test"]),
    ).toBe(false);
    expect(matches("Save big", "other@service.example")).toBe(false);
  });
  it("emits conditional Sieve, never a company-wide file rule", () => {
    const rule = desiredRule({
      provider: "proton",
      connectionId: "00c18ed5-44d5-476a-adc3-80f98a92f390",
      senderDomain: "service.example",
      receivingAddress: "home@example.test",
      category: "promotions",
      targetPath: "Spam",
      markRead: true,
      archive: true,
      spam: true,
      observedMessages: 10,
      confidence: 0.9,
      purposeConditions: purposeConditions(
        "proton",
        "promotions",
        ["mail@service.example"],
        "home@example.test",
      ),
    });
    const sieve = renderManagedProtonSieve([rule]);
    expect(sieve).toContain('header :matches "subject"');
    expect(sieve).toContain('not header :matches "subject"');
    expect(sieve).toContain('address :is "from" ["mail@service.example"]');
    expect(sieve).toContain(
      'not anyof (exists "in-reply-to", exists "references")',
    );
    expect(sieve).not.toContain("discard;");
  });
  it("round-trips Outlook purpose predicates without losing exceptions or sender addresses", () => {
    const conditions = purposeConditions(
      "outlook",
      "promotions",
      ["mail@service.example"],
      "home@example.test",
    );
    const rule = desiredRule({
      provider: "outlook",
      connectionId: "00c18ed5-44d5-476a-adc3-80f98a92f390",
      senderDomain: "service.example",
      receivingAddress: "home@example.test",
      category: "promotions",
      targetPath: CATEGORY_PRESENTATION.promotions.folder,
      markRead: true,
      archive: true,
      spam: false,
      observedMessages: 10,
      confidence: 0.9,
      purposeConditions: conditions,
    });
    const normalized = normalizeOutlookRule(
      {
        id: "rule",
        ...outlookPurposePredicates(conditions),
        actions: { moveToFolder: "folder", markAsRead: true },
      },
      new Map([["folder", rule.targetPath]]),
      { inboxId: "inbox", junkId: "junk" },
    );
    expect(normalized).toEqual(snapshotForDesiredRule("rule", rule));
    for (const extra of [
      { isEnabled: false },
      {
        actions: {
          moveToFolder: "folder",
          markAsRead: true,
          forwardTo: [{ emailAddress: { address: "other@example.test" } }],
        },
      },
      {
        conditions: {
          ...outlookPurposePredicates(conditions).conditions,
          isRead: true,
        },
      },
    ]) {
      expect(
        normalizeOutlookRule(
          {
            id: "rule",
            ...outlookPurposePredicates(conditions),
            actions: { moveToFolder: "folder", markAsRead: true },
            ...extra,
          },
          new Map([["folder", rule.targetPath]]),
          { inboxId: "inbox", junkId: "junk" },
        ).fingerprint,
      ).not.toBe(normalized.fingerprint);
    }
  });
});
