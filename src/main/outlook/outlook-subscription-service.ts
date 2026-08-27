import type BetterSqlite3 from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { subscriptionPriorityScore } from "../../core/pruning/subscription-ranking";
import type { MailCategory } from "../../shared/contracts/analysis";
import {
  subscriptionDashboardSchema,
  type SubscriptionDashboard,
} from "../../shared/contracts/unsubscribe";
import type { JobRepository } from "../jobs/job-repository";

interface Row {
  analysis_id: string;
  category: MailCategory;
  sender_domain: string;
  receiving_addresses_json: string;
  subject: string | null;
  received_at: string | null;
  headers_json: string;
  is_read: number;
}
interface Group {
  senderDomain: string;
  listId: string;
  address: string;
  endpoint: string | null;
  oneClick: boolean;
  authenticated: boolean;
  count: number;
  latest: string | null;
  earliest: string | null;
  readCount: number;
  categories: Set<MailCategory>;
  subjects: string[];
}
const endpoint = (value: string | undefined): string | null => {
  if (!value) return null;
  for (const match of value.matchAll(/<([^>]+)>|([^,\s]+)/g)) {
    try {
      const url = new URL((match[1] ?? match[2] ?? "").trim());
      if (url.protocol === "https:" && !url.username && !url.password)
        return url.toString();
    } catch {
      /* ignore malformed */
    }
  }
  return null;
};

export class OutlookSubscriptionService {
  readonly #database: BetterSqlite3.Database;
  readonly #jobs: JobRepository;
  readonly #profileId: string;
  readonly #now: () => string;
  readonly #createId: () => string;
  constructor(
    database: BetterSqlite3.Database,
    jobs: JobRepository,
    profileId: string,
    options: { now?: () => string; createId?: () => string } = {},
  ) {
    this.#database = database;
    this.#jobs = jobs;
    this.#profileId = profileId;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#createId = options.createId ?? randomUUID;
  }
  get profileId(): string {
    return this.#profileId;
  }

  scan(connectionId: string): SubscriptionDashboard {
    const rows = this.#database
      .prepare(
        `SELECT omc.analysis_id,omc.category,omc.sender_domain,omc.receiving_addresses_json,oim.subject,oim.received_at,oim.headers_json,oim.is_read FROM outlook_message_classifications omc JOIN outlook_mailbox_analyses oma ON oma.id=omc.analysis_id JOIN outlook_indexed_messages oim ON oim.id=omc.message_row_id WHERE oma.connection_id=? AND oma.profile_id=?`,
      )
      .all(connectionId, this.#profileId) as Row[];
    if (!rows.length) throw new Error("outlook_analysis_required");
    const analysisId = rows[0]!.analysis_id;
    const active = this.#database
      .prepare(
        "SELECT 1 FROM outlook_subscription_scans oss JOIN outlook_unsubscribe_runs our ON our.scan_id=oss.id JOIN jobs j ON j.id=our.job_id WHERE oss.analysis_id=? AND oss.profile_id=? AND j.state IN ('pending','running') LIMIT 1",
      )
      .get(analysisId, this.#profileId);
    if (active) throw new Error("unsubscribe_run_active");
    const groups = new Map<string, Group>();
    for (const row of rows) {
      const headers = JSON.parse(row.headers_json) as Record<string, string>;
      if (
        !headers["list-id"] &&
        !headers["list-unsubscribe"] &&
        !["subscriptions", "promotions", "spam", "suspicious"].includes(
          row.category,
        )
      )
        continue;
      const listId = (headers["list-id"] ?? row.sender_domain)
        .replace(/[<>]/g, "")
        .trim()
        .toLowerCase()
        .slice(0, 320);
      const addresses = JSON.parse(row.receiving_addresses_json) as string[];
      for (const address of addresses.length ? addresses : ["unknown"]) {
        const key = `${listId}\0${row.sender_domain}\0${address}`;
        const group = groups.get(key) ?? {
          senderDomain: row.sender_domain,
          listId,
          address,
          endpoint: null,
          oneClick: false,
          authenticated: false,
          count: 0,
          latest: null,
          earliest: null,
          readCount: 0,
          categories: new Set<MailCategory>(),
          subjects: [],
        };
        group.count += 1;
        group.categories.add(row.category);
        if (row.is_read) group.readCount += 1;
        if (
          row.received_at &&
          (!group.latest || row.received_at > group.latest)
        )
          group.latest = row.received_at;
        if (
          row.received_at &&
          (!group.earliest || row.received_at < group.earliest)
        )
          group.earliest = row.received_at;
        if (
          row.subject &&
          group.subjects.length < 3 &&
          !group.subjects.includes(row.subject)
        )
          group.subjects.push(row.subject.slice(0, 180));
        group.endpoint ??= endpoint(headers["list-unsubscribe"]);
        group.oneClick ||= /list-unsubscribe\s*=\s*one-click/i.test(
          headers["list-unsubscribe-post"] ?? "",
        );
        const auth = (headers["authentication-results"] ?? "").toLowerCase();
        group.authenticated ||=
          /dkim=pass/.test(auth) && /(?:dmarc|spf)=pass/.test(auth);
        groups.set(key, group);
      }
    }
    const scanId = this.#createId();
    const now = this.#now();
    const protectedCategories = new Set<MailCategory>([
      "security",
      "accounts",
      "transactions",
      "finance",
    ]);
    this.#database.transaction(() => {
      this.#database
        .prepare("DELETE FROM outlook_subscription_scans WHERE analysis_id=?")
        .run(analysisId);
      this.#database
        .prepare(
          "INSERT INTO outlook_subscription_scans(id,analysis_id,profile_id,generated_at) VALUES (?,?,?,?)",
        )
        .run(scanId, analysisId, this.#profileId, now);
      const add = this.#database.prepare(
        "INSERT INTO outlook_subscription_candidates(id,scan_id,sender_domain,list_id,receiving_address,endpoint,eligibility,authenticated,message_count,latest_at,earliest_at,read_count,categories_json,sample_subjects_json,status,reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      );
      for (const group of groups.values()) {
        const categories = [...group.categories].sort();
        let eligibility: "eligible" | "manual" | "protected" | "spam_skipped";
        let status: "pending" | "manual" | "spam_skipped";
        let reason: string;
        if (
          categories.some((item) => item === "spam" || item === "suspicious")
        ) {
          eligibility = "spam_skipped";
          status = "spam_skipped";
          reason =
            "Suspected spam: Sift will not contact this sender. Use a Junk filter instead.";
        } else if (categories.some((item) => protectedCategories.has(item))) {
          eligibility = "protected";
          status = "manual";
          reason =
            "Contains transaction, security, account, or finance messages. Sift will not unsubscribe automatically.";
        } else if (group.endpoint && group.oneClick && group.authenticated) {
          eligibility = "eligible";
          status = "pending";
          reason = "Supports standard one-click unsubscribe.";
        } else {
          eligibility = "manual";
          status = "manual";
          reason = !group.authenticated
            ? "Sift could not confirm the sender, so it will not send an automatic request."
            : "No supported one-click unsubscribe link was found.";
        }
        add.run(
          this.#createId(),
          scanId,
          group.senderDomain,
          group.listId,
          group.address,
          group.endpoint,
          eligibility,
          group.authenticated ? 1 : 0,
          group.count,
          group.latest,
          group.earliest,
          group.readCount,
          JSON.stringify(categories),
          JSON.stringify(group.subjects),
          status,
          reason,
        );
      }
    })();
    return this.getByScan(scanId);
  }

  getCurrent(connectionId: string): SubscriptionDashboard | null {
    const row = this.#database
      .prepare(
        "SELECT oss.id FROM outlook_subscription_scans oss JOIN outlook_mailbox_analyses oma ON oma.id=oss.analysis_id WHERE oma.connection_id=? AND oss.profile_id=? ORDER BY oss.rowid DESC LIMIT 1",
      )
      .get(connectionId, this.#profileId) as { id: string } | undefined;
    return row ? this.getByScan(row.id) : null;
  }
  getByScan(scanId: string): SubscriptionDashboard {
    const scan = this.#database
      .prepare(
        "SELECT * FROM outlook_subscription_scans WHERE id=? AND profile_id=?",
      )
      .get(scanId, this.#profileId) as
      | { analysis_id: string; generated_at: string }
      | undefined;
    if (!scan) throw new Error("outlook_subscription_scan_missing");
    const connection = this.#database
      .prepare(
        "SELECT oma.connection_id FROM outlook_subscription_scans oss JOIN outlook_mailbox_analyses oma ON oma.id=oss.analysis_id WHERE oss.id=?",
      )
      .get(scanId) as { connection_id: string };
    const rows = this.#database
      .prepare("SELECT * FROM outlook_subscription_candidates WHERE scan_id=?")
      .all(scanId) as Array<Record<string, unknown>>;
    const ledgerRows = this.#database
      .prepare(
        "SELECT list_id,receiving_address,requested_at FROM unsubscribe_ledger WHERE profile_id=? AND provider='outlook' AND connection_id=?",
      )
      .all(this.#profileId, connection.connection_id) as Array<{
      list_id: string;
      receiving_address: string;
      requested_at: string;
    }>;
    const ledger = new Map(
      ledgerRows.map((row) => [
        `${row.list_id}\0${row.receiving_address}`,
        row,
      ]),
    );
    const jobRow = this.#database
      .prepare(
        "SELECT job_id FROM outlook_unsubscribe_runs WHERE scan_id=? ORDER BY rowid DESC LIMIT 1",
      )
      .get(scanId) as { job_id: string } | undefined;
    return subscriptionDashboardSchema.parse({
      analysisId: scan.analysis_id,
      generatedAt: scan.generated_at,
      candidates: rows
        .map((row) => {
          const categories = JSON.parse(
            String(row.categories_json),
          ) as MailCategory[];
          const prior = ledger.get(`${row.list_id}\0${row.receiving_address}`);
          const recurrence = prior
            ? row.latest_at && String(row.latest_at) > prior.requested_at
              ? "recurring"
              : "quiet"
            : "never_requested";
          const spanDays =
            row.earliest_at && row.latest_at
              ? Math.max(
                  30,
                  (Date.parse(String(row.latest_at)) -
                    Date.parse(String(row.earliest_at))) /
                    86_400_000,
                )
              : 30;
          const rate = Number(row.message_count) / (spanDays / 30);
          const readRate = Number(row.read_count) / Number(row.message_count);
          return {
            id: String(row.id),
            senderDomain: String(row.sender_domain),
            listId: String(row.list_id),
            receivingAddress: String(row.receiving_address),
            eligibility: row.eligibility,
            authenticated: Boolean(row.authenticated),
            messageCount: Number(row.message_count),
            latestAt: row.latest_at ? String(row.latest_at) : null,
            messagesPerMonth: rate,
            readRate,
            priorityScore: subscriptionPriorityScore(
              Number(row.message_count),
              row.latest_at ? String(row.latest_at) : null,
              categories,
              rate,
              readRate,
            ),
            requestedAt: prior?.requested_at ?? null,
            recurrence,
            categories,
            sampleSubjects: JSON.parse(String(row.sample_subjects_json)),
            status: row.status,
            reason:
              recurrence === "recurring"
                ? `${row.reason} New mail arrived after the previous unsubscribe request.`
                : row.reason,
          };
        })
        .sort(
          (left, right) =>
            right.priorityScore - left.priorityScore ||
            right.messageCount - left.messageCount,
        ),
      job: jobRow ? this.#jobs.getProgress(jobRow.job_id) : null,
    });
  }
  start(ids: readonly string[]): SubscriptionDashboard {
    if (!ids.length) throw new Error("unsubscribe_selection_invalid");
    const slots = ids.map(() => "?").join(",");
    const rows = this.#database
      .prepare(
        `SELECT osc.id,osc.scan_id FROM outlook_subscription_candidates osc JOIN outlook_subscription_scans oss ON oss.id=osc.scan_id WHERE osc.id IN (${slots}) AND osc.eligibility='eligible' AND oss.profile_id=?`,
      )
      .all(...ids, this.#profileId) as Array<{ id: string; scan_id: string }>;
    if (
      rows.length !== ids.length ||
      new Set(rows.map((row) => row.scan_id)).size !== 1
    )
      throw new Error("unsubscribe_selection_invalid");
    const scanId = rows[0]!.scan_id;
    const job = this.#jobs.createJob({
      profileId: this.#profileId,
      kind: "bulk-unsubscribe",
      idempotencyKey: `outlook-unsubscribe:${scanId}:${[...ids].sort().join(",")}`,
      itemKeys: rows.map((row) => row.id),
    });
    this.#database
      .prepare(
        "INSERT OR IGNORE INTO outlook_unsubscribe_runs(job_id,scan_id,created_at) VALUES (?,?,?)",
      )
      .run(job.id, scanId, this.#now());
    return this.getByScan(scanId);
  }
  action(id: string): {
    id: string;
    endpoint: string;
    eligibility: "eligible";
  } {
    const row = this.#database
      .prepare(
        "SELECT osc.id,osc.endpoint,osc.eligibility FROM outlook_subscription_candidates osc JOIN outlook_subscription_scans oss ON oss.id=osc.scan_id WHERE osc.id=? AND oss.profile_id=?",
      )
      .get(id, this.#profileId) as
      | { id: string; endpoint: string | null; eligibility: string }
      | undefined;
    if (!row || row.eligibility !== "eligible" || !row.endpoint)
      throw new Error("unsubscribe_candidate_ineligible");
    return { id: row.id, endpoint: row.endpoint, eligibility: "eligible" };
  }
  mark(id: string, status: "unsubscribed" | "failed"): void {
    this.#database.transaction(() => {
      this.#database
        .prepare(
          "UPDATE outlook_subscription_candidates SET status=? WHERE id=?",
        )
        .run(status, id);
      if (status !== "unsubscribed") return;
      const row = this.#database
        .prepare(
          "SELECT osc.list_id,osc.receiving_address,osc.latest_at,oma.connection_id FROM outlook_subscription_candidates osc JOIN outlook_subscription_scans oss ON oss.id=osc.scan_id JOIN outlook_mailbox_analyses oma ON oma.id=oss.analysis_id WHERE osc.id=? AND oss.profile_id=?",
        )
        .get(id, this.#profileId) as
        | {
            list_id: string;
            receiving_address: string;
            latest_at: string | null;
            connection_id: string;
          }
        | undefined;
      if (!row) throw new Error("unsubscribe_candidate_missing");
      this.#database
        .prepare(
          "INSERT INTO unsubscribe_ledger(id,profile_id,provider,connection_id,list_id,receiving_address,requested_at,latest_seen_at_request,updated_at) VALUES (?,?,'outlook',?,?,?,?,?,?) ON CONFLICT(profile_id,provider,connection_id,list_id,receiving_address) DO UPDATE SET recurrence_count=unsubscribe_ledger.recurrence_count+CASE WHEN excluded.latest_seen_at_request>unsubscribe_ledger.requested_at THEN 1 ELSE 0 END,requested_at=excluded.requested_at,latest_seen_at_request=excluded.latest_seen_at_request,updated_at=excluded.updated_at",
        )
        .run(
          this.#createId(),
          this.#profileId,
          row.connection_id,
          row.list_id,
          row.receiving_address,
          this.#now(),
          row.latest_at,
          this.#now(),
        );
    })();
  }
  retry(jobId: string, ids: readonly string[]): SubscriptionDashboard {
    const scanId = this.scanIdForJob(jobId);
    this.#jobs.retryItems(jobId, ids);
    const slots = ids.map(() => "?").join(",");
    this.#database
      .prepare(
        `UPDATE outlook_subscription_candidates SET status='pending' WHERE scan_id=? AND id IN (${slots})`,
      )
      .run(scanId, ...ids);
    return this.getByScan(scanId);
  }
  scanIdForJob(jobId: string): string {
    const row = this.#database
      .prepare("SELECT scan_id FROM outlook_unsubscribe_runs WHERE job_id=?")
      .get(jobId) as { scan_id: string } | undefined;
    if (!row) throw new Error("unsubscribe_run_missing");
    return row.scan_id;
  }
}
