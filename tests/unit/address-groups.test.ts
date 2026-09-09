import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { seedBulkMailbox } from "../fixtures/bulk-mailbox";
import { ProfileRepository } from "../../src/main/profiles/profile-repository";
import { AccountIdentityRepository } from "../../src/main/identity/account-identity-repository";
import { AddressGroupRepository } from "../../src/main/identity/address-group-repository";
import { MailHandlingRepository } from "../../src/main/settings/mail-handling-repository";
import { handlingPreferencesSchema } from "../../src/shared/contracts/mail-handling";
import { previewMailHandling } from "../../src/main/settings/mail-handling-preview";
import { OrganizationProposalRepository } from "../../src/main/organization/organization-proposal-repository";
import { groupedProposalItems } from "../../src/core/classification/proposal-groups";
import { analyzeMailbox } from "../../src/main/analysis/mailbox-analysis-service";
import { GmailAnalysisService } from "../../src/main/gmail/gmail-analysis-service";
import { OutlookAnalysisService } from "../../src/main/outlook/outlook-analysis-service";
import { GmailConnectionRepository } from "../../src/main/gmail/gmail-connection-repository";
import { OutlookConnectionRepository } from "../../src/main/outlook/outlook-connection-repository";
import { SafeStorageVault } from "../../src/main/secrets/safe-storage-vault";
import { SpamReviewRepository } from "../../src/main/spam/spam-review-repository";
import { RuleReconciliationRepository } from "../../src/main/rules/rule-reconciliation-repository";
import { matchesPurposeConditions } from "../../src/core/rules/purpose-filter";
import { JobRepository } from "../../src/main/jobs/job-repository";
import { CleanupPlanRepository } from "../../src/main/cleanup/cleanup-plan-repository";
import { GmailOrganizationRepository } from "../../src/main/gmail/gmail-organization-repository";
import { OutlookHistoryRepository } from "../../src/main/outlook/outlook-history-repository";
import { FolderSetup } from "../../src/main/organization/folder-setup";
import { GROUP_COLORS } from "../../src/core/classification/group-colors";
import { rebuildLocalIndex } from "../../src/main/recovery/recovery-service";

describe("address groups", () => {
  it("keeps address-specific sender rules through moves, copies, failures and scan removal", () => {
    const root = mkdtempSync(path.join(tmpdir(), "sift-group-moves-")),
      f = seedBulkMailbox(root),
      context = new ProfileRepository(root).openProfile(f.profileId),
      db = context.database;
    try {
      const account = {
          provider: "proton" as const,
          connectionId: f.connectionId,
        },
        groups = new AddressGroupRepository(db, f.profileId),
        prefs = new MailHandlingRepository(db, f.profileId);
      const state = groups.get(account),
        other = state.groups.find((g) => g.id !== "main")!;
      const scope = (id: string) => ({
        ...account,
        level: "group" as const,
        groupId: id,
        address: null,
      });
      const rule = {
        id: randomUUID(),
        sender: "news@vendor.example",
        address: "shared@example.test",
        subjectContains: null,
        category: "promotions" as const,
        handling: {
          destination: "spam" as const,
          markRead: true,
          retentionDays: null,
        },
      };
      const source = {
        ...prefs.get(scope(other.id)).preferences,
        rules: [rule],
      };
      prefs.save({ ...scope(other.id), preferences: source });
      prefs.saveDraft({
        ...scope(other.id),
        preferences: {
          ...source,
          rules: [{ ...rule, subjectContains: "Weekly" }],
        },
      });
      prefs.copyGroups({
        ...account,
        revision: state.revision,
        sourceId: other.id,
        targetIds: ["main"],
      });
      expect(prefs.get(scope("main")).draft!.rules).toEqual([]);
      const before = prefs.get(scope("main")).draft;
      expect(() =>
        prefs.copyGroups({
          ...account,
          revision: state.revision,
          sourceId: other.id,
          targetIds: ["main", randomUUID()],
        }),
      ).toThrow("address_group_required");
      expect(prefs.get(scope("main")).draft).toEqual(before);
      const moved = groups.save({
        ...account,
        revision: state.revision,
        groups: [
          {
            ...state.groups.find((g) => g.id === "main")!,
            addresses: state.groups.flatMap((g) => g.addresses),
          },
        ],
      });
      expect(prefs.get(scope("main")).preferences.rules).toEqual([rule]);
      expect(prefs.get(scope("main")).draft!.rules![0]!.subjectContains).toBe(
        "Weekly",
      );
      expect(
        db
          .prepare("SELECT 1 FROM mail_handling_drafts WHERE scope_key=?")
          .get(`proton:${f.connectionId}:group:${other.id}`),
      ).toBeUndefined();
      const jobs = new JobRepository(db),
        job = jobs.createJob({
          profileId: f.profileId,
          kind: "synthetic-audit",
          idempotencyKey: randomUUID(),
          itemKeys: ["pending"],
        });
      expect(() =>
        prefs.saveGroupDrafts({
          ...scope("main"),
          preferences: prefs.get(scope("main")).draft!,
        }),
      ).toThrow("mail_job_running");
      expect(prefs.get(scope("main")).draft!.rules![0]!.subjectContains).toBe(
        "Weekly",
      );
      db.prepare("UPDATE job_items SET state='skipped' WHERE job_id=?").run(
        job.id,
      );
      db.prepare("UPDATE jobs SET state='skipped' WHERE id=?").run(job.id);
      prefs.saveGroupDrafts({
        ...scope("main"),
        preferences: prefs.get(scope("main")).draft!,
      });
      expect(
        prefs.resolve("proton", f.connectionId, rule.address).rules![0]!
          .subjectContains,
      ).toBe("Weekly");
      expect(() =>
        groups.save({
          ...account,
          revision: moved.revision,
          groups: [
            {
              ...moved.groups[0]!,
              addresses: [
                ...moved.groups[0]!.addresses,
                "outsider@example.test",
              ],
            },
          ],
        }),
      ).toThrow("confirmed_address_required");
      rebuildLocalIndex(context);
      expect(groups.get(account)).toEqual(moved);
      expect(prefs.get(scope("main")).preferences.rules).toHaveLength(1);
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
  it.each(["proton", "gmail", "outlook"] as const)(
    "groups 3/5/2 addresses with isolated previews, folders and future rules on %s",
    async (provider) => {
      const root = mkdtempSync(path.join(tmpdir(), "sift-group-test-")),
        f = seedBulkMailbox(root),
        db = new ProfileRepository(root).openProfile(f.profileId).database;
      try {
        const addresses = [
          "owner@example.test",
          "shared@example.test",
          ...Array.from({ length: 8 }, (_, i) => `alias${i}@example.test`),
        ];
        const add = db.prepare(
          "INSERT INTO indexed_messages(id,connection_id,container_id,uid_validity,uid,message_id,received_at,subject,sender_json,recipients_json,headers_json,flags_json,size_bytes,body_text,body_truncated,indexed_at) SELECT ?,connection_id,container_id,'1',?,?,'2026-09-03T12:00:00.000Z','Your receipt for payment','[\"billing@store.example\"]',?,?,'[]',100,NULL,0,'2026-09-03T12:00:00.000Z' FROM indexed_messages LIMIT 1",
        );
        addresses.forEach((a, i) =>
          add.run(
            randomUUID(),
            2000 + i,
            `group-${i}@example.test`,
            JSON.stringify([a]),
            JSON.stringify({ "delivered-to": a }),
          ),
        );
        const vault = new SafeStorageVault(root, db, {
          isEncryptionAvailable: () => true,
          encryptString: (s) => Buffer.from(s).reverse(),
          decryptString: (b) => Buffer.from(b).reverse().toString(),
        });
        const gmail =
          provider === "gmail"
            ? new GmailConnectionRepository(db, vault, f.profileId).save(
                { clientId: "synthetic.apps.googleusercontent.com" },
                addresses[0]!,
                "synthetic",
              )
            : null;
        const outlook =
          provider === "outlook"
            ? new OutlookConnectionRepository(db, vault, f.profileId).save(
                { clientId: randomUUID(), tenant: "common" },
                addresses[0]!,
                "synthetic",
              )
            : null;
        const connectionId = gmail?.id ?? outlook?.id ?? f.connectionId;
        if (gmail)
          db.prepare(
            "INSERT INTO gmail_indexed_messages(id,connection_id,gmail_message_id,thread_id,received_at,subject,sender_json,recipients_json,headers_json,label_ids_json,size_bytes,indexed_at) SELECT id,?,id,id,received_at,subject,sender_json,recipients_json,headers_json,'[\"INBOX\"]',size_bytes,indexed_at FROM indexed_messages",
          ).run(connectionId);
        if (outlook) {
          db.prepare(
            "INSERT INTO outlook_folder_ids VALUES(?,'inbox','sent','trash','junk','archive','now')",
          ).run(connectionId);
          db.prepare(
            "INSERT INTO outlook_indexed_messages(id,connection_id,graph_message_id,conversation_id,received_at,subject,sender_json,recipients_json,headers_json,categories_json,parent_folder_id,is_read,size_bytes,indexed_at) SELECT id,?,id,id,received_at,subject,sender_json,recipients_json,headers_json,'[]','inbox',0,size_bytes,indexed_at FROM indexed_messages",
          ).run(connectionId);
        }
        new AccountIdentityRepository(db, f.profileId).sync(
          provider,
          connectionId,
          addresses.map((address) => ({
            address,
            providerEvidence: true,
            evidence: ["provider_alias"],
            sentFromCount: 0,
            deliveredToCount: 1,
            lastSeenAt: null,
          })),
        );
        const account = { provider, connectionId },
          groups = new AddressGroupRepository(db, f.profileId),
          prefs = new MailHandlingRepository(db, f.profileId);
        const first = groups.get(account),
          ids = ["main", randomUUID(), randomUUID()];
        const state = groups.save({
          ...account,
          revision: first.revision,
          groups: [
            {
              id: ids[0]!,
              name: "Main",
              color: "red",
              addresses: addresses.slice(0, 3),
            },
            {
              id: ids[1]!,
              name: "Projects",
              color: "pink",
              addresses: addresses.slice(3, 8),
            },
            {
              id: ids[2]!,
              name: "Clubs",
              color: "green",
              addresses: addresses.slice(8),
            },
          ],
        });
        expect(state.groups.map((g) => g.addresses.length)).toEqual([3, 5, 2]);
        const scope = (groupId: string) => ({
          ...account,
          level: "group" as const,
          groupId,
          address: null,
        });
        const choices = handlingPreferencesSchema.parse({
          detail: "simple",
          categories: {
            transactions: {
              destination: "file",
              markRead: true,
              retentionDays: null,
            },
            codes: {
              destination: "inbox",
              markRead: false,
              retentionDays: null,
            },
          },
        });
        prefs.saveDraft({ ...scope("main"), preferences: choices });
        prefs.copyGroups({
          ...account,
          revision: state.revision,
          sourceId: "main",
          targetIds: ids.slice(1),
        });
        prefs.saveGroupDrafts({ ...scope("main"), preferences: choices });
        expect(
          db.prepare("SELECT COUNT(*) n FROM mail_handling_drafts").get(),
        ).toEqual({ n: 0 });
        for (const a of addresses)
          expect(prefs.resolve(provider, connectionId, a).detail).toBe(
            "simple",
          );
        prefs.save({
          ...scope(ids[1]!),
          preferences: { ...choices, detail: "detailed" },
        });
        expect(
          prefs.resolve(provider, connectionId, addresses[3]!).detail,
        ).toBe("detailed");
        expect(
          prefs.resolve(provider, connectionId, addresses[0]!).detail,
        ).toBe("simple");
        const analyze = () =>
          gmail
            ? new GmailAnalysisService(db, f.profileId).analyze(gmail)
            : outlook
              ? new OutlookAnalysisService(db, f.profileId).analyze(outlook)
              : analyzeMailbox(db, f.profileId, connectionId);
        analyze();
        const previews = ids.map((id) =>
          previewMailHandling(db, f.profileId, {
            ...scope(id),
            preferences: prefs.get(scope(id)).preferences,
            page: 0,
            category: null,
          }),
        );
        expect(previews.reduce((n, p) => n + p.total, 0)).toBe(550);
        previews.forEach((p, i) =>
          expect(
            p.examples.every((e) =>
              state.groups[i]!.addresses.includes(e.address!),
            ),
          ).toBe(true),
        );
        const proposals = new OrganizationProposalRepository(db, f.profileId),
          proposal = proposals.generate(provider, connectionId);
        for (const item of proposal.items.filter(
          (i) => i.enabled && i.category === "transactions",
        ))
          expect(
            item.targetPath.startsWith(
              groups.routing(account).get(item.scopeAddress!)!.name + "/",
            ),
          ).toBe(true);
        const grouped = groupedProposalItems(proposal).filter(
          (i) => i.category === "transactions",
        );
        expect(grouped).toHaveLength(3);
        expect(grouped.find((g) => g.groupId === ids[1])!.itemIds).toHaveLength(
          5,
        );
        const row = grouped.find((g) => g.groupId === ids[1])!;
        const edit = {
          proposalId: proposal.id,
          revision: proposal.revision,
          itemId: row.id,
          category: row.category,
          targetPath: row.targetPath,
          enabled: false,
        };
        expect(() =>
          proposals.edit({ ...edit, itemIds: [...row.itemIds, randomUUID()] }),
        ).toThrow("organization_proposal_item_not_found");
        expect(proposals.get(provider, connectionId)?.items).toEqual(
          proposal.items,
        );
        expect(() =>
          proposals.edit({ ...edit, targetPath: "Main/Receipts" }),
        ).toThrow("group_destination_required");
        const folderInput = {
            ...account,
            proposalId: proposal.id,
            revision: proposal.revision,
          },
          folderSetup = new FolderSetup(db, f.profileId);
        const ensured: Array<{ path: string; color?: string }> = [];
        let failOnce = true;
        const prepare = async () => ({
          ensure: async (path: string, color?: string) => {
            if (failOnce) {
              failOnce = false;
              throw Error("synthetic_folder_failure");
            }
            ensured.push({ path, color });
          },
          close: async () => {},
        });
        folderSetup.start(folderInput, prepare);
        await vi.waitFor(() =>
          expect(folderSetup.get(folderInput)?.state).toBe("failed"),
        );
        folderSetup.start(folderInput, prepare);
        await vi.waitFor(() =>
          expect(folderSetup.get(folderInput)?.state).toBe("succeeded"),
        );
        for (const item of ensured) {
          const group = state.groups.find(
            (g) => item.path === g.name || item.path.startsWith(g.name + "/"),
          )!;
          expect(group).toBeDefined();
          expect(item.color).toBe(
            provider === "gmail" ? GROUP_COLORS[group.color].hex : undefined,
          );
        }
        if (provider === "gmail")
          for (const group of state.groups)
            expect(ensured.some((i) => i.path === group.name)).toBe(true);
        const reviews = new SpamReviewRepository(db, f.profileId),
          review = reviews.generate(provider, connectionId);
        reviews.complete({
          reviewId: review.id,
          revision: review.revision,
          decisions: review.candidates.map((c) => ({
            candidateId: c.id,
            decision: "not_spam",
          })),
        });
        const jobs = new JobRepository(db);
        if (gmail)
          new GmailOrganizationRepository(db, jobs, f.profileId).generate(
            gmail,
            { kind: "spam" },
          );
        else if (outlook)
          new OutlookHistoryRepository(db, jobs, f.profileId).generate(
            outlook,
            { kind: "spam" },
          );
        else
          new CleanupPlanRepository(db, jobs, f.profileId).generate(
            connectionId,
            { kind: "spam", containers: {}, trashSenderDomains: [] },
          );
        // Native Gmail/Graph rules use conservative phrase guards; use a receipt
        // subject supported by all three providers for the routing assertion.
        const prefix = provider === "proton" ? "" : `${provider}_`;
        db.prepare(
          `UPDATE ${prefix}indexed_messages SET subject='Your receipt from Store' WHERE sender_json='["billing@store.example"]'`,
        ).run();
        const rules = new RuleReconciliationRepository(db, f.profileId)
          .desired(provider, connectionId)
          .rules.filter((r) => r.category === "transactions");
        for (const address of addresses) {
          const matching = rules.filter(
            (r) =>
              r.purposeConditions &&
              matchesPurposeConditions(
                r.purposeConditions,
                "Your receipt from Store",
                "billing@store.example",
                [address],
              ),
          );
          expect(
            matching,
            JSON.stringify({
              provider,
              address,
              rules: rules.filter((r) =>
                r.purposeConditions?.senderAddresses.includes(
                  "billing@store.example",
                ),
              ),
            }),
          ).toHaveLength(1);
          expect(
            matching[0]!.targetPath.startsWith(
              groups.routing(account).get(address)!.name + "/",
            ),
          ).toBe(true);
        }
        expect(() =>
          groups.save({
            ...account,
            ...state,
            groups: state.groups.map((g) => ({
              ...g,
              addresses: [...g.addresses, addresses[0]!],
            })),
          }),
        ).toThrow();
        const job = new JobRepository(db).createJob({
          profileId: f.profileId,
          kind: "synthetic-audit",
          idempotencyKey: randomUUID(),
          itemKeys: ["pending"],
        });
        expect(() => groups.save({ ...account, ...state })).toThrow(
          "mail_job_running",
        );
        db.prepare("UPDATE job_items SET state='skipped' WHERE job_id=?").run(
          job.id,
        );
        db.prepare("UPDATE jobs SET state='skipped' WHERE id=?").run(job.id);
        const single = groups.save({
          ...account,
          revision: state.revision,
          groups: [{ ...state.groups[0]!, addresses }],
        });
        expect(single.groups).toHaveLength(1);
        expect(proposals.get(provider, connectionId)?.requiresRebuild).toBe(
          true,
        );
        expect(
          [...groups.routing(account).values()].every((g) => g.parent === null),
        ).toBe(true);
        expect(
          proposals
            .generate(provider, connectionId)
            .items.filter((i) => i.enabled)
            .every(
              (i) =>
                !i.targetPath.startsWith("Main/") &&
                !i.targetPath.startsWith("Projects/"),
            ),
        ).toBe(true);
        db.prepare(
          `DELETE FROM ${provider === "proton" ? "provider_connections" : `${provider}_connections`} WHERE id=?`,
        ).run(connectionId);
        expect(
          db
            .prepare(
              "SELECT COUNT(*) n FROM address_groups WHERE connection_id=?",
            )
            .get(connectionId),
        ).toEqual({ n: 0 });
      } finally {
        db.close();
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
});
