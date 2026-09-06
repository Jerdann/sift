import BetterSqlite3 from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { applyMigrations } from "../../src/main/storage/migrations";
import { JobRepository } from "../../src/main/jobs/job-repository";
import {
  readGraphFolders,
  readGraphPages,
} from "../../src/main/outlook/graph-inventory";

describe("handling upgrade safety", () => {
  it("stops legacy forward jobs while retaining successful items and undo work", () => {
    const db = new BetterSqlite3(":memory:");
    try {
      applyMigrations(db, () => new Date().toISOString(), 31);
      db.exec(`INSERT INTO secret_refs(id,profile_id,purpose,created_at,updated_at) VALUES('secret','profile','proton.bridge.imap','now','now');
        INSERT INTO provider_connections(id,profile_id,provider,host,port,username,security,secret_ref_id,state,created_at,updated_at) VALUES('connection','profile','proton','127.0.0.1',1143,'synthetic','starttls','secret','connected','now','now');
        INSERT INTO mailbox_analyses(id,connection_id,profile_id,classifier_version,analyzed_at) VALUES('analysis','connection','profile','old','now');`);
      const jobs = new JobRepository(db);
      const forward = jobs.createJob({
        profileId: "profile",
        kind: "proton-cleanup",
        idempotencyKey: "forward",
        itemKeys: ["done", "waiting"],
      });
      const undo = jobs.createJob({
        profileId: "profile",
        kind: "proton-cleanup",
        idempotencyKey: "undo",
        itemKeys: ["restore"],
      });
      const done = jobs.claimNextPending(forward.id)!;
      jobs.transitionItem(done.id, "succeeded", {
        result: { operation: "provider-rule-action", verified: true },
      });
      db.prepare(
        "INSERT INTO cleanup_plans(id,connection_id,analysis_id,revision,state,job_id,undo_job_id,created_at) VALUES('plan','connection','analysis','old','executing',?,?,'now')",
      ).run(forward.id, undo.id);
      applyMigrations(db);
      expect(jobs.getProgress(forward.id)).toMatchObject({
        state: "failed",
        counts: { succeeded: 1, skipped: 1 },
      });
      expect(jobs.getProgress(undo.id).state).toBe("pending");
      expect(
        db.prepare("SELECT result_json FROM job_items WHERE id=?").get(done.id),
      ).toMatchObject({ result_json: expect.stringContaining("verified") });
      expect(
        db.prepare("SELECT handling_revision FROM cleanup_plans").get(),
      ).toEqual({ handling_revision: null });
      expect(db.pragma("foreign_key_check")).toEqual([]);
      applyMigrations(db);
      expect(jobs.getProgress(forward.id).counts.succeeded).toBe(1);
    } finally {
      db.close();
    }
  });
  it("reads paginated folders without treating the first page as the full inventory", async () => {
    const seen: string[] = [];
    const fetchPort = async (input: string | URL | Request) => {
      const url = String(input);
      seen.push(url);
      return new Response(
        JSON.stringify(
          url.includes("childFolders")
            ? { value: [] }
            : url.includes("skiptoken")
              ? { value: [{ id: "second", displayName: "Second" }] }
              : {
                  value: [{ id: "first", displayName: "First" }],
                  ["@" + "odata.nextLink"]:
                    "https://graph.microsoft.com/v1.0/me/mailFolders?$skiptoken=next",
                },
        ),
      );
    };
    expect(
      (await readGraphFolders(fetchPort, "synthetic")).map((f) => f.id),
    ).toEqual(["first", "second"]);
    expect(seen.filter((url) => url.includes("childFolders"))).toHaveLength(2);
  });
  it("refuses foreign continuation URLs before sending credentials", async () => {
    let calls = 0;
    const fetchPort = async () => {
      calls++;
      return new Response(
        JSON.stringify({
          value: [],
          ["@" + "odata.nextLink"]: "https://example.test/collect",
        }),
      );
    };
    await expect(
      readGraphPages(fetchPort, "synthetic", "/me/mailFolders"),
    ).rejects.toThrow("outlook_inventory_url_invalid");
    expect(calls).toBe(1);
  });
});
