import type { JobRepository } from "../jobs/job-repository";
import type { OutlookConnectionRepository } from "./outlook-connection-repository";
import type { OutlookHistoryRepository } from "./outlook-history-repository";
import { refreshOutlookAccessToken, type OutlookFetch } from "./outlook-oauth";

interface GraphMessageState {
  id: string;
  parentFolderId: string;
  isRead: boolean;
}
interface Folder {
  id: string;
  displayName: string;
  parentFolderId?: string;
}
interface FolderState {
  idsByPath: Map<string, string>;
  trashId: string;
  junkId: string;
}
const GRAPH = "https://graph.microsoft.com/v1.0";
const api = async <T>(
  fetchPort: OutlookFetch,
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<T> => {
  const response = await fetchPort(`${GRAPH}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      prefer: 'IdType="ImmutableId"',
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) throw new Error(`outlook_api_${response.status}`);
  return (response.status === 204 ? null : await response.json()) as T;
};

export class OutlookHistoryRunner {
  constructor(
    readonly connections: OutlookConnectionRepository,
    readonly plans: OutlookHistoryRepository,
    readonly jobs: JobRepository,
    readonly fetchPort: OutlookFetch = fetch,
  ) {}

  async run(
    jobId: string,
    onProgress?: (plan: ReturnType<OutlookHistoryRepository["sync"]>) => void,
  ) {
    const planId = this.plans.planIdForJob(jobId);
    const tokens = new Map<string, string>();
    const folders = new Map<string, FolderState>();
    for (;;) {
      const item = this.jobs.claimNextPending(jobId);
      if (!item) break;
      const action = this.plans.action(item.itemKey);
      this.plans.mark(action.id, "running");
      try {
        const token = await this.#token(action.connectionId, tokens);
        const folderState = await this.#folders(
          token,
          action.connectionId,
          folders,
        );
        const destination = action.trash
          ? folderState.trashId
          : action.spam
            ? folderState.junkId
            : await this.#ensureFolder(token, folderState, action.targetFolder);
        const desiredRead = action.markRead ? true : action.priorIsRead;
        let current = await this.#read(token, action.graphMessageId);
        if (current.parentFolderId !== destination) {
          if (current.parentFolderId !== action.priorFolderId)
            throw new Error("provider_verification_mismatch");
          if (current.isRead !== desiredRead)
            await api<GraphMessageState>(
              this.fetchPort,
              token,
              `/me/messages/${encodeURIComponent(action.graphMessageId)}`,
              {
                method: "PATCH",
                body: JSON.stringify({ isRead: desiredRead }),
              },
            );
          await api<GraphMessageState>(
            this.fetchPort,
            token,
            `/me/messages/${encodeURIComponent(action.graphMessageId)}/move`,
            {
              method: "POST",
              body: JSON.stringify({ destinationId: destination }),
            },
          );
          current = await this.#read(token, action.graphMessageId);
        } else if (current.isRead !== desiredRead) {
          await api<GraphMessageState>(
            this.fetchPort,
            token,
            `/me/messages/${encodeURIComponent(action.graphMessageId)}`,
            { method: "PATCH", body: JSON.stringify({ isRead: desiredRead }) },
          );
          current = await this.#read(token, action.graphMessageId);
        }
        if (
          current.parentFolderId !== destination ||
          current.isRead !== desiredRead
        )
          throw new Error("provider_verification_mismatch");
        this.plans.syncIndexed(
          action.connectionId,
          action.graphMessageId,
          current.parentFolderId,
          current.isRead,
        );
        this.plans.mark(action.id, "succeeded", null, {
          folderId: current.parentFolderId,
          isRead: current.isRead,
        });
        this.jobs.transitionItem(item.id, "succeeded", {
          result: { operation: "outlook-history-message", verified: true },
        });
      } catch (error) {
        const code =
          error instanceof Error ? error.message : "outlook_history_failed";
        const state =
          code === "provider_verification_mismatch"
            ? "verification_mismatch"
            : "failed";
        this.plans.mark(action.id, state, code);
        this.jobs.transitionItem(item.id, state, { errorCode: code });
      }
      onProgress?.(this.plans.sync(planId));
    }
    return this.plans.sync(planId);
  }

  async undo(
    jobId: string,
    onProgress?: (plan: ReturnType<OutlookHistoryRepository["sync"]>) => void,
  ) {
    const planId = this.plans.planIdForJob(jobId);
    const tokens = new Map<string, string>();
    for (;;) {
      const item = this.jobs.claimNextPending(jobId);
      if (!item) break;
      const action = this.plans.action(item.itemKey.replace(/^undo:/, ""));
      this.plans.markUndo(action.id, "running");
      try {
        if (!action.resultingFolderId || action.resultingIsRead === null)
          throw new Error("outlook_history_undo_receipt_missing");
        const token = await this.#token(action.connectionId, tokens);
        let current = await this.#read(token, action.graphMessageId);
        if (
          current.parentFolderId !== action.resultingFolderId ||
          current.isRead !== action.resultingIsRead
        )
          throw new Error("provider_verification_mismatch");
        if (current.parentFolderId !== action.priorFolderId)
          await api<GraphMessageState>(
            this.fetchPort,
            token,
            `/me/messages/${encodeURIComponent(action.graphMessageId)}/move`,
            {
              method: "POST",
              body: JSON.stringify({ destinationId: action.priorFolderId }),
            },
          );
        current = await this.#read(token, action.graphMessageId);
        if (current.isRead !== action.priorIsRead)
          await api<GraphMessageState>(
            this.fetchPort,
            token,
            `/me/messages/${encodeURIComponent(action.graphMessageId)}`,
            {
              method: "PATCH",
              body: JSON.stringify({ isRead: action.priorIsRead }),
            },
          );
        current = await this.#read(token, action.graphMessageId);
        if (
          current.parentFolderId !== action.priorFolderId ||
          current.isRead !== action.priorIsRead
        )
          throw new Error("provider_verification_mismatch");
        this.plans.syncIndexed(
          action.connectionId,
          action.graphMessageId,
          current.parentFolderId,
          current.isRead,
        );
        this.plans.markUndo(action.id, "succeeded");
        this.jobs.transitionItem(item.id, "succeeded", {
          result: { operation: "outlook-history-message", verified: true },
        });
      } catch (error) {
        const code =
          error instanceof Error
            ? error.message
            : "outlook_history_undo_failed";
        const state =
          code === "provider_verification_mismatch"
            ? "verification_mismatch"
            : "failed";
        this.plans.markUndo(action.id, state, code);
        this.jobs.transitionItem(item.id, state, { errorCode: code });
      }
      onProgress?.(this.plans.sync(planId));
    }
    return this.plans.sync(planId);
  }

  async #token(
    connectionId: string,
    cache: Map<string, string>,
  ): Promise<string> {
    const found = cache.get(connectionId);
    if (found) return found;
    const value = this.connections.credentials(connectionId);
    if (!value) throw new Error("outlook_not_connected");
    const token = await refreshOutlookAccessToken(
      value.connection.clientId,
      value.connection.tenant,
      value.refreshToken,
      this.fetchPort,
    );
    cache.set(connectionId, token);
    return token;
  }
  async #read(token: string, id: string): Promise<GraphMessageState> {
    return api<GraphMessageState>(
      this.fetchPort,
      token,
      `/me/messages/${encodeURIComponent(id)}?$select=id,parentFolderId,isRead`,
    );
  }
  async #folders(
    token: string,
    connectionId: string,
    cache: Map<string, FolderState>,
  ): Promise<FolderState> {
    const found = cache.get(connectionId);
    if (found) return found;
    const top = await api<{ value?: Folder[] }>(
      this.fetchPort,
      token,
      "/me/mailFolders?$top=100&includeHiddenFolders=true&$select=id,displayName,parentFolderId",
    );
    const all = [...(top.value ?? [])];
    for (let index = 0; index < all.length && index < 500; index += 1) {
      const page = await api<{ value?: Folder[] }>(
        this.fetchPort,
        token,
        `/me/mailFolders/${encodeURIComponent(all[index]!.id)}/childFolders?$top=100&includeHiddenFolders=true&$select=id,displayName,parentFolderId`,
      );
      all.push(
        ...(page.value ?? []).filter(
          (item) => !all.some((existing) => existing.id === item.id),
        ),
      );
    }
    const byId = new Map(all.map((folder) => [folder.id, folder]));
    const idsByPath = new Map<string, string>();
    for (const folder of all) {
      const parts = [folder.displayName];
      let parent = folder.parentFolderId
        ? byId.get(folder.parentFolderId)
        : undefined;
      while (parent) {
        parts.unshift(parent.displayName);
        parent = parent.parentFolderId
          ? byId.get(parent.parentFolderId)
          : undefined;
      }
      idsByPath.set(parts.join("/"), folder.id);
    }
    const trashId =
      all.find((folder) =>
        ["deleted items", "trash"].includes(folder.displayName.toLowerCase()),
      )?.id ?? "deleteditems";
    const junkId =
      all.find((folder) =>
        ["junk email", "junk"].includes(folder.displayName.toLowerCase()),
      )?.id ?? "junkemail";
    const value = { idsByPath, trashId, junkId };
    cache.set(connectionId, value);
    return value;
  }
  async #ensureFolder(
    token: string,
    state: FolderState,
    targetPath: string,
  ): Promise<string> {
    let parentId: string | null = null;
    let path = "";
    for (const segment of targetPath
      .split("/")
      .map((value) => value.trim())
      .filter(Boolean)) {
      path = path ? `${path}/${segment}` : segment;
      let id = state.idsByPath.get(path);
      if (!id) {
        const created: { id: string } = await api<{ id: string }>(
          this.fetchPort,
          token,
          parentId
            ? `/me/mailFolders/${encodeURIComponent(parentId)}/childFolders`
            : "/me/mailFolders",
          { method: "POST", body: JSON.stringify({ displayName: segment }) },
        );
        id = created.id;
        state.idsByPath.set(path, id);
      }
      parentId = id;
    }
    if (!parentId) throw new Error("outlook_folder_path_invalid");
    return parentId;
  }
}
