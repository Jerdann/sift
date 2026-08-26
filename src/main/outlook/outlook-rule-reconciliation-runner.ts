import type { DesiredManagedRule } from "../../shared/contracts/rule-management";
import type { JobRepository } from "../jobs/job-repository";
import type {
  RuleOperationRecord,
  RuleReconciliationRepository,
} from "../rules/rule-reconciliation-repository";
import type { OutlookConnectionRepository } from "./outlook-connection-repository";
import { refreshOutlookAccessToken, type OutlookFetch } from "./outlook-oauth";
import {
  normalizeOutlookRule,
  type GraphMessageRule,
} from "./outlook-rule-mapper";

interface Folder {
  id: string;
  displayName: string;
  parentFolderId?: string;
}
interface State {
  rules: Array<ReturnType<typeof normalizeOutlookRule>>;
  folderIdsByPath: Map<string, string>;
  folderPathsById: Map<string, string>;
  inboxId: string;
  junkId: string;
}
const GRAPH = "https://graph.microsoft.com/v1.0";
const api = async <T>(
  fetchPort: OutlookFetch,
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<T> => {
  const response = await fetchPort(
    path.startsWith("https://") ? path : `${GRAPH}${path}`,
    {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
    },
  );
  if (!response.ok) throw new Error(`outlook_api_${response.status}`);
  return (response.status === 204 ? null : await response.json()) as T;
};

export class OutlookRuleReconciliationRunner {
  constructor(
    readonly connections: OutlookConnectionRepository,
    readonly rules: RuleReconciliationRepository,
    readonly jobs: JobRepository,
    readonly fetchPort: OutlookFetch = fetch,
  ) {}

  async run(jobId: string) {
    const planId = this.rules.planIdForJob(jobId);
    for (;;) {
      const item = this.jobs.claimNextPending(jobId);
      if (!item) break;
      const operation = this.rules.operation(item.itemKey);
      this.rules.setOperationRunning(operation.id);
      try {
        if (operation.provider !== "outlook")
          throw new Error("outlook_rule_provider_mismatch");
        const token = await this.#token(operation.connectionId);
        await this.#apply(token, operation);
        this.jobs.transitionItem(item.id, "succeeded", {
          result: { operation: "provider-rule-action", verified: true },
        });
      } catch (error) {
        const code =
          error instanceof Error ? error.message : "outlook_rule_failed";
        const mismatch = code === "provider_verification_mismatch";
        this.rules.setOperationResult(
          operation.id,
          mismatch ? "verification_mismatch" : "failed",
          { errorCode: code },
        );
        this.jobs.transitionItem(
          item.id,
          mismatch ? "verification_mismatch" : "failed",
          { errorCode: code },
        );
      }
    }
    return this.rules.syncPlanState(planId);
  }

  async undo(jobId: string) {
    const planId = this.rules.planIdForUndoJob(jobId);
    for (;;) {
      const item = this.jobs.claimNextPending(jobId);
      if (!item) break;
      const operation = this.rules.operation(
        item.itemKey.replace(/^undo:/, ""),
      );
      try {
        const token = await this.#token(operation.connectionId);
        await this.#undo(token, operation);
        this.rules.setOperationResult(operation.id, "undone");
        this.jobs.transitionItem(item.id, "succeeded", {
          result: { operation: "provider-rule-action", verified: true },
        });
      } catch (error) {
        const code =
          error instanceof Error ? error.message : "outlook_rule_undo_failed";
        const mismatch = code === "provider_verification_mismatch";
        this.rules.setOperationResult(
          operation.id,
          mismatch ? "verification_mismatch" : "failed",
          { errorCode: code },
        );
        this.jobs.transitionItem(
          item.id,
          mismatch ? "verification_mismatch" : "failed",
          { errorCode: code },
        );
      }
    }
    return this.rules.syncUndoState(planId);
  }

  async #token(connectionId: string): Promise<string> {
    const value = this.connections.credentials(connectionId);
    if (!value) throw new Error("outlook_not_connected");
    return refreshOutlookAccessToken(
      value.connection.clientId,
      value.connection.tenant,
      value.refreshToken,
      this.fetchPort,
    );
  }

  async #apply(token: string, operation: RuleOperationRecord): Promise<void> {
    let state = await this.#state(token);
    const exact = operation.desired
      ? state.rules.find(
          (rule) => rule.fingerprint === operation.desired!.fingerprint,
        )
      : undefined;
    const managed = this.rules.managedRule(
      "outlook",
      operation.connectionId,
      operation.stableKey,
    );
    if (operation.kind === "unchanged") {
      const current = state.rules.find(
        (rule) => rule.providerRuleId === managed?.provider_rule_id,
      );
      if (
        !operation.desired ||
        current?.fingerprint !== operation.desired.fingerprint
      )
        throw new Error("provider_verification_mismatch");
      this.rules.setOperationResult(operation.id, "succeeded", {
        providerRuleId: current.providerRuleId,
        verifiedFingerprint: current.fingerprint,
      });
      return;
    }
    if (operation.kind === "adopt") {
      if (!operation.desired || !exact)
        throw new Error("provider_verification_mismatch");
      this.rules.activateManagedRule(
        "outlook",
        operation.connectionId,
        operation.desired,
        exact.providerRuleId,
        "adopted",
      );
      this.rules.setOperationResult(operation.id, "succeeded", {
        providerRuleId: exact.providerRuleId,
        verifiedFingerprint: exact.fingerprint,
      });
      return;
    }
    if (operation.kind === "remove") {
      const providerRuleId =
        managed?.ownership === "managed" && managed.provider_rule_id
          ? managed.provider_rule_id
          : operation.prior?.ownership === "external"
            ? operation.prior.providerRuleId
            : null;
      if (providerRuleId) await this.#delete(token, providerRuleId);
      state = await this.#state(token);
      if (
        providerRuleId &&
        state.rules.some(
          (rule) => rule.providerRuleId === providerRuleId,
        )
      )
        throw new Error("provider_verification_mismatch");
      if (managed) {
        this.rules.removeManagedRule(
          "outlook",
          operation.connectionId,
          operation.stableKey,
        );
      }
      this.rules.setOperationResult(operation.id, "succeeded", {
        verifiedFingerprint: operation.prior?.fingerprint ?? null,
      });
      return;
    }
    if (!operation.desired) throw new Error("rule_desired_state_missing");
    if (exact) {
      this.rules.activateManagedRule(
        "outlook",
        operation.connectionId,
        operation.desired,
        exact.providerRuleId,
        operation.providerRuleId === exact.providerRuleId
          ? "managed"
          : "adopted",
      );
      this.rules.setOperationResult(operation.id, "succeeded", {
        providerRuleId: exact.providerRuleId,
        verifiedFingerprint: exact.fingerprint,
      });
      return;
    }
    if (
      operation.kind === "replace" &&
      managed?.ownership === "managed" &&
      managed.provider_rule_id
    )
      await this.#delete(token, managed.provider_rule_id);
    const createdId = await this.#create(token, state, operation.desired);
    this.rules.setOperationProviderId(operation.id, createdId);
    state = await this.#state(token);
    const verified = state.rules.find(
      (rule) => rule.providerRuleId === createdId,
    );
    if (verified?.fingerprint !== operation.desired.fingerprint)
      throw new Error("provider_verification_mismatch");
    this.rules.activateManagedRule(
      "outlook",
      operation.connectionId,
      operation.desired,
      createdId,
      "managed",
    );
    this.rules.setOperationResult(operation.id, "succeeded", {
      providerRuleId: createdId,
      verifiedFingerprint: verified.fingerprint,
    });
  }

  async #undo(token: string, operation: RuleOperationRecord): Promise<void> {
    let state = await this.#state(token);
    const current = this.rules.managedRule(
      "outlook",
      operation.connectionId,
      operation.stableKey,
    );
    if (current?.ownership === "managed" && current.provider_rule_id)
      await this.#delete(token, current.provider_rule_id);
    if (
      operation.kind === "create" ||
      operation.kind === "adopt" ||
      !operation.priorManaged
    ) {
      this.rules.removeManagedRule(
        "outlook",
        operation.connectionId,
        operation.stableKey,
      );
      return;
    }
    state = await this.#state(token);
    let restored = state.rules.find(
      (rule) => rule.fingerprint === operation.priorManaged!.fingerprint,
    );
    let ownership: "managed" | "adopted" = "adopted";
    if (!restored) {
      const id = await this.#create(token, state, operation.priorManaged);
      state = await this.#state(token);
      restored = state.rules.find((rule) => rule.providerRuleId === id);
      ownership = "managed";
    }
    if (restored?.fingerprint !== operation.priorManaged.fingerprint)
      throw new Error("provider_verification_mismatch");
    this.rules.activateManagedRule(
      "outlook",
      operation.connectionId,
      operation.priorManaged,
      restored.providerRuleId,
      ownership,
    );
  }

  async #state(token: string): Promise<State> {
    const top = await api<{ value?: Folder[] }>(
      this.fetchPort,
      token,
      "/me/mailFolders?$top=100&includeHiddenFolders=true&$select=id,displayName,parentFolderId",
    );
    const folders = [...(top.value ?? [])];
    for (let index = 0; index < folders.length && index < 500; index += 1) {
      const child = await api<{ value?: Folder[] }>(
        this.fetchPort,
        token,
        `/me/mailFolders/${encodeURIComponent(folders[index]!.id)}/childFolders?$top=100&includeHiddenFolders=true&$select=id,displayName,parentFolderId`,
      );
      folders.push(
        ...(child.value ?? []).filter(
          (candidate) => !folders.some((folder) => folder.id === candidate.id),
        ),
      );
    }
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    const pathFor = (folder: Folder): string => {
      const segments = [folder.displayName];
      let parent = folder.parentFolderId
        ? byId.get(folder.parentFolderId)
        : undefined;
      while (parent) {
        segments.unshift(parent.displayName);
        parent = parent.parentFolderId
          ? byId.get(parent.parentFolderId)
          : undefined;
      }
      return segments.join("/");
    };
    const folderPathsById = new Map(
      folders.map((folder) => [folder.id, pathFor(folder)]),
    );
    const folderIdsByPath = new Map(
      [...folderPathsById].map(([id, path]) => [path, id]),
    );
    const inboxId =
      folders.find((folder) => folder.displayName.toLowerCase() === "inbox")
        ?.id ?? "inbox";
    const junkId =
      folders.find((folder) =>
        ["junk email", "junk"].includes(folder.displayName.toLowerCase()),
      )?.id ?? "junkemail";
    const payload = await api<{ value?: GraphMessageRule[] }>(
      this.fetchPort,
      token,
      "/me/mailFolders/inbox/messageRules",
    );
    return {
      rules: (payload.value ?? []).map((rule) =>
        normalizeOutlookRule(rule, folderPathsById, { inboxId, junkId }),
      ),
      folderIdsByPath,
      folderPathsById,
      inboxId,
      junkId,
    };
  }

  async #create(
    token: string,
    state: State,
    desired: DesiredManagedRule,
  ): Promise<string> {
    const destination = desired.spam
      ? state.junkId
      : await this.#ensureFolder(token, state, desired.targetPath);
    const created = await api<{ id: string }>(
      this.fetchPort,
      token,
      "/me/mailFolders/inbox/messageRules",
      {
        method: "POST",
        body: JSON.stringify({
          displayName: `Sift • ${desired.stableKey.slice(0, 12)} • ${desired.category}`,
          sequence: 1,
          isEnabled: true,
          conditions: {
            senderContains: [`@${desired.senderDomain}`],
            ...(desired.receivingAddress
              ? { recipientContains: [desired.receivingAddress] }
              : {}),
          },
          actions: {
            moveToFolder: destination,
            markAsRead: desired.markRead,
            stopProcessingRules: true,
          },
        }),
      },
    );
    return created.id;
  }

  async #ensureFolder(
    token: string,
    state: State,
    targetPath: string,
  ): Promise<string> {
    const segments = targetPath
      .split("/")
      .map((part) => part.trim())
      .filter(Boolean);
    let path = "";
    let parentId: string | null = null;
    for (const segment of segments) {
      path = path ? `${path}/${segment}` : segment;
      let id: string | undefined = state.folderIdsByPath.get(path);
      if (!id) {
        const createdFolder: { id: string } = await api<{ id: string }>(
          this.fetchPort,
          token,
          parentId
            ? `/me/mailFolders/${encodeURIComponent(parentId)}/childFolders`
            : "/me/mailFolders",
          { method: "POST", body: JSON.stringify({ displayName: segment }) },
        );
        id = createdFolder.id;
        state.folderIdsByPath.set(path, id);
        state.folderPathsById.set(id, path);
      }
      parentId = id;
    }
    if (!parentId) throw new Error("outlook_folder_path_invalid");
    return parentId;
  }

  async #delete(token: string, id: string): Promise<void> {
    await api<null>(
      this.fetchPort,
      token,
      `/me/mailFolders/inbox/messageRules/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
  }
}
