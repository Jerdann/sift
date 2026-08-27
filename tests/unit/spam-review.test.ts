import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GmailConnectionRepository } from "../../src/main/gmail/gmail-connection-repository";
import { ProfileRepository } from "../../src/main/profiles/profile-repository";
import { SafeStorageVault, type SafeStoragePort } from "../../src/main/secrets/safe-storage-vault";
import { SpamReviewRepository } from "../../src/main/spam/spam-review-repository";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const storage: SafeStoragePort = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(value).reverse(),
  decryptString: (value) => Buffer.from(value).reverse().toString(),
};

describe("spam review", () => {
  it("groups sender history, requires explicit decisions, and preserves them on rebuild", () => {
    const root = mkdtempSync(path.join(tmpdir(), "sift-spam-review-"));
    roots.push(root);
    const profileId = "47f5f3c3-e0e0-4b93-8f69-6e311ba40936";
    const profile = new ProfileRepository(root, { createId: () => profileId }).createProfile("Spam reviewer");
    const vault = new SafeStorageVault(root, profile.database, storage);
    const connection = new GmailConnectionRepository(profile.database, vault, profileId).save(
      { clientId: "synthetic-client.apps.googleusercontent.com" },
      "owner@example.test",
      "refresh-value",
    );
    const analysisId = "2dd9724e-6d4a-412b-9848-15b10bbbe3df";
    profile.database.prepare(`
      INSERT INTO gmail_mailbox_analyses(id,connection_id,profile_id,classifier_version,analyzed_at)
      VALUES (?,?,?,?,?)
    `).run(analysisId, connection.id, profileId, "test", "2026-08-27T01:00:00.000Z");
    const insert = profile.database.prepare(`
      INSERT INTO gmail_analysis_streams(
        id,analysis_id,sender_domain,category,receiving_address,message_count,
        latest_at,confidence,evidence_json
      ) VALUES (?,?,?,?,?,?,?,?,?)
    `);
    insert.run("42d204e5-5899-46f7-972c-7a5348684761", analysisId, "junk.example", "spam", "owner@example.test", 8, "2026-08-26T10:00:00.000Z", 0.94, '["authentication failed"]');
    insert.run("a919826b-2dd6-41de-849d-108d2e8c78e0", analysisId, "junk.example", "promotions", "owner@example.test", 2, "2026-08-25T10:00:00.000Z", 0.91, '["promotional language"]');
    insert.run("09137069-0a7a-4777-a95c-b51c490af90b", analysisId, "maybe.example", "suspicious", "owner@example.test", 4, "2026-08-24T10:00:00.000Z", 0.88, '["suspicious language"]');
    insert.run("0354000d-87cc-43cc-923a-362769142ed4", analysisId, "bulk.example", "subscriptions", "owner@example.test", 25, "2026-08-23T10:00:00.000Z", 0.87, '["mailing-list headers"]');
    insert.run("d358abf0-af2f-4461-ab4d-ed5425f23e53", analysisId, "small-list.example", "subscriptions", "owner@example.test", 24, "2026-08-22T10:00:00.000Z", 0.87, '["mailing-list headers"]');

    const repository = new SpamReviewRepository(profile.database, profileId);
    const review = repository.generate("gmail", connection.id);
    expect(review.candidates).toHaveLength(3);
    expect(review.candidates.find((item) => item.senderDomain === "junk.example")).toMatchObject({
      messageCount: 10,
      categoryShare: 0.8,
      reason: "likely_spam",
      decision: "review",
    });
    expect(review.candidates.some((item) => item.senderDomain === "small-list.example")).toBe(false);

    const junk = review.candidates.find((item) => item.senderDomain === "junk.example")!;
    const maybe = review.candidates.find((item) => item.senderDomain === "maybe.example")!;
    const completed = repository.complete({
      reviewId: review.id,
      revision: review.revision,
      decisions: [
        { candidateId: junk.id, decision: "spam" },
        { candidateId: maybe.id, decision: "not_spam" },
      ],
    });
    expect(completed.state).toBe("completed");
    const decisions = repository.decisions("gmail", connection.id);
    expect(decisions.get("junk.example\0owner@example.test")).toBe("spam");
    expect(decisions.get("maybe.example\0owner@example.test")).toBe("not_spam");

    const nextAnalysisId = "26b721cc-b255-4d4a-9d87-8432e41f19c9";
    profile.database.prepare(
      "DELETE FROM gmail_mailbox_analyses WHERE connection_id=?",
    ).run(connection.id);
    profile.database.prepare(`
      INSERT INTO gmail_mailbox_analyses(id,connection_id,profile_id,classifier_version,analyzed_at)
      VALUES (?,?,?,?,?)
    `).run(nextAnalysisId, connection.id, profileId, "test", "2026-08-27T02:00:00.000Z");
    insert.run("0ad0b163-34f8-46f2-bc31-d5906d232c6d", nextAnalysisId, "junk.example", "spam", "owner@example.test", 9, "2026-08-27T01:30:00.000Z", 0.95, '["authentication failed"]');
    insert.run("7dd5bcb9-b39c-4d8f-9650-7d82b51e6125", nextAnalysisId, "maybe.example", "suspicious", "owner@example.test", 5, "2026-08-27T01:20:00.000Z", 0.89, '["suspicious language"]');

    expect(repository.getCurrent("gmail", connection.id)).toBeNull();
    expect(() => repository.decisions("gmail", connection.id)).toThrow("spam_review_required");

    const rebuilt = repository.generate("gmail", connection.id);
    expect(rebuilt.candidates.find((item) => item.senderDomain === "junk.example")?.decision).toBe("spam");
    expect(rebuilt.candidates.find((item) => item.senderDomain === "maybe.example")?.decision).toBe("not_spam");
    profile.database.close();
  });
});
