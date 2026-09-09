import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { analyzeMailbox } from "../../src/main/analysis/mailbox-analysis-service";
import { AccountIdentityRepository } from "../../src/main/identity/account-identity-repository";
import { CleanupPlanRepository } from "../../src/main/cleanup/cleanup-plan-repository";
import {
  cleanupActionErrorCode,
  cleanupTargetErrorCode,
  CleanupRunner,
} from "../../src/main/cleanup/cleanup-runner";
import { JobRepository } from "../../src/main/jobs/job-repository";
import { MailHandlingRepository } from "../../src/main/settings/mail-handling-repository";
import { previewMailHandling } from "../../src/main/settings/mail-handling-preview";
import { FolderSetup } from "../../src/main/organization/folder-setup";
import { handlingPreferencesSchema } from "../../src/shared/contracts/mail-handling";
import { OrganizationProposalRepository } from "../../src/main/organization/organization-proposal-repository";
import { ProfileRepository } from "../../src/main/profiles/profile-repository";
import { ProtonConnectionRepository } from "../../src/main/proton/proton-connection-repository";
import { ProtonDiscoveryRepository } from "../../src/main/proton/proton-discovery-repository";
import type { ProtonMutationClientPort } from "../../src/main/proton/proton-mutation-client";
import { protonFolderPath } from "../../src/main/proton/proton-paths";
import {
  SafeStorageVault,
  type SafeStoragePort,
} from "../../src/main/secrets/safe-storage-vault";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
const storage: SafeStoragePort = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(value).reverse(),
  decryptString: (value) => Buffer.from(value).reverse().toString(),
};

class FakeMutationClient implements ProtonMutationClientPort {
  readonly prepared: Array<[string, boolean, boolean]> = [];
  readonly applied: Array<[string, number, string]> = [];
  readonly appliedBatches: Array<[string, number[], string]> = [];
  readonly restored: Array<[string, number, string, string[]]> = [];
  readonly messages = new Map<
    string,
    { uidValidity: string; flags: string[] }
  >();
  closed = false;
  failBatch = false;
  failTargetInspectionOnce = false;
  rejectTargets = false;
  readonly legacyContainers = new Map<string, number>();
  constructor(private readonly validity = "1") {
    for (let uid = 1; uid <= 4; uid += 1)
      this.messages.set(`INBOX:${uid}`, {
        uidValidity: validity,
        flags: ["\\Flagged"],
      });
  }
  async connect() {}
  async close() {
    this.closed = true;
  }
  async prepareTarget(path: string, spam: boolean, trash = false) {
    this.prepared.push([path, spam, trash]);
    if (this.rejectTargets)
      throw new Error("invalid mailbox name: operation not allowed");
    return spam
      ? "Proton Spam"
      : trash
        ? "Proton Trash"
        : protonFolderPath(path);
  }
  async inspect(path: string, uid: number) {
    return this.messages.get(`${path}:${uid}`) ?? null;
  }
  async inspectMany(path: string, uids: readonly number[]) {
    if (this.failTargetInspectionOnce && path !== "INBOX") {
      this.failTargetInspectionOnce = false;
      throw new Error("synthetic_verification_failure");
    }
    return new Map(
      uids.flatMap((uid) => {
        const message = this.messages.get(`${path}:${uid}`);
        return message ? [[uid, message] as const] : [];
      }),
    );
  }
  async apply(path: string, uid: number, target: string, markRead = true) {
    this.applied.push([path, uid, target]);
    const current = this.messages.get(`${path}:${uid}`);
    if (!current) return null;
    this.messages.delete(`${path}:${uid}`);
    const targetUid = uid + 1_000;
    const receipt = {
      path: target,
      uid: targetUid,
      uidValidity: "2",
      flags: [
        ...new Set([...current.flags, ...(markRead ? ["\\Seen"] : [])]),
      ].sort(),
    };
    this.messages.set(`${target}:${targetUid}`, {
      uidValidity: receipt.uidValidity,
      flags: receipt.flags,
    });
    return receipt;
  }
  async moveMany(
    path: string,
    uids: readonly number[],
    target: string,
    markRead = true,
  ) {
    this.appliedBatches.push([path, [...uids], target]);
    if (this.failBatch) throw new Error("synthetic_batch_failure");
    const pointers = new Map<number, { path: string; uid: number }>();
    for (const uid of uids) {
      const receipt = await this.apply(path, uid, target, markRead);
      if (receipt) pointers.set(uid, { path: receipt.path, uid: receipt.uid });
    }
    return pointers;
  }
  async restore(
    target: string,
    uid: number,
    source: string,
    priorFlags: readonly string[],
  ) {
    this.restored.push([target, uid, source, [...priorFlags]]);
    const current = this.messages.get(`${target}:${uid}`);
    if (!current) return null;
    this.messages.delete(`${target}:${uid}`);
    const sourceUid = uid + 1_000;
    const receipt = {
      path: source,
      uid: sourceUid,
      uidValidity: "3",
      flags: [...priorFlags].sort(),
    };
    this.messages.set(`${source}:${sourceUid}`, {
      uidValidity: receipt.uidValidity,
      flags: receipt.flags,
    });
    return receipt;
  }
  async retireContainer(path: string) {
    const count = this.legacyContainers.get(path);
    if (count === undefined) return "missing" as const;
    if (count > 0) return "not_empty" as const;
    this.legacyContainers.delete(path);
    return "retired" as const;
  }
}

const setup = () => {
  const root = mkdtempSync(path.join(tmpdir(), "mail-steward-cleanup-"));
  roots.push(root);
  const profileId = "350313ef-491d-4cdf-963b-18b6e95476a3";
  const profile = new ProfileRepository(root, {
    createId: () => profileId,
  }).createProfile("Cleanup owner");
  const vault = new SafeStorageVault(root, profile.database, storage);
  const connections = new ProtonConnectionRepository(
    profile.database,
    vault,
    profileId,
  );
  const connection = connections.save({
    host: "127.0.0.1",
    port: 1143,
    username: "bridge",
    password: "generated",
    security: "starttls",
  });
  const discovery = new ProtonDiscoveryRepository(
    profile.database,
    profileId,
  ).replace(connection.id, {
    capabilities: ["IMAP4rev1"],
    mailboxes: [
      {
        path: "INBOX",
        name: "Inbox",
        delimiter: "/",
        specialUse: "\\Inbox",
        flags: [],
        messageCount: 3,
        unreadCount: 3,
        uidValidity: "1",
        uidNext: 4,
      },
    ],
    addresses: [
      {
        address: "owner@pm.test",
        occurrenceCount: 3,
        lastSeenAt: "2026-08-24T12:00:00.000Z",
        sources: ["delivered-to"],
      },
    ],
  });
  const inbox = discovery.mailboxes[0]!;
  const insert = profile.database.prepare(`
    INSERT INTO indexed_messages(
      id, connection_id, container_id, uid_validity, uid, message_id, received_at,
      subject, sender_json, recipients_json, headers_json, flags_json, size_bytes,
      body_text, body_truncated, indexed_at
    ) VALUES (?, ?, ?, '1', ?, ?, '2026-08-24T12:00:00.000Z', ?, ?, '["owner@pm.test"]', ?, '[]', 100, NULL, 0, '2026-08-24T12:00:00.000Z')
  `);
  insert.run(
    "7f7b1044-94b4-42c5-91c7-a0518d3d0231",
    connection.id,
    inbox.id,
    1,
    "<security>",
    "New login security alert",
    '["security@service.example"]',
    '{"delivered-to":"owner@pm.test"}',
  );
  insert.run(
    "56b19752-78dd-4640-b395-d724d1f81a65",
    connection.id,
    inbox.id,
    2,
    "<promo>",
    "50% off today",
    '["offers@store.example"]',
    '{"delivered-to":"owner@pm.test","list-id":"store.example"}',
  );
  insert.run(
    "8b6cedd6-41d0-4bb4-9182-2fa44ecb03d2",
    connection.id,
    inbox.id,
    3,
    "<spam>",
    "Claim your crypto giveaway",
    '["scam@bad.example"]',
    '{"delivered-to":"owner@pm.test","authentication-results":"dkim=fail; dmarc=fail"}',
  );
  insert.run(
    "2f96d62f-0266-4f77-9159-06f40fba2939",
    connection.id,
    inbox.id,
    4,
    "<promo-two>",
    "A second store sale",
    '["news@store.example"]',
    '{"delivered-to":"owner@pm.test","list-id":"store.example"}',
  );
  analyzeMailbox(profile.database, profileId, connection.id);
  new AccountIdentityRepository(profile.database, profileId).sync(
    "proton",
    connection.id,
    [
      {
        address: "second@pm.test",
        providerEvidence: true,
        evidence: ["provider_alias"],
        sentFromCount: 0,
        deliveredToCount: 0,
        lastSeenAt: null,
      },
    ],
  );
  new AccountIdentityRepository(profile.database, profileId).update({
    provider: "proton",
    connectionId: connection.id,
    address: "owner@pm.test",
    status: "confirmed",
    containerEnabled: true,
    containerName: "Primary",
  });
  analyzeMailbox(profile.database, profileId, connection.id);
  new OrganizationProposalRepository(profile.database, profileId).generate(
    "proton",
    connection.id,
  );
  const jobs = new JobRepository(profile.database);
  const plans = new CleanupPlanRepository(profile.database, jobs, profileId);
  return { profile, connections, connection, jobs, plans };
};

describe("approved Proton cleanup", () => {
  it("keeps handling scopes independent and can restore inherited defaults", () => {
    const c = setup(),
      db = c.profile.database,
      id = c.profile.profile.id;
    try {
      const repo = new MailHandlingRepository(db, id),
        scope = {
          provider: "proton" as const,
          connectionId: c.connection.id,
          level: "profile" as const,
          address: null,
        };
      repo.save({
        ...scope,
        preferences: handlingPreferencesSchema.parse({
          categories: {
            promotions: {
              destination: "spam",
              markRead: true,
              retentionDays: 30,
            },
          },
        }),
      });
      expect(
        repo.resolve("proton", c.connection.id, "owner@pm.test").categories
          .promotions?.destination,
      ).toBe("spam");
      const alias = {
        ...scope,
        level: "alias" as const,
        address: "owner@pm.test",
      };
      repo.save({
        ...alias,
        preferences: handlingPreferencesSchema.parse({
          categories: {
            promotions: {
              destination: "file",
              markRead: false,
              retentionDays: null,
            },
          },
        }),
      });
      expect(
        repo.resolve("proton", c.connection.id, "owner@pm.test").categories
          .promotions?.destination,
      ).toBe("file");
      expect(
        repo.resolveDraft(
          { ...scope, preferences: handlingPreferencesSchema.parse({}) },
          "owner@pm.test",
        ).categories.promotions?.destination,
      ).toBe("file");
      repo.save({
        ...alias,
        reset: true,
        preferences: handlingPreferencesSchema.parse({}),
      });
      expect(
        repo.resolve("proton", c.connection.id, "owner@pm.test").categories
          .promotions?.destination,
      ).toBe("spam");
      expect(() =>
        repo.get({ ...alias, address: "someone@example.test" }),
      ).toThrow("confirmed_alias_required");
    } finally {
      db.close();
    }
  });

  it("previews read-status and retention choices without changing mail or folders", () => {
    const c = setup(),
      db = c.profile.database,
      id = c.profile.profile.id;
    try {
      const before = db
        .prepare("SELECT * FROM indexed_messages ORDER BY id")
        .all();
      const result = previewMailHandling(db, id, {
        provider: "proton",
        connectionId: c.connection.id,
        level: "account",
        address: null,
        page: 0,
        category: null,
        preferences: handlingPreferencesSchema.parse({
          categories: {
            promotions: {
              destination: "trash",
              markRead: true,
              retentionDays: 7,
            },
          },
        }),
      });
      expect(
        result.groups.find((g) => g.category === "promotions"),
      ).toMatchObject({ matched: 2, target: "Trash" });
      expect(
        result.groups.find((g) => g.category === "security")?.action,
      ).toContain("preserve read status");
      expect(
        db.prepare("SELECT * FROM indexed_messages ORDER BY id").all(),
      ).toEqual(before);
      expect(db.prepare("SELECT COUNT(*) n FROM jobs").get()).toEqual({ n: 0 });
    } finally {
      db.close();
    }
  });

  it("requires a new approval after handling settings change and rejects old classifier proposals", () => {
    const c = setup(),
      db = c.profile.database,
      id = c.profile.profile.id;
    try {
      const plan = c.plans.generate(c.connection.id, {
        kind: "organize",
        containers: {},
        trashSenderDomains: [],
        existingSetup: "reuse",
      });
      new MailHandlingRepository(db, id).save({
        provider: "proton",
        connectionId: c.connection.id,
        level: "account",
        address: null,
        preferences: handlingPreferencesSchema.parse({ detail: "simple" }),
      });
      expect(c.plans.get(plan.id).requiresRebuild).toBe(true);
      expect(() => c.plans.approve(plan.id, plan.revision)).toThrow();
      db.prepare(
        "UPDATE organization_proposals SET classifier_version='old'",
      ).run();
      expect(() =>
        c.plans.generate(c.connection.id, {
          kind: "organize",
          containers: {},
          trashSenderDomains: [],
          existingSetup: "reuse",
        }),
      ).toThrow("classification_changed_rebuild_proposal");
    } finally {
      db.close();
    }
  });

  it("offers old promotional messages by saved age limits without deleting security mail", () => {
    const c = setup(),
      db = c.profile.database,
      id = c.profile.profile.id;
    try {
      db.prepare(
        "UPDATE indexed_messages SET received_at='2020-01-01T00:00:00.000Z'",
      ).run();
      new MailHandlingRepository(db, id).save({
        provider: "proton",
        connectionId: c.connection.id,
        level: "account",
        address: null,
        preferences: handlingPreferencesSchema.parse({
          categories: {
            promotions: {
              destination: "file",
              markRead: true,
              retentionDays: 30,
            },
          },
        }),
      });
      const plan = c.plans.generate(c.connection.id, {
        kind: "trash",
        retention: true,
        containers: {},
        trashSenderDomains: [],
        existingSetup: "extend",
      });
      expect(plan.trashCount).toBe(2);
      expect(plan.state).toBe("draft");
      expect(
        plan.impacts.every((i) => i.category === "promotions" && !i.markRead),
      ).toBe(true);
    } finally {
      db.close();
    }
  });

  it("retains concrete recovery receipts when local mail is reclassified", async () => {
    const c = setup(),
      db = c.profile.database,
      id = c.profile.profile.id;
    try {
      const plan = c.plans.generate(c.connection.id, {
        kind: "organize",
        containers: {},
        trashSenderDomains: [],
        existingSetup: "reuse",
      });
      const approved = c.plans.approve(plan.id, plan.revision),
        client = new FakeMutationClient();
      await new CleanupRunner(c.jobs, c.plans, c.connections, () => client).run(
        approved.job!.id,
      );
      const before = db
        .prepare(
          "SELECT id,resulting_path,resulting_uid,prior_flags_json FROM cleanup_actions WHERE plan_id=?",
        )
        .all(plan.id);
      analyzeMailbox(db, id, c.connection.id);
      expect(
        db
          .prepare(
            "SELECT id,resulting_path,resulting_uid,prior_flags_json FROM cleanup_actions WHERE plan_id=?",
          )
          .all(plan.id),
      ).toEqual(before);
      expect(c.plans.get(plan.id).state).toBe("completed");
    } finally {
      db.close();
    }
  });

  it("creates only the selected folders, persists progress and retries safely without moving mail", async () => {
    const c = setup(),
      db = c.profile.database,
      id = c.profile.profile.id;
    try {
      const proposal = new OrganizationProposalRepository(db, id).get(
        "proton",
        c.connection.id,
      )!;
      const input = {
        provider: "proton" as const,
        connectionId: c.connection.id,
        proposalId: proposal.id,
        revision: proposal.revision,
      };
      const service = new FolderSetup(db, id),
        created = new Set<string>();
      let fail = true;
      const prepare = async () => ({
        ensure: async (path: string) => {
          if (fail) {
            fail = false;
            throw Error("synthetic");
          }
          created.add(path);
        },
        close: async () => {},
      });
      service.start(input, prepare);
      await expect.poll(() => service.get(input)?.state).toBe("failed");
      service.start(input, prepare);
      await expect.poll(() => service.get(input)?.state).toBe("succeeded");
      expect([...created].sort()).toEqual([
        "Primary",
        "Primary/Promotions",
        "Primary/Promotions/Sales & offers",
        "Primary/Security",
        "Primary/Security/Account changes",
      ]);
      expect([...created]).toContain("Primary/Security/Account changes");
      expect(
        db.prepare("SELECT COUNT(*) n FROM cleanup_actions").get(),
      ).toEqual({ n: 0 });
      expect(new FolderSetup(db, id).get(input)?.state).toBe("succeeded");
    } finally {
      db.close();
    }
  });
  it("places portable organization paths beneath the Proton Folders namespace", () => {
    expect(protonFolderPath("Games")).toBe("Folders/Games");
    expect(protonFolderPath("Shared mail/Money/Receipts")).toBe(
      "Folders/Shared mail/Money/Receipts",
    );
    expect(protonFolderPath("Folders/Travel")).toBe("Folders/Travel");
  });

  it("classifies a rejected Bridge mailbox without retaining its private name", () => {
    expect(
      cleanupTargetErrorCode(
        new Error("invalid mailbox name [private]: operation not allowed"),
      ),
    ).toBe("proton_target_rejected");
    expect(cleanupActionErrorCode(new Error("operation not allowed"))).toBe(
      "provider_action_failed",
    );
  });

  it("never builds mutable actions from a mailbox carrying the virtual All role in flags", () => {
    const current = setup();
    const virtualId = "62cb8ee0-794d-4076-9a7f-98261cb796c4";
    current.profile.database
      .prepare(
        `
      INSERT INTO mail_containers(
        id,connection_id,profile_id,provider_container_id,display_name,delimiter,
        special_use,flags_json,message_count,unread_count,uid_validity,uid_next,observed_at
      ) VALUES (?,?,?,?,?,'/',NULL,'["\\\\All","\\\\Noinferiors"]',1,1,'9',2,'2026-08-26T12:00:00.000Z')
    `,
      )
      .run(
        virtualId,
        current.connection.id,
        current.profile.profile.id,
        "All Mail",
        "All Mail",
      );
    current.profile.database
      .prepare(
        `
      INSERT INTO indexed_messages(
        id,connection_id,container_id,uid_validity,uid,message_id,received_at,subject,
        sender_json,recipients_json,headers_json,flags_json,size_bytes,body_text,body_truncated,indexed_at
      ) VALUES (?,?,?,'9',1,'<virtual-only>','2026-08-25T12:00:00.000Z','Social digest',
        '["notice@network.example"]','["owner@pm.test"]','{"delivered-to":"owner@pm.test"}','[]',100,NULL,0,'2026-08-26T12:00:00.000Z')
    `,
      )
      .run(
        "f2ecf443-3df0-41c3-8e0d-d315fc87316f",
        current.connection.id,
        virtualId,
      );
    analyzeMailbox(
      current.profile.database,
      current.profile.profile.id,
      current.connection.id,
    );
    new OrganizationProposalRepository(
      current.profile.database,
      current.profile.profile.id,
    ).generate("proton", current.connection.id);

    const plan = current.plans.generate(current.connection.id, {
      kind: "organize",
      containers: {},
      trashSenderDomains: [],
    });
    expect(
      (
        current.profile.database
          .prepare(
            "SELECT COUNT(*) count FROM cleanup_actions WHERE plan_id=? AND source_path='All Mail'",
          )
          .get(plan.id) as { count: number }
      ).count,
    ).toBe(0);
    expect(plan.skippedCount).toBeGreaterThan(0);
    current.profile.database.close();
  });

  it("blocks an older saved plan that contains a virtual All Mail source", () => {
    const current = setup();
    current.profile.database
      .prepare(
        `
      INSERT INTO mail_containers(
        id,connection_id,profile_id,provider_container_id,display_name,delimiter,
        special_use,flags_json,message_count,unread_count,uid_validity,uid_next,observed_at
      ) VALUES ('41d82cc6-588a-4cf0-bdf1-3709ce88f0d8',?,?, 'All Mail','All Mail','/',NULL,
        '["\\\\All"]',4,4,'9',5,'2026-08-26T12:00:00.000Z')
    `,
      )
      .run(current.connection.id, current.profile.profile.id);
    const plan = current.plans.generate(current.connection.id, {
      kind: "organize",
      containers: {},
      trashSenderDomains: [],
    });
    current.profile.database
      .prepare(
        `
      UPDATE cleanup_actions SET source_path='All Mail' WHERE id=(
        SELECT id FROM cleanup_actions WHERE plan_id=? ORDER BY rowid LIMIT 1
      )
    `,
      )
      .run(plan.id);

    expect(current.plans.get(plan.id).requiresRebuild).toBe(true);
    expect(() => current.plans.assertMutableSources(plan.id)).toThrow(
      "cleanup_plan_virtual_source_rebuild_required",
    );
    current.profile.database.close();
  });

  it("uses the corrected address-scoped proposal instead of raw classifier destinations", () => {
    const current = setup();
    const proposals = new OrganizationProposalRepository(
      current.profile.database,
      current.profile.profile.id,
    );
    const proposal = proposals.get("proton", current.connection.id)!;
    const promotion = proposal.items.find(
      (item) => item.category === "promotions",
    )!;
    proposals.edit({
      proposalId: proposal.id,
      revision: proposal.revision,
      itemId: promotion.id,
      category: "accounts",
      targetPath: "Primary/Important/Joint accounts",
      enabled: true,
    });
    const plan = current.plans.generate(current.connection.id, {
      kind: "organize",
      containers: {},
      trashSenderDomains: [],
    });
    expect(plan.impacts).toContainEqual(
      expect.objectContaining({
        scopeAddress: "owner@pm.test",
        containerName: "Primary",
        category: "accounts",
        targetFolder: "Primary/Important/Joint accounts",
        messageCount: 2,
      }),
    );
    current.profile.database.close();
  });

  it("rebuilds classifications invalidated by a later Proton scan before creating the exact review", () => {
    const current = setup();
    const proposals = new OrganizationProposalRepository(
      current.profile.database,
      current.profile.profile.id,
    );
    const proposal = proposals.get("proton", current.connection.id)!;
    const promotion = proposal.items.find(
      (item) => item.category === "promotions",
    )!;
    const corrected = proposals.edit({
      proposalId: proposal.id,
      revision: proposal.revision,
      itemId: promotion.id,
      category: "accounts",
      targetPath: "Primary/Important/Joint accounts",
      enabled: true,
    });

    current.profile.database
      .prepare("DELETE FROM message_classifications")
      .run();
    expect(
      (
        current.profile.database
          .prepare("SELECT COUNT(*) count FROM message_classifications")
          .get() as { count: number }
      ).count,
    ).toBe(0);

    const plan = current.plans.generate(current.connection.id, {
      kind: "organize",
      existingSetup: "replace",
      containers: { "owner@pm.test": "Primary" },
      trashSenderDomains: [],
    });

    expect(plan).toMatchObject({
      state: "draft",
      existingSetup: "replace",
      proposalId: corrected.id,
      proposalRevision: corrected.revision,
      actionCount: 3,
    });
    expect(plan.impacts).toContainEqual(
      expect.objectContaining({
        category: "accounts",
        targetFolder: "Primary/Important/Joint accounts",
        messageCount: 2,
      }),
    );
    expect(
      (
        current.profile.database
          .prepare("SELECT COUNT(*) count FROM message_classifications")
          .get() as { count: number }
      ).count,
    ).toBe(4);
    current.profile.database.close();
  });

  it("leaves uncertain historical mail unchanged by default", () => {
    const current = setup();
    current.profile.database
      .prepare(
        `
      INSERT INTO indexed_messages(
        id,connection_id,container_id,uid_validity,uid,message_id,received_at,subject,
        sender_json,recipients_json,headers_json,flags_json,size_bytes,body_text,body_truncated,indexed_at
      ) VALUES (?,?,(SELECT id FROM mail_containers WHERE connection_id=? AND provider_container_id='INBOX'),'1',5,
        '<uncertain>','2026-08-24T12:00:00.000Z','A generic company update','["updates@company.example"]',
        '["owner@pm.test"]','{"delivered-to":"owner@pm.test"}','[]',100,NULL,0,'2026-08-24T12:00:00.000Z')
    `,
      )
      .run(
        "2342c974-bec2-4b52-ab84-55413f9b33e1",
        current.connection.id,
        current.connection.id,
      );
    analyzeMailbox(
      current.profile.database,
      current.profile.profile.id,
      current.connection.id,
    );
    new OrganizationProposalRepository(
      current.profile.database,
      current.profile.profile.id,
    ).generate("proton", current.connection.id);

    const plan = current.plans.generate(current.connection.id, {
      kind: "organize",
      containers: {},
      trashSenderDomains: [],
    });
    expect(plan.impacts.some((impact) => impact.category === "other")).toBe(
      false,
    );
    current.profile.database.close();
  });

  it("collapses shared impacts across hidden address scopes while preserving alias containers", () => {
    const current = setup();
    const plan = current.plans.generate(current.connection.id, {
      kind: "organize",
      containers: {},
      trashSenderDomains: [],
    });
    const actionIds = current.profile.database
      .prepare(
        `
      SELECT id FROM cleanup_actions WHERE plan_id=? ORDER BY rowid LIMIT 2
    `,
      )
      .all(plan.id) as Array<{ id: string }>;
    expect(actionIds).toHaveLength(2);
    current.profile.database
      .prepare(
        `
      UPDATE cleanup_actions
      SET scope_address=?, container_name=NULL, category='games', target_path='Games', action_kind='sort_read_archive'
      WHERE id=?
    `,
      )
      .run("first@pm.test", actionIds[0]!.id);
    current.profile.database
      .prepare(
        `
      UPDATE cleanup_actions
      SET scope_address=?, container_name=NULL, category='games', target_path='Games', action_kind='sort_read_archive'
      WHERE id=?
    `,
      )
      .run("second@pm.test", actionIds[1]!.id);

    const preview = current.plans.get(plan.id);
    expect(preview.impacts.filter((impact) => !impact.containerName)).toEqual([
      {
        scopeAddress: null,
        containerName: null,
        category: "games",
        targetFolder: "Games",
        action: "sort_read_archive",
        markRead: true,
        messageCount: 2,
      },
    ]);
    expect(
      preview.impacts.some(
        (impact) =>
          impact.scopeAddress === "owner@pm.test" &&
          impact.containerName === "Primary",
      ),
    ).toBe(true);
    expect(preview.actionCount).toBe(plan.actionCount);
    current.profile.database.close();
  });

  it("orders approved actions by source mailbox so Bridge can move them in large batches", () => {
    const current = setup();
    const plan = current.plans.generate(current.connection.id, {
      kind: "organize",
      containers: {},
      trashSenderDomains: [],
    });
    const actions = current.profile.database
      .prepare(
        `
      SELECT id FROM cleanup_actions WHERE plan_id=? ORDER BY rowid
    `,
      )
      .all(plan.id) as Array<{ id: string }>;
    expect(actions).toHaveLength(3);
    const update = current.profile.database.prepare(
      "UPDATE cleanup_actions SET source_path=?,uid=? WHERE id=?",
    );
    update.run("Folders/Second", 30, actions[0]!.id);
    update.run("Folders/First", 20, actions[1]!.id);
    update.run("Folders/Second", 10, actions[2]!.id);

    const approved = current.plans.approve(plan.id, plan.revision);
    const ordered = current.profile.database
      .prepare(
        `
      SELECT ca.source_path sourcePath,ca.uid
      FROM job_items ji
      JOIN cleanup_actions ca ON ca.id=ji.item_key
      WHERE ji.job_id=?
      ORDER BY ji.rowid
    `,
      )
      .all(approved.job!.id) as Array<{ sourcePath: string; uid: number }>;

    expect(ordered).toEqual([
      { sourcePath: "Folders/First", uid: 20 },
      { sourcePath: "Folders/Second", uid: 30 },
      { sourcePath: "Folders/Second", uid: 10 },
    ]);
    current.profile.database.close();
  });

  it("retires obsolete empty Proton containers only after a verified replacement filing run", async () => {
    const current = setup();
    current.profile.database
      .prepare(
        `
      INSERT INTO mail_containers(
        id,connection_id,profile_id,provider_container_id,display_name,delimiter,
        special_use,flags_json,message_count,unread_count,uid_validity,uid_next,observed_at
      ) VALUES (?,?,?,?,?,'/',NULL,'[]',0,0,'8',1,'2026-08-26T12:00:00.000Z')
    `,
      )
      .run(
        "7599fc8c-e269-4de7-8934-cdb67a1948dc",
        current.connection.id,
        current.profile.profile.id,
        "Folders/Old filing",
        "Old filing",
      );
    const plan = current.plans.generate(current.connection.id, {
      kind: "organize",
      existingSetup: "replace",
      containers: {},
      trashSenderDomains: [],
    });
    expect(plan.existingSetup).toBe("replace");
    expect(plan.legacyContainers).toContainEqual(
      expect.objectContaining({
        providerPath: "Folders/Old filing",
        state: "pending",
        observedMessages: 0,
      }),
    );

    const client = new FakeMutationClient();
    client.legacyContainers.set("Folders/Old filing", 0);
    const approved = current.plans.approve(plan.id, plan.revision);
    const result = await new CleanupRunner(
      current.jobs,
      current.plans,
      current.connections,
      () => client,
    ).run(approved.job!.id);

    expect(result.plan.state).toBe("completed");
    expect(result.plan.legacyContainers).toContainEqual(
      expect.objectContaining({
        providerPath: "Folders/Old filing",
        state: "retired",
        errorCode: null,
      }),
    );
    expect(client.legacyContainers.has("Folders/Old filing")).toBe(false);
    current.profile.database.close();
  });

  it("finishes filing while retaining an obsolete folder that is still nonempty", async () => {
    const current = setup();
    current.profile.database
      .prepare(
        `
      INSERT INTO mail_containers(
        id,connection_id,profile_id,provider_container_id,display_name,delimiter,
        special_use,flags_json,message_count,unread_count,uid_validity,uid_next,observed_at
      ) VALUES (?,?,?,?,?,'/',NULL,'[]',1,0,'8',2,'2026-08-26T12:00:00.000Z')
    `,
      )
      .run(
        "6d58ed09-85c4-473a-828b-aad36145626f",
        current.connection.id,
        current.profile.profile.id,
        "Folders/Still occupied",
        "Still occupied",
      );
    const plan = current.plans.generate(current.connection.id, {
      kind: "organize",
      existingSetup: "replace",
      containers: {},
      trashSenderDomains: [],
    });
    const client = new FakeMutationClient();
    client.legacyContainers.set("Folders/Still occupied", 1);
    const approved = current.plans.approve(plan.id, plan.revision);
    const result = await new CleanupRunner(
      current.jobs,
      current.plans,
      current.connections,
      () => client,
    ).run(approved.job!.id);

    expect(result.plan.state).toBe("completed");
    expect(result.plan.job?.counts.skipped).toBe(1);
    expect(result.plan.legacyContainers).toContainEqual(
      expect.objectContaining({
        providerPath: "Folders/Still occupied",
        state: "retained_nonempty",
      }),
    );
    current.profile.database.close();
  });

  it("previews exact impact, rejects stale approval, then applies only approved actions", async () => {
    const current = setup();
    const plan = current.plans.generate(current.connection.id, {
      kind: "organize",
      containers: { "owner@pm.test": "Primary" },
      trashSenderDomains: [],
    });
    expect(plan).toMatchObject({
      state: "draft",
      actionCount: 3,
      spamCount: 0,
      skippedCount: 1,
    });
    expect(() => current.plans.approve(plan.id, "stale-revision")).toThrow(
      "cleanup_plan_changed",
    );
    const approved = current.plans.approve(plan.id, plan.revision);
    expect(approved.job?.kind).toBe("proton-cleanup");

    const client = new FakeMutationClient();
    const result = await new CleanupRunner(
      current.jobs,
      current.plans,
      current.connections,
      () => client,
    ).run(approved.job!.id);
    expect(result.plan.state).toBe("completed");
    expect(result.profileId).toBe(current.profile.profile.id);
    expect(result.plan.job?.state).toBe("succeeded");
    expect(client.applied).toHaveLength(3);
    expect(
      client.applied.some(([, , target]) => target === "Proton Spam"),
    ).toBe(false);
    expect(
      client.applied.some(
        ([, , target]) => target === "Folders/Primary/Security/Account changes",
      ),
    ).toBe(true);
    expect(
      client.applied.some(
        ([, , target]) =>
          target === "Folders/Primary/Promotions/Sales & offers",
      ),
    ).toBe(true);
    expect(
      client.messages.get("Folders/Primary/Security/Account changes:1001")
        ?.flags,
    ).not.toContain("\\Seen");
    expect(
      (
        current.profile.database
          .prepare(
            "SELECT COUNT(*) AS count FROM cleanup_actions WHERE prior_flags_json = '[\"\\\\Flagged\"]' AND state = 'succeeded'",
          )
          .get() as { count: number }
      ).count,
    ).toBe(3);
    expect(
      (
        current.profile.database
          .prepare(
            "SELECT COUNT(*) AS count FROM cleanup_actions WHERE resulting_uid IS NOT NULL AND resulting_uid_validity = '2'",
          )
          .get() as { count: number }
      ).count,
    ).toBe(3);
    const nextPlan = current.plans.generate(current.connection.id, {
      kind: "organize",
      containers: {},
      trashSenderDomains: [],
    });
    expect(nextPlan.actionCount).toBe(0);
    expect(client.closed).toBe(true);
    current.profile.database.close();
  });

  it("undoes verified moves in reverse order and restores the exact prior flags", async () => {
    const current = setup();
    const plan = current.plans.generate(current.connection.id, {
      kind: "organize",
      containers: {},
      trashSenderDomains: [],
    });
    const approved = current.plans.approve(plan.id, plan.revision);
    const client = new FakeMutationClient();
    const runner = new CleanupRunner(
      current.jobs,
      current.plans,
      current.connections,
      () => client,
    );
    const applied = await runner.run(approved.job!.id);
    const undoPlan = current.plans.prepareUndo(applied.plan.id);
    const undone = await runner.undo(undoPlan.undoJob!.id);
    expect(undone.plan.undoJob?.state).toBe("succeeded");
    expect(client.restored).toHaveLength(3);
    expect(
      client.restored.every(
        ([, , , flags]) =>
          JSON.stringify(flags) === JSON.stringify(["\\Flagged"]),
      ),
    ).toBe(true);
    expect(
      (
        current.profile.database
          .prepare(
            "SELECT COUNT(*) AS count FROM cleanup_actions WHERE undo_state = 'succeeded'",
          )
          .get() as { count: number }
      ).count,
    ).toBe(3);
    expect(
      (
        current.profile.database
          .prepare(
            `
      SELECT COUNT(*) AS count FROM indexed_messages im
      JOIN mail_containers mc ON mc.id=im.container_id
      WHERE mc.provider_container_id='INBOX' AND im.uid_validity='3'
    `,
          )
          .get() as { count: number }
      ).count,
    ).toBe(3);
    current.profile.database.close();
  });

  it("selectively retries a failed provider action from its durable checkpoint", async () => {
    const current = setup();
    const plan = current.plans.generate(current.connection.id, {
      kind: "organize",
      containers: {},
      trashSenderDomains: [],
    });
    const approved = current.plans.approve(plan.id, plan.revision);
    const client = new FakeMutationClient();
    client.messages.delete("INBOX:2");
    const runner = new CleanupRunner(
      current.jobs,
      current.plans,
      current.connections,
      () => client,
    );
    const first = await runner.run(approved.job!.id);
    expect(first.plan.failedActions).toHaveLength(1);
    const failed = first.plan.failedActions[0]!;
    client.messages.set("INBOX:2", { uidValidity: "1", flags: ["\\Flagged"] });
    const retried = current.plans.retry(plan.id, [failed.id]);
    expect(retried.job?.counts.pending).toBe(1);
    const completed = await runner.run(retried.job!.id);
    expect(completed.plan.job?.state).toBe("succeeded");
    expect(completed.plan.failedActions).toHaveLength(0);
    current.profile.database.close();
  });

  it("preserves original flags when an uncertain provider batch is resumed", async () => {
    const current = setup();
    const plan = current.plans.generate(current.connection.id, {
      kind: "organize",
      containers: {},
      trashSenderDomains: [],
    });
    const approved = current.plans.approve(plan.id, plan.revision);
    const client = new FakeMutationClient();
    client.failBatch = true;
    const runner = new CleanupRunner(
      current.jobs,
      current.plans,
      current.connections,
      () => client,
    );

    const paused = await runner.run(approved.job!.id);
    expect(paused.plan.job?.state).toBe("pending");
    expect(paused.plan.failedActions).toHaveLength(0);
    const capturedUids = client.appliedBatches[0]![1];
    for (let uid = 1; uid <= 4; uid += 1) {
      client.messages.set(`INBOX:${uid}`, {
        uidValidity: "1",
        flags: ["\\Seen"],
      });
    }
    client.failBatch = false;
    await runner.run(approved.job!.id);

    const actions = current.profile.database
      .prepare(
        "SELECT uid,prior_flags_json FROM cleanup_actions WHERE state='succeeded'",
      )
      .all() as Array<{ uid: number; prior_flags_json: string }>;
    expect(actions).toHaveLength(3);
    for (const action of actions) {
      expect(action.prior_flags_json).toBe(
        capturedUids.includes(action.uid) ? '["\\\\Flagged"]' : '["\\\\Seen"]',
      );
    }
    current.profile.database.close();
  });

  it("persists move pointers before verification and resumes without moving messages twice", async () => {
    const current = setup();
    const plan = current.plans.generate(current.connection.id, {
      kind: "organize",
      containers: {},
      trashSenderDomains: [],
    });
    const approved = current.plans.approve(plan.id, plan.revision);
    const client = new FakeMutationClient();
    client.failTargetInspectionOnce = true;
    const runner = new CleanupRunner(
      current.jobs,
      current.plans,
      current.connections,
      () => client,
    );

    const paused = await runner.run(approved.job!.id);
    expect(paused.plan.job?.state).toBe("pending");
    expect(paused.plan.job?.errorCode).toBe("provider_verification_pending");
    const moveCount = client.applied.length;
    expect(moveCount).toBeGreaterThan(0);
    expect(
      (
        current.profile.database
          .prepare(
            `
      SELECT COUNT(*) AS count FROM cleanup_actions
      WHERE resulting_path IS NOT NULL AND resulting_uid IS NOT NULL AND resulting_uid_validity IS NULL
    `,
          )
          .get() as { count: number }
      ).count,
    ).toBeGreaterThan(0);

    const completed = await runner.run(approved.job!.id);
    expect(completed.plan.job?.state).toBe("succeeded");
    expect(client.applied).toHaveLength(3);
    expect(client.applied.slice(0, moveCount)).toHaveLength(moveCount);
    expect(new Set(client.applied.map(([, uid]) => uid)).size).toBe(3);
    current.profile.database.close();
  });

  it("refuses a changed source UIDVALIDITY without mutating provider state", async () => {
    const current = setup();
    const plan = current.plans.generate(current.connection.id, {
      kind: "organize",
      containers: {},
      trashSenderDomains: [],
    });
    const approved = current.plans.approve(plan.id, plan.revision);
    const client = new FakeMutationClient("999");
    const result = await new CleanupRunner(
      current.jobs,
      current.plans,
      current.connections,
      () => client,
    ).run(approved.job!.id);
    expect(result.plan.job?.state).toBe("verification_mismatch");
    expect(client.applied).toHaveLength(0);
    current.profile.database.close();
  });

  it("preflights every destination before claiming any mailbox action", async () => {
    const current = setup();
    const plan = current.plans.generate(current.connection.id, {
      kind: "organize",
      containers: {},
      trashSenderDomains: [],
    });
    const approved = current.plans.approve(plan.id, plan.revision);
    const client = new FakeMutationClient();
    client.rejectTargets = true;
    const runner = new CleanupRunner(
      current.jobs,
      current.plans,
      current.connections,
      () => client,
    );

    await expect(runner.run(approved.job!.id)).rejects.toThrow(
      "proton_target_rejected",
    );
    expect(current.jobs.getProgress(approved.job!.id).counts).toMatchObject({
      pending: 3,
      running: 0,
      failed: 0,
    });
    expect(client.applied).toHaveLength(0);
    current.profile.database.close();
  });

  it("builds a separate protected sender-domain plan that moves only non-critical history to native Trash", async () => {
    const current = setup();
    expect(
      current.plans.generate(current.connection.id, {
        kind: "trash",
        containers: {},
        trashSenderDomains: ["store.example"],
      }).actionCount,
    ).toBe(0);
    current.profile.database
      .prepare(
        "UPDATE indexed_messages SET received_at='2020-01-01T00:00:00.000Z'",
      )
      .run();
    const plan = current.plans.generate(current.connection.id, {
      kind: "trash",
      containers: {},
      trashSenderDomains: ["store.example", "service.example"],
    });
    expect(plan).toMatchObject({
      kind: "trash",
      actionCount: 2,
      trashCount: 2,
      spamCount: 0,
    });
    const approved = current.plans.approve(plan.id, plan.revision);
    const client = new FakeMutationClient();
    const result = await new CleanupRunner(
      current.jobs,
      current.plans,
      current.connections,
      () => client,
    ).run(approved.job!.id);
    expect(result.plan.state).toBe("completed");
    expect(client.prepared).toContainEqual(["Trash", false, true]);
    expect(client.applied).toContainEqual(["INBOX", 2, "Proton Trash"]);
    expect(client.appliedBatches).toContainEqual([
      "INBOX",
      [2, 4],
      "Proton Trash",
    ]);
    expect(client.applied.some(([, uid]) => uid === 1)).toBe(false);
    current.profile.database.close();
  });
});
