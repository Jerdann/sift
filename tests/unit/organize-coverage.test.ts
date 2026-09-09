import { describe, it, expect } from "vitest";
import {
  classifyMessage,
  CATEGORY_PRESENTATION,
} from "../../src/core/classification/mail-classifier";
import {
  defaultHandling,
  handlingFor,
  copyGroupChoices,
} from "../../src/core/classification/mail-handling";
import { handlingPreferencesSchema } from "../../src/shared/contracts/mail-handling";
import {
  purposeConditions,
  matchesPurposeConditions,
  outlookPurposePredicates,
} from "../../src/core/rules/purpose-filter";
import {
  desiredRule,
  renderManagedProtonSieve,
} from "../../src/core/rules/rule-reconciliation";
import { desiredManagedRuleSchema } from "../../src/shared/contracts/rule-management";
import { randomUUID } from "node:crypto";
import { handlingGroups } from "../../src/core/classification/handling-groups";

const classify = (subject: string, headers: Record<string, string> = {}) =>
  classifyMessage({
    subject,
    headers,
    bodyText: null,
    senders: ["sender@service.example"],
    recipients: ["owner@example.test"],
  });
describe("mail purpose coverage without company rules", () => {
  it.each([
    ["Your Cedar statement is now available", "finance"],
    ["Your summer statement is ready to download", "finance"],
    ["A transfer confirmation for your records", "transfers"],
    ["Your membership has expired", "account_actions"],
    ["Billing failure: check your details", "bills"],
    ["Your account: privacy policy update", "service_notices"],
    ["Your subscription: terms of use update", "service_notices"],
    ["Changes to our legal agreements", "service_notices"],
    ["Your delivery is scheduled for Monday", "shopping"],
    ["Shipment notification for your order", "shopping"],
    ["Your order was cancelled", "delivery_issues"],
    ["Order confirmation", "orders"],
    ["Thank you for registering with Example", "accounts"],
    ["Monthly activity statement", "finance"],
    ["Upcoming renewal of your plan", "account_actions"],
    ["An exclusive offer for new customers", "promotions"],
    ["Your privacy notice", "service_notices"],
    ["Card added to your digital wallet", "security"],
    ["Your security code", "codes"],
    ["Staff picks for this month", "newsletters"],
    ["Your eBill is ready", "bills"],
  ])("recognizes %s", (subject, category) =>
    expect(classify(subject).category).toBe(category),
  );
  it("keeps policy notices out of Accounts at either folder detail", () => {
    expect(CATEGORY_PRESENTATION.service_notices.folder).toBe(
      "Updates/Service notices",
    );
    expect(
      handlingGroups("simple").find((g) => g.id === "Accounts")!.categories,
    ).not.toContain("service_notices");
  });
  it("does not turn a mailing-list header into spam, sales, or a paid subscription", () => {
    expect(classify("Some news").category).toBe("other");
    const headers = { "List-Unsubscribe": "<https://service.example/leave>" };
    expect(classify("Some news", headers).category).toBe("mailing_lists");
    expect(defaultHandling("mailing_lists")).toMatchObject({
      destination: "file",
      markRead: false,
    });
    expect(classify("Your verification code", headers).category).toBe("codes");
    expect(classify("Your receipt", headers).category).toBe("transactions");
    expect(classify("Re: some news", headers).category).toBe("personal");
    expect(
      classify("Some news", {
        ...headers,
        "authentication-results": "dkim=fail",
      }).category,
    ).toBe("suspicious");
    const preferences = handlingPreferencesSchema.parse({
      categories: {
        mailing_lists: {
          destination: "trash",
          markRead: true,
          retentionDays: 30,
        },
      },
    });
    expect(handlingFor(preferences, "mailing_lists")).toMatchObject({
      destination: "inbox",
      retentionDays: null,
    });
  });
  it("requires list headers and excludes specific purposes in future rules, without broadening Gmail", () => {
    const c = purposeConditions(
      "proton",
      "mailing_lists",
      ["sender@service.example"],
      "shared@example.test",
    );
    c.excludedReceivingAddresses = ["owner@example.test"];
    const matches = (
      subject: string,
      headers = {},
      addresses = ["shared@example.test"],
    ) =>
      matchesPurposeConditions(
        c,
        subject,
        "sender@service.example",
        addresses,
        headers,
      );
    expect(matches("Some news")).toBe(false);
    expect(matches("Some news", { "list-id": "<news.service.example>" })).toBe(
      true,
    );
    expect(
      matches("Some news", { "list-id": "<news.service.example>" }, [
        "shared@example.test",
        "owner@example.test",
      ]),
    ).toBe(false);
    expect(
      matches("Your payment is due", { "list-id": "<news.service.example>" }),
    ).toBe(false);
    expect(
      purposeConditions(
        "gmail",
        "mailing_lists",
        ["sender@service.example"],
        "shared@example.test",
      ).subjectPatterns,
    ).toEqual([]);
    expect(outlookPurposePredicates(c).conditions.headerContains).toEqual([
      "List-Id:",
      "List-Unsubscribe:",
    ]);
    const rule = desiredRule({
      provider: "proton",
      connectionId: randomUUID(),
      senderDomain: "service.example",
      receivingAddress: "shared@example.test",
      category: "mailing_lists",
      targetPath: "Home/Updates/Mailing lists",
      markRead: false,
      archive: true,
      spam: false,
      observedMessages: 20,
      confidence: 0.86,
      purposeConditions: c,
    });
    expect(
      desiredManagedRuleSchema.parse(rule).purposeConditions?.mailingList,
    ).toBe(true);
    const sieve = renderManagedProtonSieve([rule]);
    expect(sieve).toContain('header :matches "list-id" "?*"');
    expect(sieve).toContain('fileinto "Home/Updates/Mailing lists"');
    expect(sieve).not.toContain("addflag");
  });
  it("copies all group choices but never another address's sender rules", () => {
    const main = handlingPreferencesSchema.parse({
      detail: "simple",
      categories: {
        promotions: { destination: "spam", markRead: true, retentionDays: 60 },
      },
      rules: [
        {
          id: randomUUID(),
          sender: "sender@service.example",
          address: "owner@example.test",
          subjectContains: null,
          category: "promotions",
          handling: defaultHandling("promotions"),
        },
      ],
    });
    const copy = copyGroupChoices(
      main,
      handlingPreferencesSchema.parse({}),
      "shared@example.test",
    );
    expect(copy.detail).toBe("simple");
    expect(copy.rules).toEqual([]);
    expect(copy.categories.promotions).toEqual(main.categories.promotions);
    main.categories.promotions!.destination = "trash";
    expect(copy.categories.promotions!.destination).toBe("spam");
    expect(Object.keys(copy.categories)).toHaveLength(
      Object.keys(CATEGORY_PRESENTATION).length,
    );
  });
});
