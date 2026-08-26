import type BetterSqlite3 from "better-sqlite3";
import { randomUUID } from "node:crypto";
import {
  CATEGORY_PRESENTATION,
  CLASSIFIER_VERSION,
  classifyMessage,
} from "../../core/classification/mail-classifier";
import {
  mailboxAnalysisSummarySchema,
  type MailCategory,
  type MailboxAnalysisSummary,
} from "../../shared/contracts/analysis";
import type { OutlookConnectionSummary } from "../../shared/contracts/outlook";
import { AccountIdentityRepository } from "../identity/account-identity-repository";
import { outlookIdentityEvidence } from "../identity/ownership-evidence";

interface MessageRow {
  id: string;
  received_at: string | null;
  subject: string | null;
  sender_json: string;
  recipients_json: string;
  headers_json: string;
  parent_folder_id: string;
}
interface Stream {
  senderDomain: string;
  category: MailCategory;
  receivingAddress: string;
  messageCount: number;
  latestAt: string | null;
  confidence: number;
  evidence: string[];
}
const strings = (value: string): string[] => JSON.parse(value) as string[];

export class OutlookAnalysisService {
  readonly #database: BetterSqlite3.Database;
  readonly #profileId: string;
  readonly #now: () => string;
  readonly #createId: () => string;

  constructor(
    database: BetterSqlite3.Database,
    profileId: string,
    options: { now?: () => string; createId?: () => string } = {},
  ) {
    this.#database = database;
    this.#profileId = profileId;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#createId = options.createId ?? randomUUID;
  }

  analyze(connection: OutlookConnectionSummary): MailboxAnalysisSummary {
    const rows = this.#database
      .prepare(
        "SELECT * FROM outlook_indexed_messages WHERE connection_id=? ORDER BY received_at DESC",
      )
      .all(connection.id) as MessageRow[];
    if (!rows.length) throw new Error("outlook_audit_required");
    const folder = this.#database
      .prepare(
        "SELECT sent_items_id FROM outlook_folder_ids WHERE connection_id=?",
      )
      .get(connection.id) as { sent_items_id: string } | undefined;
    if (!folder) throw new Error("outlook_folder_audit_required");
    const identities = new AccountIdentityRepository(
      this.#database,
      this.#profileId,
    );
    const current = identities.list("outlook", connection.id);
    if (!current.length)
      identities.sync(
        "outlook",
        connection.id,
        outlookIdentityEvidence(
          this.#database,
          connection.id,
          connection.email,
        ),
      );
    const owned = new Set(
      identities
        .list("outlook", connection.id)
        .filter((item) => item.status === "confirmed")
        .map((item) => item.address),
    );
    if (!owned.size) throw new Error("confirmed_address_required");
    const classified = rows
      .filter((row) => row.parent_folder_id !== folder.sent_items_id)
      .map((row) => ({
        row,
        result: classifyMessage({
          subject: row.subject,
          bodyText: null,
          senders: strings(row.sender_json),
          recipients: strings(row.recipients_json),
          headers: JSON.parse(row.headers_json) as Record<string, string>,
        }),
      }));
    const streams = new Map<string, Stream>();
    for (const item of classified) {
      const matched = item.result.receivingAddresses.filter((address) =>
        owned.has(address),
      );
      for (const receivingAddress of matched.length ? matched : ["unknown"]) {
        const key = `${item.result.senderDomain}\0${item.result.category}\0${receivingAddress}`;
        const stream = streams.get(key) ?? {
          senderDomain: item.result.senderDomain,
          category: item.result.category,
          receivingAddress,
          messageCount: 0,
          latestAt: null,
          confidence: 0,
          evidence: [],
        };
        stream.confidence =
          (stream.confidence * stream.messageCount + item.result.confidence) /
          (stream.messageCount + 1);
        stream.messageCount += 1;
        if (
          item.row.received_at &&
          (!stream.latestAt || item.row.received_at > stream.latestAt)
        )
          stream.latestAt = item.row.received_at;
        stream.evidence = [
          ...new Set([...stream.evidence, ...item.result.evidence]),
        ].slice(0, 5);
        streams.set(key, stream);
      }
    }
    const analysisId = this.#createId();
    const analyzedAt = this.#now();
    this.#database.transaction(() => {
      this.#database
        .prepare("DELETE FROM outlook_mailbox_analyses WHERE connection_id=?")
        .run(connection.id);
      this.#database
        .prepare(
          "INSERT INTO outlook_mailbox_analyses(id,connection_id,profile_id,classifier_version,analyzed_at) VALUES (?,?,?,?,?)",
        )
        .run(
          analysisId,
          connection.id,
          this.#profileId,
          CLASSIFIER_VERSION,
          analyzedAt,
        );
      const addClassification = this.#database.prepare(
        "INSERT INTO outlook_message_classifications(analysis_id,message_row_id,category,confidence,evidence_json,sender_domain,receiving_addresses_json) VALUES (?,?,?,?,?,?,?)",
      );
      for (const item of classified)
        addClassification.run(
          analysisId,
          item.row.id,
          item.result.category,
          item.result.confidence,
          JSON.stringify(item.result.evidence),
          item.result.senderDomain,
          JSON.stringify(
            item.result.receivingAddresses.filter((address) =>
              owned.has(address),
            ),
          ),
        );
      const addStream = this.#database.prepare(
        "INSERT INTO outlook_analysis_streams(id,analysis_id,sender_domain,category,receiving_address,message_count,latest_at,confidence,evidence_json) VALUES (?,?,?,?,?,?,?,?,?)",
      );
      for (const stream of streams.values())
        addStream.run(
          this.#createId(),
          analysisId,
          stream.senderDomain,
          stream.category,
          stream.receivingAddress,
          stream.messageCount,
          stream.latestAt,
          stream.confidence,
          JSON.stringify(stream.evidence),
        );
    })();
    return this.get(connection)!;
  }

  get(connection: OutlookConnectionSummary): MailboxAnalysisSummary | null {
    const analysis = this.#database
      .prepare(
        "SELECT id,classifier_version,analyzed_at FROM outlook_mailbox_analyses WHERE connection_id=? AND profile_id=?",
      )
      .get(connection.id, this.#profileId) as
      | { id: string; classifier_version: string; analyzed_at: string }
      | undefined;
    if (!analysis) return null;
    const categories = this.#database
      .prepare(
        "SELECT category,COUNT(*) message_count,AVG(confidence) average_confidence FROM outlook_message_classifications WHERE analysis_id=? GROUP BY category ORDER BY message_count DESC",
      )
      .all(analysis.id) as Array<{
      category: MailCategory;
      message_count: number;
      average_confidence: number;
    }>;
    const streamRows = this.#database
      .prepare(
        "SELECT * FROM outlook_analysis_streams WHERE analysis_id=? ORDER BY message_count DESC,sender_domain",
      )
      .all(analysis.id) as Array<{
      sender_domain: string;
      category: MailCategory;
      receiving_address: string;
      message_count: number;
      latest_at: string | null;
      confidence: number;
      evidence_json: string;
    }>;
    const identities = new AccountIdentityRepository(
      this.#database,
      this.#profileId,
    )
      .list("outlook", connection.id)
      .filter((identity) => identity.status === "confirmed");
    const safeStreams = streamRows.filter((stream) =>
      identities.some(
        (identity) => identity.address === stream.receiving_address,
      ),
    );
    const addresses = identities
      .map((identity) => {
        const addressStreams = safeStreams.filter(
          (stream) => stream.receiving_address === identity.address,
        );
        const messageCount = addressStreams.reduce(
          (sum, stream) => sum + stream.message_count,
          0,
        );
        const importantCount = addressStreams
          .filter((stream) =>
            ["security", "accounts", "transactions", "finance"].includes(
              stream.category,
            ),
          )
          .reduce((sum, stream) => sum + stream.message_count, 0);
        const services = new Map<
          string,
          {
            messageCount: number;
            latestAt: string | null;
            categories: Set<MailCategory>;
          }
        >();
        for (const stream of addressStreams) {
          if (stream.sender_domain === "unknown-sender") continue;
          const value = services.get(stream.sender_domain) ?? {
            messageCount: 0,
            latestAt: null,
            categories: new Set<MailCategory>(),
          };
          value.messageCount += stream.message_count;
          if (
            stream.latest_at &&
            (!value.latestAt || stream.latest_at > value.latestAt)
          )
            value.latestAt = stream.latest_at;
          value.categories.add(stream.category);
          services.set(stream.sender_domain, value);
        }
        return {
          address: identity.address,
          ownershipEvidence: identity.providerEvidence
            ? ("provider_account" as const)
            : identity.sentFromCount && identity.deliveredToCount
              ? ("sent_and_received" as const)
              : identity.sentFromCount
                ? ("sent" as const)
                : ("received" as const),
          canRetire: identity.sentFromCount > 0,
          sentFromCount: identity.sentFromCount,
          deliveredToCount: identity.deliveredToCount,
          evidence: identity.evidence,
          status: identity.status,
          containerEnabled: identity.containerEnabled,
          containerName: identity.containerName,
          recommendation: importantCount
            ? ("retain" as const)
            : ("watch" as const),
          messageCount,
          latestAt:
            addressStreams
              .map((stream) => stream.latest_at)
              .filter((value): value is string => Boolean(value))
              .sort()
              .at(-1) ?? null,
          importantCount,
          services: [...services.entries()]
            .sort((left, right) => right[1].messageCount - left[1].messageCount)
            .slice(0, 100)
            .map(([domain, value]) => ({
              domain,
              messageCount: value.messageCount,
              latestAt: value.latestAt,
              categories: [...value.categories],
            })),
          rationale: importantCount
            ? `${importantCount} account, security, transaction, or finance messages make this address important.`
            : "Recent activity exists, but important account evidence was not found.",
        };
      })
      .sort(
        (left, right) =>
          right.messageCount - left.messageCount ||
          left.address.localeCompare(right.address),
      );
    return mailboxAnalysisSummarySchema.parse({
      connectionId: connection.id,
      analyzedAt: analysis.analyzed_at,
      classifierVersion: analysis.classifier_version,
      uniqueMessages: categories.reduce(
        (sum, item) => sum + item.message_count,
        0,
      ),
      categories: categories.map((item) => ({
        category: item.category,
        label: CATEGORY_PRESENTATION[item.category].label,
        proposedFolder: CATEGORY_PRESENTATION[item.category].folder,
        messageCount: item.message_count,
        streamCount: safeStreams.filter(
          (stream) => stream.category === item.category,
        ).length,
        averageConfidence: item.average_confidence,
      })),
      topStreams: safeStreams.map((stream) => ({
        senderDomain: stream.sender_domain,
        category: stream.category,
        receivingAddress: stream.receiving_address,
        messageCount: stream.message_count,
        latestAt: stream.latest_at,
        confidence: stream.confidence,
        evidence: JSON.parse(stream.evidence_json) as string[],
      })),
      addresses,
    });
  }
}
