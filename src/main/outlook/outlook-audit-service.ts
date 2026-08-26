import type BetterSqlite3 from "better-sqlite3";
import { randomUUID } from "node:crypto";
import {
  outlookAuditSummarySchema,
  type OutlookAuditSummary,
} from "../../shared/contracts/outlook";
import { refreshOutlookAccessToken, type OutlookFetch } from "./outlook-oauth";
import type { OutlookConnectionRepository } from "./outlook-connection-repository";

interface Address {
  emailAddress?: { address?: string };
}
interface GraphMessage {
  id: string;
  conversationId?: string;
  receivedDateTime?: string;
  subject?: string;
  from?: Address;
  toRecipients?: Address[];
  ccRecipients?: Address[];
  bccRecipients?: Address[];
  internetMessageHeaders?: Array<{ name: string; value: string }>;
  categories?: string[];
  parentFolderId: string;
  isRead: boolean;
}
interface Page {
  value?: GraphMessage[];
  "@odata.nextLink"?: string;
  "@odata.count"?: number;
}

const GRAPH_ORIGIN = "https://graph.microsoft.com";
const address = (item: Address | undefined): string | undefined =>
  item?.emailAddress?.address?.toLowerCase();
const graphUrl = (value: string): string => {
  const url = new URL(value);
  if (url.origin !== GRAPH_ORIGIN)
    throw new Error("outlook_untrusted_next_link");
  return url.toString();
};

export class OutlookAuditService {
  readonly #database: BetterSqlite3.Database;
  readonly #connections: OutlookConnectionRepository;
  readonly #fetch: OutlookFetch;
  readonly #now: () => string;
  readonly #createId: () => string;

  constructor(
    database: BetterSqlite3.Database,
    connections: OutlookConnectionRepository,
    options: {
      fetchPort?: OutlookFetch;
      now?: () => string;
      createId?: () => string;
    } = {},
  ) {
    this.#database = database;
    this.#connections = connections;
    this.#fetch = options.fetchPort ?? fetch;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#createId = options.createId ?? randomUUID;
  }

  get(treatScanningAsPaused = true): OutlookAuditSummary | null {
    const connection = this.#connections.get();
    if (!connection) return null;
    const row = this.#database
      .prepare("SELECT * FROM outlook_audit_state WHERE connection_id=?")
      .get(connection.id) as Record<string, unknown> | undefined;
    if (!row)
      return outlookAuditSummarySchema.parse({
        connectionId: connection.id,
        state: "idle",
        indexedMessages: 0,
        totalEstimate: 0,
        earliestAt: null,
        latestAt: null,
        updatedAt: connection.connectedAt,
      });
    return outlookAuditSummarySchema.parse({
      connectionId: connection.id,
      state:
        treatScanningAsPaused && row.state === "scanning"
          ? "paused"
          : row.state,
      indexedMessages: row.indexed_messages,
      totalEstimate: row.total_estimate,
      earliestAt: row.earliest_at,
      latestAt: row.latest_at,
      updatedAt: row.updated_at,
    });
  }

  async run(
    onProgress: (summary: OutlookAuditSummary) => void = () => undefined,
  ): Promise<OutlookAuditSummary> {
    const credentials = this.#connections.credentials();
    if (!credentials) throw new Error("outlook_not_connected");
    const connectionId = credentials.connection.id;
    const existing = this.#database
      .prepare(
        "SELECT state,next_link FROM outlook_audit_state WHERE connection_id=?",
      )
      .get(connectionId) as
      | { state: string; next_link: string | null }
      | undefined;
    if (!existing || existing.state === "completed") {
      this.#database.transaction(() => {
        this.#database
          .prepare("DELETE FROM outlook_indexed_messages WHERE connection_id=?")
          .run(connectionId);
        this.#database
          .prepare(
            `INSERT INTO outlook_audit_state(connection_id,state,next_link,indexed_messages,total_estimate,earliest_at,latest_at,updated_at) VALUES (?,'idle',NULL,0,0,NULL,NULL,?) ON CONFLICT(connection_id) DO UPDATE SET state='idle',next_link=NULL,indexed_messages=0,total_estimate=0,earliest_at=NULL,latest_at=NULL,updated_at=excluded.updated_at`,
          )
          .run(connectionId, this.#now());
      })();
    }
    this.#database
      .prepare(
        "UPDATE outlook_audit_state SET state='scanning',updated_at=? WHERE connection_id=?",
      )
      .run(this.#now(), connectionId);
    let next = (
      this.#database
        .prepare(
          "SELECT next_link FROM outlook_audit_state WHERE connection_id=?",
        )
        .get(connectionId) as { next_link: string | null }
    ).next_link;
    try {
      const token = await refreshOutlookAccessToken(
        credentials.connection.clientId,
        credentials.connection.tenant,
        credentials.refreshToken,
        this.#fetch,
      );
      await this.#storeFolderIds(connectionId, token);
      do {
        const url = graphUrl(
          next ??
            `${GRAPH_ORIGIN}/v1.0/me/messages?$top=100&$count=true&$select=id,conversationId,receivedDateTime,subject,from,toRecipients,ccRecipients,bccRecipients,internetMessageHeaders,categories,parentFolderId,isRead`,
        );
        const response = await this.#fetch(url, {
          headers: {
            authorization: `Bearer ${token}`,
            "consistency-level": "eventual",
            prefer: 'IdType="ImmutableId"',
          },
        });
        if (!response.ok) throw new Error(`outlook_list_${response.status}`);
        const page = (await response.json()) as Page;
        this.#store(connectionId, page.value ?? []);
        next = page["@odata.nextLink"]
          ? graphUrl(page["@odata.nextLink"])
          : null;
        const count = (
          this.#database
            .prepare(
              "SELECT COUNT(*) count FROM outlook_indexed_messages WHERE connection_id=?",
            )
            .get(connectionId) as { count: number }
        ).count;
        this.#database
          .prepare(
            `UPDATE outlook_audit_state SET next_link=?,indexed_messages=?,total_estimate=?,earliest_at=(SELECT MIN(received_at) FROM outlook_indexed_messages WHERE connection_id=?),latest_at=(SELECT MAX(received_at) FROM outlook_indexed_messages WHERE connection_id=?),updated_at=? WHERE connection_id=?`,
          )
          .run(
            next,
            count,
            Math.max(count, page["@odata.count"] ?? 0),
            connectionId,
            connectionId,
            this.#now(),
            connectionId,
          );
        onProgress(this.get(false)!);
      } while (next);
      this.#database
        .prepare(
          "UPDATE outlook_audit_state SET state='completed',updated_at=? WHERE connection_id=?",
        )
        .run(this.#now(), connectionId);
      return this.get()!;
    } catch (error) {
      this.#database
        .prepare(
          "UPDATE outlook_audit_state SET state='failed',updated_at=? WHERE connection_id=?",
        )
        .run(this.#now(), connectionId);
      throw error;
    }
  }

  async #storeFolderIds(connectionId: string, token: string): Promise<void> {
    const names = [
      "inbox",
      "sentitems",
      "deleteditems",
      "junkemail",
      "archive",
    ] as const;
    const results = await Promise.all(
      names.map(async (name) => {
        const response = await this.#fetch(
          `${GRAPH_ORIGIN}/v1.0/me/mailFolders/${name}?$select=id`,
          {
            headers: {
              authorization: `Bearer ${token}`,
              prefer: 'IdType="ImmutableId"',
            },
          },
        );
        if (!response.ok && name === "archive") return null;
        if (!response.ok)
          throw new Error(`outlook_folder_${name}_${response.status}`);
        return ((await response.json()) as { id: string }).id;
      }),
    );
    this.#database
      .prepare(
        `INSERT INTO outlook_folder_ids(connection_id,inbox_id,sent_items_id,deleted_items_id,junk_email_id,archive_id,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(connection_id) DO UPDATE SET inbox_id=excluded.inbox_id,sent_items_id=excluded.sent_items_id,deleted_items_id=excluded.deleted_items_id,junk_email_id=excluded.junk_email_id,archive_id=excluded.archive_id,updated_at=excluded.updated_at`,
      )
      .run(
        connectionId,
        results[0],
        results[1],
        results[2],
        results[3],
        results[4],
        this.#now(),
      );
  }

  #store(connectionId: string, messages: GraphMessage[]): void {
    const insert = this.#database.prepare(
      `INSERT INTO outlook_indexed_messages(id,connection_id,graph_message_id,conversation_id,received_at,subject,sender_json,recipients_json,headers_json,categories_json,parent_folder_id,is_read,size_bytes,indexed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,?) ON CONFLICT(connection_id,graph_message_id) DO UPDATE SET conversation_id=excluded.conversation_id,received_at=excluded.received_at,subject=excluded.subject,sender_json=excluded.sender_json,recipients_json=excluded.recipients_json,headers_json=excluded.headers_json,categories_json=excluded.categories_json,parent_folder_id=excluded.parent_folder_id,is_read=excluded.is_read,indexed_at=excluded.indexed_at`,
    );
    const now = this.#now();
    this.#database.transaction(() => {
      for (const message of messages) {
        const sender = address(message.from);
        const recipients = [
          ...(message.toRecipients ?? []),
          ...(message.ccRecipients ?? []),
          ...(message.bccRecipients ?? []),
        ]
          .map(address)
          .filter((value): value is string => Boolean(value));
        const headers = Object.fromEntries(
          (message.internetMessageHeaders ?? []).map((header) => [
            header.name.toLowerCase(),
            header.value,
          ]),
        );
        insert.run(
          this.#createId(),
          connectionId,
          message.id,
          message.conversationId ?? null,
          message.receivedDateTime ?? null,
          message.subject ?? null,
          JSON.stringify(sender ? [sender] : []),
          JSON.stringify([...new Set(recipients)]),
          JSON.stringify(headers),
          JSON.stringify(message.categories ?? []),
          message.parentFolderId,
          message.isRead ? 1 : 0,
          now,
        );
      }
    })();
  }
}
