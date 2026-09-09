import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterEach } from "vitest";
import BetterSqlite3 from "better-sqlite3";
import { seedBulkMailbox } from "../fixtures/bulk-mailbox";
import { GmailConnectionRepository } from "../../src/main/gmail/gmail-connection-repository";
import { GmailAnalysisService } from "../../src/main/gmail/gmail-analysis-service";
import { GmailOrganizationRepository } from "../../src/main/gmail/gmail-organization-repository";
import { OutlookConnectionRepository } from "../../src/main/outlook/outlook-connection-repository";
import { OutlookAnalysisService } from "../../src/main/outlook/outlook-analysis-service";
import { OutlookHistoryRepository } from "../../src/main/outlook/outlook-history-repository";
import { SafeStorageVault } from "../../src/main/secrets/safe-storage-vault";
import { ProfileRepository } from "../../src/main/profiles/profile-repository";
import { MailHandlingRepository } from "../../src/main/settings/mail-handling-repository";
import { previewMailHandling } from "../../src/main/settings/mail-handling-preview";
import {
  handlingPreferencesSchema,
  type HandlingPreferences,
} from "../../src/shared/contracts/mail-handling";
import { analyzeMailbox } from "../../src/main/analysis/mailbox-analysis-service";
import { OrganizationProposalRepository } from "../../src/main/organization/organization-proposal-repository";
import { CleanupPlanRepository } from "../../src/main/cleanup/cleanup-plan-repository";
import { JobRepository } from "../../src/main/jobs/job-repository";
import { SpamReviewRepository } from "../../src/main/spam/spam-review-repository";
import { RuleReconciliationRepository } from "../../src/main/rules/rule-reconciliation-repository";
import { FolderSetup } from "../../src/main/organization/folder-setup";
import { applyMigrations } from "../../src/main/storage/migrations";
import { handlingGroups } from "../../src/core/classification/handling-groups";
import { senderRuleConditions } from "../../src/core/classification/sender-handling";
import { copyGroupChoices } from "../../src/core/classification/mail-handling";
import {
  gmailPurposeCriteria,
  outlookPurposePredicates,
  matchesPurposeConditions,
} from "../../src/core/rules/purpose-filter";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function setup() {
  const root = mkdtempSync(path.join(tmpdir(), "sift-bulk-test-"));
  roots.push(root);
  const f = seedBulkMailbox(root);
  return {
    ...f,
    root,
    db: new ProfileRepository(root).openProfile(f.profileId).database,
  };
}
const rule = () => ({
  id: randomUUID(),
  sender: "updates@vendor.example",
  address: "owner@example.test",
  subjectContains: null,
  category: "promotions" as const,
  handling: {
    destination: "spam" as const,
    markRead: true,
    retentionDays: null,
  },
});
describe("bulk handling and durable drafts", () => {
  it("isolates the main and separate-tree previews, and saves copied choices independently", () => {
    const { db, profileId, connectionId } = setup();
    try {
      const repo = new MailHandlingRepository(db, profileId);
      const scope = {
        provider: "proton" as const,
        connectionId,
        level: "account" as const,
        address: null,
      };
      const preferences = handlingPreferencesSchema.parse({
        detail: "simple",
        categories: {
          promotions: {
            destination: "spam",
            markRead: true,
            retentionDays: 30,
          },
        },
      });
      repo.save({ ...scope, preferences });
      const all = previewMailHandling(db, profileId, {
        ...scope,
        preferences,
        page: 0,
        category: null,
      });
      const main = previewMailHandling(db, profileId, {
        ...scope,
        preferences,
        page: 0,
        category: null,
        excludeSeparated: true,
      });
      const aliasScope = {
        ...scope,
        level: "alias" as const,
        address: "shared@example.test",
      };
      const alias = previewMailHandling(db, profileId, {
        ...aliasScope,
        preferences,
        page: 0,
        category: null,
      });
      expect(main.total + alias.total).toBe(all.total);
      expect(
        main.senders.every((s) => s.address === "owner@example.test"),
      ).toBe(true);
      expect(alias.senders).toContainEqual(
        expect.objectContaining({ address: "shared@example.test", count: 30 }),
      );
      const copied = copyGroupChoices(
        preferences,
        repo.get(aliasScope).preferences,
        aliasScope.address,
      );
      repo.save({ ...aliasScope, preferences: copied });
      repo.save({
        ...scope,
        preferences: {
          ...preferences,
          categories: {
            promotions: {
              destination: "trash",
              markRead: true,
              retentionDays: 30,
            },
          },
        },
      });
      expect(
        repo.resolve("proton", connectionId, "shared@example.test").categories
          .promotions?.destination,
      ).toBe("spam");
      expect(
        repo.resolve("proton", connectionId, "owner@example.test").categories
          .promotions?.destination,
      ).toBe("trash");
      const proposal = new OrganizationProposalRepository(
        db,
        profileId,
      ).generate("proton", connectionId);
      expect(
        proposal.items.filter(
          (i) =>
            i.scopeAddress === "shared@example.test" && i.category === "codes",
        )[0]?.targetPath,
      ).toBe("Shared home/Security");
    } finally {
      db.close();
    }
  });
  it("builds header-specific future filing rules from mailing-list matches, not sender-only catch-alls", () => {
    const { db, profileId, connectionId } = setup();
    try {
      db.prepare(
        "UPDATE indexed_messages SET headers_json=json_set(headers_json,'$.\"list-id\"','<letters.example.test>') WHERE sender_json=?",
      ).run(JSON.stringify(["updates@small.example"]));
      analyzeMailbox(db, profileId, connectionId);
      new OrganizationProposalRepository(db, profileId).generate(
        "proton",
        connectionId,
      );
      const history = new CleanupPlanRepository(
        db,
        new JobRepository(db),
        profileId,
      ).generate(connectionId, {
        kind: "organize",
        containers: {},
        trashSenderDomains: [],
      });
      expect(
        db
          .prepare(
            "SELECT COUNT(*) n,MAX(mark_read) read FROM cleanup_actions WHERE plan_id=? AND category='mailing_lists'",
          )
          .get(history.id),
      ).toEqual({ n: 80, read: 0 });
      const reviews = new SpamReviewRepository(db, profileId),
        review = reviews.generate("proton", connectionId);
      reviews.complete({
        reviewId: review.id,
        revision: review.revision,
        decisions: review.candidates.map((c) => ({
          candidateId: c.id,
          decision: "not_spam" as const,
        })),
      });
      new CleanupPlanRepository(db, new JobRepository(db), profileId).generate(
        connectionId,
        { kind: "spam", containers: {}, trashSenderDomains: [] },
      );
      const rules = new RuleReconciliationRepository(db, profileId).desired(
        "proton",
        connectionId,
      ).rules;
      expect(rules.filter((r) => r.category === "mailing_lists")).toMatchObject(
        [
          {
            observedMessages: 80,
            markRead: false,
            spam: false,
            purposeConditions: { mailingList: true },
          },
        ],
      );
    } finally {
      db.close();
    }
  });
  it("does not let uncertain messages hide clear matches in the same folder or sender stream", () => {
    const { db, profileId, connectionId } = setup();
    try {
      db.prepare(
        "UPDATE indexed_messages SET sender_json='[\"mail@service.example\"]',body_text='Save up to 50% today' WHERE sender_json='[\"updates@small.example\"]'",
      ).run();
      analyzeMailbox(db, profileId, connectionId);
      const proposal = new OrganizationProposalRepository(
        db,
        profileId,
      ).generate("proton", connectionId);
      const item = proposal.items.find(
        (i) =>
          i.category === "promotions" &&
          i.scopeAddress === "owner@example.test",
      )!;
      expect(item.confidence).toBeLessThan(0.82);
      expect(item.enabled).toBe(true);
      const plan = new CleanupPlanRepository(
        db,
        new JobRepository(db),
        profileId,
      ).generate(connectionId, {
        kind: "organize",
        containers: {},
        trashSenderDomains: [],
      });
      expect(
        db
          .prepare(
            "SELECT COUNT(*) n FROM cleanup_actions WHERE plan_id=? AND category='promotions'",
          )
          .get(plan.id),
      ).toEqual({ n: 2 });
      const reviews = new SpamReviewRepository(db, profileId),
        review = reviews.generate("proton", connectionId);
      reviews.complete({
        reviewId: review.id,
        revision: review.revision,
        decisions: review.candidates.map((c) => ({
          candidateId: c.id,
          decision: "not_spam",
        })),
      });
      new CleanupPlanRepository(db, new JobRepository(db), profileId).generate(
        connectionId,
        { kind: "spam", containers: {}, trashSenderDomains: [] },
      );
      const rules = new RuleReconciliationRepository(db, profileId)
        .desired("proton", connectionId)
        .rules.filter((r) => r.category === "promotions");
      expect(rules.reduce((n, r) => n + r.observedMessages, 0)).toBe(2);
    } finally {
      db.close();
    }
  });
  it("removes account drafts and sender choices on disconnect, but keeps profile defaults", () => {
    const { db, profileId, connectionId } = setup();
    try {
      const repo = new MailHandlingRepository(db, profileId),
        scope = {
          provider: "proton" as const,
          connectionId,
          level: "account" as const,
          address: null,
        };
      repo.save({
        ...scope,
        level: "profile",
        preferences: handlingPreferencesSchema.parse({ detail: "simple" }),
      });
      const preferences = handlingPreferencesSchema.parse({ rules: [rule()] });
      repo.save({ ...scope, preferences });
      repo.saveDraft({ ...scope, preferences });
      db.prepare("DELETE FROM provider_connections WHERE id=?").run(
        connectionId,
      );
      expect(
        db.prepare("SELECT COUNT(*) n FROM mail_handling_drafts").get(),
      ).toEqual({ n: 0 });
      expect(
        db.prepare("SELECT scope_key FROM mail_handling_preferences").all(),
      ).toEqual([{ scope_key: "*" }]);
    } finally {
      db.close();
    }
  });
  it.each(["gmail", "outlook"] as const)(
    "uses the same sender choices in %s preview, history and future rules",
    (provider) => {
      const { db, profileId, root } = setup();
      try {
        const vault = new SafeStorageVault(root, db, {
          isEncryptionAvailable: () => true,
          encryptString: (s) => Buffer.from(s).reverse(),
          decryptString: (b) => Buffer.from(b).reverse().toString(),
        });
        const gmail =
          provider === "gmail"
            ? new GmailConnectionRepository(db, vault, profileId).save(
                { clientId: "synthetic.apps.googleusercontent.com" },
                "owner@example.test",
                "synthetic",
              )
            : null;
        const outlook =
          provider === "outlook"
            ? new OutlookConnectionRepository(db, vault, profileId).save(
                { clientId: randomUUID(), tenant: "common" },
                "owner@example.test",
                "synthetic",
              )
            : null;
        const connectionId = gmail?.id ?? outlook!.id;
        if (gmail)
          db.prepare(
            "INSERT INTO gmail_indexed_messages(id,connection_id,gmail_message_id,thread_id,received_at,subject,sender_json,recipients_json,headers_json,label_ids_json,size_bytes,indexed_at) SELECT id,?,id,id,received_at,subject,sender_json,recipients_json,headers_json,'[\"INBOX\"]',size_bytes,indexed_at FROM indexed_messages",
          ).run(connectionId);
        else {
          db.prepare(
            "INSERT INTO outlook_folder_ids VALUES(?,'inbox','sent','trash','junk','archive','now')",
          ).run(connectionId);
          db.prepare(
            "INSERT INTO outlook_indexed_messages(id,connection_id,graph_message_id,conversation_id,received_at,subject,sender_json,recipients_json,headers_json,categories_json,parent_folder_id,is_read,size_bytes,indexed_at) SELECT id,?,id,id,received_at,subject,sender_json,recipients_json,headers_json,'[]','inbox',0,size_bytes,indexed_at FROM indexed_messages",
          ).run(connectionId);
        }
        const analyze = () =>
          gmail
            ? new GmailAnalysisService(db, profileId).analyze(gmail)
            : new OutlookAnalysisService(db, profileId).analyze(outlook!);
        analyze();
        const preferences = handlingPreferencesSchema.parse({
          rules: [rule()],
        });
        const scope = {
          provider,
          connectionId,
          level: "account" as const,
          address: null,
        };
        new MailHandlingRepository(db, profileId).save({
          ...scope,
          preferences,
        });
        analyze();
        const preview = previewMailHandling(db, profileId, {
          ...scope,
          preferences,
          page: 0,
          category: null,
        });
        // These providers do not index bodies; the extra vague note is also matched.
        expect(preview.ruleMatches[preferences.rules![0]!.id]).toBe(401);
        new OrganizationProposalRepository(db, profileId).generate(
          provider,
          connectionId,
        );
        const history = gmail
          ? new GmailOrganizationRepository(
              db,
              new JobRepository(db),
              profileId,
            ).generate(gmail)
          : new OutlookHistoryRepository(
              db,
              new JobRepository(db),
              profileId,
            ).generate(outlook!);
        const table = gmail
          ? "gmail_history_impacts"
          : "outlook_history_impacts";
        expect(
          db
            .prepare(
              `SELECT SUM(existing_messages) n FROM ${table} WHERE plan_id=? AND spam=1`,
            )
            .get(history.id),
        ).toEqual({ n: 401 });
        const reviews = new SpamReviewRepository(db, profileId),
          review = reviews.generate(provider, connectionId);
        reviews.complete({
          reviewId: review.id,
          revision: review.revision,
          decisions: review.candidates.map((c) => ({
            candidateId: c.id,
            decision: "not_spam",
          })),
        });
        if (gmail)
          new GmailOrganizationRepository(
            db,
            new JobRepository(db),
            profileId,
          ).generate(gmail, { kind: "spam" });
        else
          new OutlookHistoryRepository(
            db,
            new JobRepository(db),
            profileId,
          ).generate(outlook!, { kind: "spam" });
        const rules = new RuleReconciliationRepository(db, profileId).desired(
          provider,
          connectionId,
        ).rules;
        expect(
          rules.filter((r) =>
            r.purposeConditions?.senderAddresses.includes(
              "updates@vendor.example",
            ),
          ),
        ).toMatchObject([{ spam: true, observedMessages: 401 }]);
      } finally {
        db.close();
      }
    },
  );
  it("groups unknown mail largest first and previews changes without writing classifications", () => {
    const { db, profileId, connectionId } = setup();
    try {
      const scope = {
        provider: "proton" as const,
        connectionId,
        level: "account" as const,
        address: null,
      };
      const preferences = handlingPreferencesSchema.parse({});
      const input = { ...scope, preferences, page: 0, category: null };
      const before = JSON.stringify(
        db.prepare("SELECT * FROM message_classifications").all(),
      );
      const initial = previewMailHandling(db, profileId, input);
      expect(initial.senders.slice(0, 3).map((s) => s.count)).toEqual([
        400, 80, 30,
      ]);
      const r = rule();
      preferences.rules = [r];
      const after = previewMailHandling(db, profileId, {
        ...input,
        preferences,
        sender: r.sender,
        receivingAddress: r.address,
      });
      expect(after.ruleMatches[r.id]).toBe(400);
      expect(after.groups.find((g) => g.category === "other")?.count).toBe(
        initial.groups.find((g) => g.category === "other")!.count - 400,
      );
      expect(after.examples[0]?.actionCode).toBe("SPAM");
      preferences.rules = [{ ...r, subjectContains: "Blue" }];
      expect(
        previewMailHandling(db, profileId, { ...input, preferences })
          .ruleMatches[r.id],
      ).toBe(250);
      expect(
        JSON.stringify(
          db.prepare("SELECT * FROM message_classifications").all(),
        ),
      ).toBe(before);
    } finally {
      db.close();
    }
  });
  it("keeps one sender rule consistent across folder creation, history, and future filters", () => {
    const { db, profileId, connectionId } = setup();
    try {
      const scope = {
        provider: "proton" as const,
        connectionId,
        level: "account" as const,
        address: null,
      };
      const r = rule();
      const preferences = handlingPreferencesSchema.parse({ rules: [r] });
      new MailHandlingRepository(db, profileId).save({ ...scope, preferences });
      analyzeMailbox(db, profileId, connectionId);
      const proposal = new OrganizationProposalRepository(
        db,
        profileId,
      ).generate("proton", connectionId);
      const custom = proposal.items.find((i) => i.handlingRuleId === r.id)!;
      expect(custom).toMatchObject({ targetPath: "Spam", messageCount: 400 });
      const plan = new CleanupPlanRepository(
        db,
        new JobRepository(db),
        profileId,
      ).generate(connectionId, {
        kind: "organize",
        containers: {},
        trashSenderDomains: [],
        retention: false,
      });
      const spamActions = db
        .prepare(
          "SELECT COUNT(*) n FROM cleanup_actions WHERE plan_id=? AND action_kind='native_spam'",
        )
        .get(plan.id);
      expect(spamActions).toEqual({ n: 400 });
      expect(
        db
          .prepare(
            "SELECT COUNT(*) n FROM cleanup_actions ca JOIN message_classifications mc ON mc.message_row_id=ca.message_row_id WHERE ca.plan_id=? AND ca.action_kind='native_spam' AND mc.category IN ('codes','transactions','bills','personal')",
          )
          .get(plan.id),
      ).toEqual({ n: 0 });
      const folders = new FolderSetup(db, profileId).get({
        ...scope,
        proposalId: proposal.id,
        revision: proposal.revision,
      });
      expect(folders).toBeNull();
      const reviews = new SpamReviewRepository(db, profileId),
        review = reviews.generate("proton", connectionId);
      reviews.complete({
        reviewId: review.id,
        revision: review.revision,
        decisions: review.candidates.map((c) => ({
          candidateId: c.id,
          decision: "not_spam",
        })),
      });
      new CleanupPlanRepository(db, new JobRepository(db), profileId).generate(
        connectionId,
        { kind: "spam", containers: {}, trashSenderDomains: [] },
      );
      const desired = new RuleReconciliationRepository(db, profileId).desired(
        "proton",
        connectionId,
      ).rules;
      const future = desired.filter((r) =>
        r.purposeConditions?.senderAddresses.includes("updates@vendor.example"),
      );
      expect(future).toHaveLength(1);
      expect(future[0]).toMatchObject({
        spam: true,
        observedMessages: 400,
        receivingAddress: "owner@example.test",
      });
      expect(
        matchesPurposeConditions(
          future[0]!.purposeConditions!,
          "Your receipt for payment",
          "updates@vendor.example",
          ["owner@example.test"],
        ),
      ).toBe(false);
    } finally {
      db.close();
    }
  });
  it("keeps drafts during real unfinished jobs and rejects cross-account sender rules", () => {
    const { db, profileId, connectionId } = setup();
    try {
      const repo = new MailHandlingRepository(db, profileId),
        scope = {
          provider: "proton" as const,
          connectionId,
          level: "account" as const,
          address: null,
        };
      const preferences = handlingPreferencesSchema.parse({ rules: [rule()] });
      new JobRepository(db).createJob({
        profileId,
        kind: "proton-audit",
        idempotencyKey: randomUUID(),
        itemKeys: ["wait"],
      });
      repo.saveDraft({ ...scope, preferences });
      expect(() => repo.save({ ...scope, preferences })).toThrow(
        "mail_job_running",
      );
      expect(
        new MailHandlingRepository(db, profileId).get(scope).draft,
      ).toEqual(preferences);
      preferences.rules![0]!.address = "stranger@example.test";
      expect(() => repo.saveDraft({ ...scope, preferences })).toThrow(
        "sender_rule_invalid",
      );
    } finally {
      db.close();
    }
  });
  it("changes matching counts by strictness but never broadens destructive matches", () => {
    const { db, profileId, connectionId } = setup();
    try {
      const preferences: HandlingPreferences = handlingPreferencesSchema.parse({
        categories: {
          transactions: {
            destination: "file",
            markRead: true,
            retentionDays: null,
            matchLevel: 0,
          },
          promotions: {
            destination: "file",
            markRead: true,
            retentionDays: null,
            matchLevel: 0,
          },
        },
      });
      const input = {
        provider: "proton" as const,
        connectionId,
        level: "account" as const,
        address: null,
        preferences,
        page: 0,
        category: null,
      };
      const count = (c: string) =>
        previewMailHandling(db, profileId, input).groups.find(
          (g) => g.category === c,
        )!.matched;
      const strict = count("transactions");
      preferences.categories.transactions!.matchLevel = 1;
      expect(count("transactions")).toBe(strict + 1);
      const clear = count("promotions");
      preferences.categories.promotions!.matchLevel = 2;
      expect(count("promotions")).toBe(clear + 1);
      preferences.categories.promotions!.destination = "trash";
      expect(count("promotions")).toBe(clear);
    } finally {
      db.close();
    }
  });
  it("provides fewer groups without losing categories and compiles sender-only predicates safely", () => {
    const simple = handlingGroups("simple"),
      detail = handlingGroups("detailed");
    expect(simple.length).toBeLessThan(detail.length / 2);
    expect(simple.flatMap((g) => g.categories).sort()).toEqual(
      detail.flatMap((g) => g.categories).sort(),
    );
    const r = rule();
    for (const provider of ["gmail", "outlook"] as const) {
      const c = senderRuleConditions(
        r,
        [r.address, "shared@example.test"],
        provider,
      );
      expect(c.subjectPatterns).toEqual(["*"]);
      expect(
        matchesPurposeConditions(c, "Your verification code", r.sender, [
          r.address,
        ]),
      ).toBe(false);
      expect(
        matchesPurposeConditions(c, "Blue bulletin", r.sender, [r.address]),
      ).toBe(true);
      expect(
        matchesPurposeConditions(c, "Blue bulletin", r.sender, [
          r.address,
          "shared@example.test",
        ]),
      ).toBe(false);
    }
    expect(
      gmailPurposeCriteria(senderRuleConditions(r, [r.address], "gmail")).query,
    ).toBe("");
    expect(
      outlookPurposePredicates(senderRuleConditions(r, [r.address], "outlook"))
        .conditions,
    ).not.toHaveProperty("subjectContains");
  });
  it("upgrades orphaned jobs without erasing successful results or touching unrelated work", () => {
    const db = new BetterSqlite3(":memory:");
    try {
      applyMigrations(db, undefined, 32);
      const jobs = new JobRepository(db);
      const orphan = jobs.createJob({
        profileId: "test",
        kind: "proton-cleanup",
        idempotencyKey: "orphan",
        itemKeys: ["done", "stuck"],
      });
      const done = jobs.claimNextPending(orphan.id)!;
      jobs.transitionItem(done.id, "succeeded", {
        result: { operation: "provider-rule-action", verified: true },
      });
      const active = jobs.createJob({
        profileId: "test",
        kind: "proton-audit",
        idempotencyKey: "scan",
        itemKeys: ["working"],
      });
      applyMigrations(db);
      expect(jobs.getProgress(orphan.id)).toMatchObject({
        state: "failed",
        counts: { succeeded: 1, skipped: 1 },
      });
      expect(jobs.getProgress(active.id).state).toBe("pending");
      expect(
        db.prepare("SELECT result_json FROM job_items WHERE id=?").get(done.id),
      ).toEqual({
        result_json: '{"operation":"provider-rule-action","verified":true}',
      });
      applyMigrations(db);
      expect(jobs.getProgress(orphan.id).counts.succeeded).toBe(1);
    } finally {
      db.close();
    }
  });
  it("stops prior-version forward jobs on upgrade without stopping undo work or losing successes", () => {
    const { db, profileId, connectionId } = setup();
    try {
      const jobs = new JobRepository(db);
      const plan = new CleanupPlanRepository(db, jobs, profileId).generate(
        connectionId,
        { kind: "organize", containers: {}, trashSenderDomains: [] },
      );
      const forward = jobs.createJob({
        profileId,
        kind: "proton-cleanup",
        idempotencyKey: "old-forward",
        itemKeys: ["done", "remaining"],
      });
      const undo = jobs.createJob({
        profileId,
        kind: "proton-cleanup",
        idempotencyKey: "undo",
        itemKeys: ["recover"],
      });
      const done = jobs.claimNextPending(forward.id)!;
      jobs.transitionItem(done.id, "succeeded", {
        result: { operation: "provider-rule-action", verified: true },
      });
      db.prepare(
        "UPDATE cleanup_plans SET job_id=?,undo_job_id=? WHERE id=?",
      ).run(forward.id, undo.id, plan.id);
      db.prepare("DELETE FROM schema_migrations WHERE version=34").run();
      applyMigrations(db);
      expect(jobs.getProgress(forward.id)).toMatchObject({
        state: "failed",
        counts: { succeeded: 1, skipped: 1 },
        errorCode: "classification_changed_rebuild_proposal",
      });
      expect(jobs.getProgress(undo.id)).toMatchObject({
        state: "pending",
        counts: { pending: 1 },
      });
      expect(
        db.prepare("SELECT result_json FROM job_items WHERE id=?").get(done.id),
      ).toEqual({
        result_json: '{"operation":"provider-rule-action","verified":true}',
      });
      applyMigrations(db);
      expect(jobs.getProgress(undo.id).state).toBe("pending");
    } finally {
      db.close();
    }
  });
});
