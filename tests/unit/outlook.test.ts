import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OutlookAnalysisService } from "../../src/main/outlook/outlook-analysis-service";
import { OutlookAuditService } from "../../src/main/outlook/outlook-audit-service";
import { OutlookConnectionRepository } from "../../src/main/outlook/outlook-connection-repository";
import { OutlookIdentityService } from "../../src/main/outlook/outlook-identity-service";
import { OutlookHistoryRepository } from "../../src/main/outlook/outlook-history-repository";
import { OutlookHistoryRunner } from "../../src/main/outlook/outlook-history-runner";
import { OutlookSubscriptionService } from "../../src/main/outlook/outlook-subscription-service";
import {
  exchangeOutlookCode,
  refreshOutlookAccessToken,
} from "../../src/main/outlook/outlook-oauth";
import { normalizeOutlookRule } from "../../src/main/outlook/outlook-rule-mapper";
import { JobRepository } from "../../src/main/jobs/job-repository";
import { OrganizationProposalRepository } from "../../src/main/organization/organization-proposal-repository";
import { ProfileRepository } from "../../src/main/profiles/profile-repository";
import {
  SafeStorageVault,
  type SafeStoragePort,
} from "../../src/main/secrets/safe-storage-vault";
import { UnsubscribeRunner } from "../../src/main/unsubscribe/unsubscribe-runner";

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
const clientId = "9fd75eaf-2f06-46df-9703-b9861946ed96";

describe("Outlook provider adapter", () => {
  it("uses public-client PKCE and never sends a client secret", async () => {
    const fetchPort = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            access_token: "access",
            refresh_token: "refresh",
            expires_in: 3600,
            token_type: "Bearer",
          }),
          { status: 200 },
        ),
    );
    await exchangeOutlookCode(
      { clientId, tenant: "common" },
      "code",
      "verifier",
      "http://127.0.0.1:4567/oauth2callback",
      fetchPort as typeof fetch,
    );
    const body = fetchPort.mock.calls[0]![1]!.body as URLSearchParams;
    expect(body.get("code_verifier")).toBe("verifier");
    expect(body.get("client_secret")).toBeNull();
    await expect(
      refreshOutlookAccessToken(
        clientId,
        "consumers",
        "refresh",
        fetchPort as typeof fetch,
      ),
    ).resolves.toBe("access");
    expect(String(fetchPort.mock.calls[1]![0])).toContain(
      "/consumers/oauth2/v2.0/token",
    );
  });

  it("indexes metadata, proves only provider or Sent identities, and builds an address-scoped analysis", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "sift-outlook-"));
    roots.push(root);
    const profileId = "35b7a894-e163-4b3d-b450-79cfaa565db7";
    const connectionId = "7871804b-7913-4d5d-b531-a4f78f3cd7cd";
    const profile = new ProfileRepository(root, {
      createId: () => profileId,
    }).createProfile("Outlook test");
    const vault = new SafeStorageVault(root, profile.database, storage);
    const repository = new OutlookConnectionRepository(
      profile.database,
      vault,
      profileId,
      { createId: () => connectionId },
    );
    const connection = repository.save(
      { clientId, tenant: "common" },
      "owner@example.test",
      "encrypted-refresh",
    );
    expect(JSON.stringify(connection)).not.toContain("encrypted-refresh");
    const fetchPort = vi.fn(async (rawUrl: string | URL | Request) => {
      const url = String(rawUrl);
      if (url.includes("/oauth2/v2.0/token"))
        return new Response(
          JSON.stringify({
            access_token: "access",
            expires_in: 3600,
            token_type: "Bearer",
          }),
          { status: 200 },
        );
      if (url.includes("/mailFolders/inbox?"))
        return new Response(JSON.stringify({ id: "folder-inbox" }), {
          status: 200,
        });
      if (url.includes("/mailFolders/sentitems?"))
        return new Response(JSON.stringify({ id: "folder-sent" }), {
          status: 200,
        });
      if (url.includes("/mailFolders/deleteditems?"))
        return new Response(JSON.stringify({ id: "folder-trash" }), {
          status: 200,
        });
      if (url.includes("/mailFolders/junkemail?"))
        return new Response(JSON.stringify({ id: "folder-junk" }), {
          status: 200,
        });
      if (url.includes("/mailFolders/archive?"))
        return new Response(JSON.stringify({ id: "folder-archive" }), {
          status: 200,
        });
      if (url.includes("/me/messages?"))
        return new Response(
          JSON.stringify({
            "@odata.count": 2,
            value: [
              {
                id: "received-1",
                receivedDateTime: "2026-08-20T12:00:00.000Z",
                subject: "Your payment receipt",
                from: { emailAddress: { address: "billing@store.example" } },
                toRecipients: [
                  { emailAddress: { address: "owner@example.test" } },
                  { emailAddress: { address: "copied@company.example" } },
                ],
                internetMessageHeaders: [
                  { name: "Delivered-To", value: "owner@example.test" },
                ],
                categories: [],
                parentFolderId: "folder-inbox",
                isRead: false,
              },
              {
                id: "sent-1",
                receivedDateTime: "2026-08-21T12:00:00.000Z",
                subject: "Hello",
                from: { emailAddress: { address: "home@example.test" } },
                toRecipients: [
                  { emailAddress: { address: "friend@example.test" } },
                ],
                internetMessageHeaders: [],
                categories: [],
                parentFolderId: "folder-sent",
                isRead: true,
              },
            ],
          }),
          { status: 200 },
        );
      if (
        url.includes(
          "/me?$select=mail,userPrincipalName,otherMails,proxyAddresses",
        )
      )
        return new Response(
          JSON.stringify({
            mail: "owner@example.test",
            userPrincipalName: "owner@example.test",
            proxyAddresses: [
              "SMTP:owner@example.test",
              "smtp:home@example.test",
            ],
          }),
          { status: 200 },
        );
      return new Response(null, { status: 404 });
    });
    const audit = await new OutlookAuditService(profile.database, repository, {
      fetchPort: fetchPort as typeof fetch,
    }).run();
    expect(audit).toMatchObject({
      state: "completed",
      indexedMessages: 2,
      totalEstimate: 2,
    });
    const identities = await new OutlookIdentityService(
      profile.database,
      repository,
      profileId,
      fetchPort as typeof fetch,
    ).refresh(connectionId);
    expect(identities.map((identity) => identity.address)).toEqual([
      "home@example.test",
      "owner@example.test",
    ]);
    expect(
      identities.find((identity) => identity.address === "home@example.test"),
    ).toMatchObject({
      status: "confirmed",
      sentFromCount: 1,
      providerEvidence: true,
    });
    expect(
      identities.some(
        (identity) => identity.address === "copied@company.example",
      ),
    ).toBe(false);
    expect(
      identities.some((identity) => identity.address === "friend@example.test"),
    ).toBe(false);
    const analysis = new OutlookAnalysisService(
      profile.database,
      profileId,
    ).analyze(connection);
    expect(analysis.uniqueMessages).toBe(1);
    expect(analysis.addresses.map((identity) => identity.address)).toEqual(
      expect.arrayContaining(["owner@example.test", "home@example.test"]),
    );
    expect(analysis.categories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "transactions" }),
      ]),
    );
    const proposal = new OrganizationProposalRepository(
      profile.database,
      profileId,
    ).generate("outlook", connectionId);
    expect(proposal.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scopeAddress: "owner@example.test",
          targetPath: "Money/Receipts",
        }),
      ]),
    );
    const jobs = new JobRepository(profile.database);
    const history = new OutlookHistoryRepository(
      profile.database,
      jobs,
      profileId,
    );
    const plan = history.generate(connection);
    expect(plan).toMatchObject({
      kind: "organize",
      impactCount: 1,
      existingMessageCount: 1,
    });
    let messageState = {
      id: "received-1",
      parentFolderId: "folder-inbox",
      isRead: false,
    };
    const actionFetch = vi.fn(
      async (rawUrl: string | URL | Request, init?: RequestInit) => {
        const url = String(rawUrl);
        if (url.includes("/oauth2/v2.0/token"))
          return new Response(JSON.stringify({ access_token: "access" }), {
            status: 200,
          });
        if (url.includes("/mailFolders?") && !url.includes("/childFolders"))
          return new Response(
            JSON.stringify({
              value: [
                { id: "folder-inbox", displayName: "Inbox" },
                { id: "folder-trash", displayName: "Deleted Items" },
                { id: "folder-junk", displayName: "Junk Email" },
              ],
            }),
            { status: 200 },
          );
        if (url.includes("/childFolders") && init?.method !== "POST")
          return new Response(JSON.stringify({ value: [] }), { status: 200 });
        if (url.endsWith("/me/mailFolders") && init?.method === "POST")
          return new Response(JSON.stringify({ id: "folder-money" }), {
            status: 200,
          });
        if (
          url.includes("/folder-money/childFolders") &&
          init?.method === "POST"
        )
          return new Response(JSON.stringify({ id: "folder-receipts" }), {
            status: 200,
          });
        if (url.includes("/messages/received-1/move")) {
          messageState = {
            ...messageState,
            parentFolderId: (
              JSON.parse(String(init?.body)) as { destinationId: string }
            ).destinationId,
          };
          return new Response(JSON.stringify(messageState), { status: 200 });
        }
        if (url.includes("/messages/received-1") && init?.method === "PATCH") {
          messageState = {
            ...messageState,
            isRead: (JSON.parse(String(init.body)) as { isRead: boolean })
              .isRead,
          };
          return new Response(JSON.stringify(messageState), { status: 200 });
        }
        if (url.includes("/messages/received-1"))
          return new Response(JSON.stringify(messageState), { status: 200 });
        return new Response(null, { status: 404 });
      },
    );
    const approved = history.approve(connectionId, plan.id, plan.revision);
    const completed = await new OutlookHistoryRunner(
      repository,
      history,
      jobs,
      actionFetch as typeof fetch,
    ).run(approved.job!.id);
    expect(completed.state).toBe("completed");
    expect(messageState).toEqual({
      id: "received-1",
      parentFolderId: "folder-receipts",
      isRead: true,
    });
    const undo = history.prepareUndo(completed.id);
    await new OutlookHistoryRunner(
      repository,
      history,
      jobs,
      actionFetch as typeof fetch,
    ).undo(undo.undoJob!.id);
    expect(messageState).toEqual({
      id: "received-1",
      parentFolderId: "folder-inbox",
      isRead: false,
    });
    profile.database
      .prepare(
        `INSERT INTO outlook_indexed_messages(id,connection_id,graph_message_id,conversation_id,received_at,subject,sender_json,recipients_json,headers_json,categories_json,parent_folder_id,is_read,size_bytes,indexed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        "d5c6b6bf-4646-46d7-826c-24236d937df1",
        connectionId,
        "subscription-1",
        null,
        "2026-08-22T12:00:00.000Z",
        "Weekly digest",
        '["news@news.example"]',
        '["owner@example.test"]',
        JSON.stringify({
          "delivered-to": "owner@example.test",
          "list-id": "<weekly.news.example>",
          "list-unsubscribe": "<https://news.example/unsubscribe/opaque>",
          "list-unsubscribe-post": "List-Unsubscribe=One-Click",
          "authentication-results": "dkim=pass; dmarc=pass",
        }),
        "[]",
        "folder-inbox",
        1,
        0,
        "2026-08-22T12:00:00.000Z",
      );
    new OutlookAnalysisService(profile.database, profileId).analyze(connection);
    const subscriptions = new OutlookSubscriptionService(
      profile.database,
      jobs,
      profileId,
    );
    const dashboard = subscriptions.scan(connectionId);
    const eligible = dashboard.candidates.find(
      (candidate) => candidate.eligibility === "eligible",
    )!;
    const started = subscriptions.start([eligible.id]);
    const post = vi.fn(async () => true);
    const unsubscribed = await new UnsubscribeRunner(
      jobs,
      subscriptions,
      post,
    ).run(started.job!.id);
    expect(
      unsubscribed.dashboard.candidates.find(
        (candidate) => candidate.id === eligible.id,
      )?.status,
    ).toBe("unsubscribed");
    expect(post).toHaveBeenCalledWith(
      "https://news.example/unsubscribe/opaque",
    );
    const maliciousPagingFetch = vi.fn(
      async (rawUrl: string | URL | Request) => {
        const url = String(rawUrl);
        if (url.includes("/oauth2/v2.0/token"))
          return new Response(JSON.stringify({ access_token: "access" }), {
            status: 200,
          });
        if (url.includes("/mailFolders/"))
          return new Response(JSON.stringify({ id: `folder-${url}` }), {
            status: 200,
          });
        return new Response(
          JSON.stringify({
            value: [],
            "@odata.nextLink": "https://attacker.example.test/mail",
          }),
          { status: 200 },
        );
      },
    );
    await expect(
      new OutlookAuditService(profile.database, repository, {
        fetchPort: maliciousPagingFetch as typeof fetch,
      }).run(),
    ).rejects.toThrow("outlook_untrusted_next_link");
    expect(
      maliciousPagingFetch.mock.calls.some((call) =>
        String(call[0]).includes("attacker.example.test"),
      ),
    ).toBe(false);
    expect(profile.database.pragma("foreign_key_check")).toEqual([]);
    profile.database.close();
  });

  it("normalizes Outlook rules into provider-neutral fingerprints", () => {
    const snapshot = normalizeOutlookRule(
      {
        id: "rule-1",
        conditions: {
          senderContains: ["@news.example"],
          recipientContains: ["owner@example.test"],
        },
        actions: { moveToFolder: "subscriptions", markAsRead: true },
      },
      new Map([["subscriptions", "Subscriptions"]]),
      { inboxId: "inbox", junkId: "junk" },
    );
    expect(snapshot).toMatchObject({
      criteria: { from: "@news.example", to: "owner@example.test" },
      action: {
        addLabels: ["Subscriptions"],
        removeLabels: ["INBOX", "UNREAD"],
      },
    });
    expect(snapshot.fingerprint).toHaveLength(64);
  });
});
