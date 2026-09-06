import type { RuleInventory } from "../../shared/contracts/rule-management";
import type { RuleReconciliationRepository } from "../rules/rule-reconciliation-repository";
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
const api = async <T>(
  fetchPort: OutlookFetch,
  token: string,
  path: string,
): Promise<T> => {
  const response = await fetchPort(`https://graph.microsoft.com/v1.0${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`outlook_api_${response.status}`);
  return (await response.json()) as T;
};

export class OutlookRuleInventoryService {
  constructor(
    readonly connections: OutlookConnectionRepository,
    readonly rules: RuleReconciliationRepository,
    readonly fetchPort: OutlookFetch = fetch,
  ) {}

  async refresh(connectionId: string): Promise<RuleInventory> {
    const credentials = this.connections.credentials(connectionId);
    if (!credentials) throw new Error("outlook_not_connected");
    const token = await refreshOutlookAccessToken(
      credentials.connection.clientId,
      credentials.connection.tenant,
      credentials.refreshToken,
      this.fetchPort,
    );
    const folders = await readGraphFolders(this.fetchPort, token);
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    const folderNames = new Map(
      folders.map((folder) => {
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
        return [folder.id, segments.join("/")] as const;
      }),
    );
    const inboxId =
      folders.find((folder) => folder.displayName.toLowerCase() === "inbox")
        ?.id ?? "inbox";
    const junkId =
      folders.find((folder) =>
        ["junk email", "junk"].includes(folder.displayName.toLowerCase()),
      )?.id ?? "junkemail";
    const rules = await readGraphPages<GraphMessageRule>(
      this.fetchPort,
      token,
      "/me/mailFolders/inbox/messageRules",
    );
    return this.rules.saveInventory(
      "outlook",
      connectionId,
      "live_api",
      rules.map((rule) =>
        normalizeOutlookRule(rule, folderNames, { inboxId, junkId }),
      ),
      256,
      [...folderNames.values()],
      Object.fromEntries(folderNames),
    );
  }
}
import { readGraphFolders, readGraphPages } from "./graph-inventory";
