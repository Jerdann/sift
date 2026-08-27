import type BetterSqlite3 from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import type { AccountProvider } from "../../shared/contracts/accounts";
import type { MailCategory } from "../../shared/contracts/analysis";
import {
  spamReviewSchema,
  type CompleteSpamReview,
  type SpamReview,
  type SpamReviewDecision,
} from "../../shared/contracts/spam-review";

interface StreamRow {
  sender_domain: string;
  category: MailCategory;
  receiving_address: string;
  message_count: number;
  latest_at: string | null;
  confidence: number;
  evidence_json: string;
}

interface CandidateAggregate {
  senderDomain: string;
  receivingAddress: string;
  streams: StreamRow[];
}

const safeStrings = (value: string): string[] => {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
};

export class SpamReviewRepository {
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

  getCurrent(
    provider: AccountProvider,
    connectionId: string,
  ): SpamReview | null {
    this.#assertConnection(provider, connectionId);
    const source = this.#streams(provider, connectionId);
    if (!source) return null;
    const latest = this.#latestReview(provider, connectionId);
    return latest?.analysisId === source.analysisId ? latest : null;
  }

  #latestReview(
    provider: AccountProvider,
    connectionId: string,
  ): SpamReview | null {
    const row = this.#database
      .prepare(
        `SELECT id FROM spam_reviews
         WHERE profile_id=? AND provider=? AND connection_id=?
         ORDER BY created_at DESC,rowid DESC LIMIT 1`,
      )
      .get(this.#profileId, provider, connectionId) as
      | { id: string }
      | undefined;
    return row ? this.get(row.id) : null;
  }

  generate(provider: AccountProvider, connectionId: string): SpamReview {
    this.#assertConnection(provider, connectionId);
    const source = this.#streams(provider, connectionId);
    if (!source) throw new Error("mailbox_analysis_required");

    const groups = new Map<string, CandidateAggregate>();
    for (const stream of source.streams) {
      if (
        stream.sender_domain === "unknown-sender" ||
        stream.receiving_address === "unknown"
      )
        continue;
      const key = `${stream.sender_domain.toLowerCase()}\0${stream.receiving_address.toLowerCase()}`;
      const current = groups.get(key) ?? {
        senderDomain: stream.sender_domain.toLowerCase(),
        receivingAddress: stream.receiving_address.toLowerCase(),
        streams: [],
      };
      current.streams.push(stream);
      groups.set(key, current);
    }

    const previous = this.#latestReview(provider, connectionId);
    const previousDecisions = new Map(
      (previous?.candidates ?? []).map((candidate) => [
        `${candidate.senderDomain}\0${candidate.receivingAddress}`,
        candidate.decision,
      ]),
    );
    const candidates = [...groups.values()].flatMap((group) => {
      const ordered = [...group.streams].sort(
        (left, right) =>
          right.message_count - left.message_count ||
          left.category.localeCompare(right.category),
      );
      const dominant = ordered[0]!;
      const total = ordered.reduce((sum, item) => sum + item.message_count, 0);
      const share = dominant.message_count / total;
      const bulk = ["subscriptions", "promotions"].includes(dominant.category);
      if (
        !["spam", "suspicious"].includes(dominant.category) &&
        !(bulk && dominant.message_count >= 25)
      )
        return [];
      const reason =
        dominant.category === "spam"
          ? ("likely_spam" as const)
          : dominant.category === "suspicious"
            ? ("suspicious" as const)
            : ("bulk_mail" as const);
      const key = `${group.senderDomain}\0${group.receivingAddress}`;
      return [
        {
          id: this.#createId(),
          senderDomain: group.senderDomain,
          receivingAddress: group.receivingAddress,
          category: dominant.category,
          messageCount: total,
          latestAt:
            ordered
              .map((item) => item.latest_at)
              .filter((value): value is string => Boolean(value))
              .sort()
              .at(-1) ?? null,
          confidence: dominant.confidence,
          categoryShare: share,
          evidence: [
            ...new Set(ordered.flatMap((item) => safeStrings(item.evidence_json))),
          ].slice(0, 8),
          reason,
          decision: previousDecisions.get(key) ?? ("review" as const),
        },
      ];
    });
    candidates.sort(
      (left, right) =>
        (left.reason === "likely_spam" ? 0 : left.reason === "suspicious" ? 1 : 2) -
          (right.reason === "likely_spam" ? 0 : right.reason === "suspicious" ? 1 : 2) ||
        right.messageCount - left.messageCount ||
        left.senderDomain.localeCompare(right.senderDomain),
    );

    const revision = createHash("sha256")
      .update(
        JSON.stringify(
          candidates.map((candidate) => [
            candidate.senderDomain,
            candidate.receivingAddress,
            candidate.category,
            candidate.messageCount,
            candidate.latestAt,
            candidate.confidence,
            candidate.categoryShare,
          ]),
        ),
      )
      .digest("hex");
    const id = this.#createId();
    const now = this.#now();
    this.#database.transaction(() => {
      this.#database
        .prepare(
          `INSERT INTO spam_reviews(
             id,profile_id,provider,connection_id,analysis_id,revision,state,created_at
           ) VALUES (?,?,?,?,?,?,'draft',?)`,
        )
        .run(id, this.#profileId, provider, connectionId, source.analysisId, revision, now);
      const insert = this.#database.prepare(
        `INSERT INTO spam_review_candidates(
           id,review_id,sender_domain,receiving_address,category,message_count,
           latest_at,confidence,category_share,evidence_json,reason,decision
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,'review')`,
      );
      const updateDecision = this.#database.prepare(
        "UPDATE spam_review_candidates SET decision=? WHERE id=?",
      );
      for (const candidate of candidates) {
        insert.run(
          candidate.id,
          id,
          candidate.senderDomain,
          candidate.receivingAddress,
          candidate.category,
          candidate.messageCount,
          candidate.latestAt,
          candidate.confidence,
          candidate.categoryShare,
          JSON.stringify(candidate.evidence),
          candidate.reason,
        );
        if (candidate.decision !== "review")
          updateDecision.run(candidate.decision, candidate.id);
      }
    })();
    return this.get(id);
  }

  complete(input: CompleteSpamReview): SpamReview {
    const review = this.get(input.reviewId);
    if (review.state !== "draft" || review.revision !== input.revision)
      throw new Error("spam_review_changed");
    const byId = new Map(review.candidates.map((candidate) => [candidate.id, candidate]));
    if (
      input.decisions.length !== new Set(input.decisions.map((item) => item.candidateId)).size ||
      input.decisions.some((item) => !byId.has(item.candidateId))
    )
      throw new Error("spam_review_candidate_not_found");
    const now = this.#now();
    this.#database.transaction(() => {
      const update = this.#database.prepare(
        "UPDATE spam_review_candidates SET decision=? WHERE id=? AND review_id=?",
      );
      for (const decision of input.decisions)
        update.run(decision.decision, decision.candidateId, input.reviewId);
      this.#database
        .prepare(
          "UPDATE spam_reviews SET state='completed',completed_at=? WHERE id=?",
        )
        .run(now, input.reviewId);
    })();
    return this.get(input.reviewId);
  }

  decisions(
    provider: AccountProvider,
    connectionId: string,
  ): Map<string, SpamReviewDecision> {
    const review = this.getCurrent(provider, connectionId);
    if (!review || review.state !== "completed")
      throw new Error("spam_review_required");
    return new Map(
      review.candidates.map((candidate) => [
        `${candidate.senderDomain}\0${candidate.receivingAddress}`,
        candidate.decision,
      ]),
    );
  }

  get(reviewId: string): SpamReview {
    const review = this.#database
      .prepare("SELECT * FROM spam_reviews WHERE id=? AND profile_id=?")
      .get(reviewId, this.#profileId) as Record<string, unknown> | undefined;
    if (!review) throw new Error("spam_review_not_found");
    const candidates = this.#database
      .prepare(
        `SELECT * FROM spam_review_candidates
         WHERE review_id=?
         ORDER BY CASE reason WHEN 'likely_spam' THEN 0 WHEN 'suspicious' THEN 1 ELSE 2 END,
                  message_count DESC,sender_domain`,
      )
      .all(reviewId) as Array<Record<string, unknown>>;
    return spamReviewSchema.parse({
      id: review.id,
      provider: review.provider,
      connectionId: review.connection_id,
      analysisId: review.analysis_id,
      revision: review.revision,
      state: review.state,
      createdAt: review.created_at,
      completedAt: review.completed_at,
      candidates: candidates.map((candidate) => ({
        id: candidate.id,
        senderDomain: candidate.sender_domain,
        receivingAddress: candidate.receiving_address,
        category: candidate.category,
        messageCount: candidate.message_count,
        latestAt: candidate.latest_at,
        confidence: candidate.confidence,
        categoryShare: candidate.category_share,
        evidence: safeStrings(String(candidate.evidence_json)),
        reason: candidate.reason,
        decision: candidate.decision,
      })),
    });
  }

  #streams(
    provider: AccountProvider,
    connectionId: string,
  ): { analysisId: string; streams: StreamRow[] } | null {
    const analysisTable =
      provider === "gmail"
        ? "gmail_mailbox_analyses"
        : provider === "outlook"
          ? "outlook_mailbox_analyses"
          : "mailbox_analyses";
    const streamTable =
      provider === "gmail"
        ? "gmail_analysis_streams"
        : provider === "outlook"
          ? "outlook_analysis_streams"
          : "analysis_streams";
    const analysis = this.#database
      .prepare(
        `SELECT id FROM ${analysisTable}
         WHERE profile_id=? AND connection_id=? ORDER BY rowid DESC LIMIT 1`,
      )
      .get(this.#profileId, connectionId) as { id: string } | undefined;
    if (!analysis) return null;
    return {
      analysisId: analysis.id,
      streams: this.#database
        .prepare(
          `SELECT sender_domain,category,receiving_address,message_count,
                  latest_at,confidence,evidence_json
           FROM ${streamTable} WHERE analysis_id=?`,
        )
        .all(analysis.id) as StreamRow[],
    };
  }

  #assertConnection(provider: AccountProvider, connectionId: string): void {
    const table =
      provider === "gmail"
        ? "gmail_connections"
        : provider === "outlook"
          ? "outlook_connections"
          : "provider_connections";
    const row = this.#database
      .prepare(`SELECT 1 ok FROM ${table} WHERE id=? AND profile_id=?`)
      .get(connectionId, this.#profileId) as { ok: number } | undefined;
    if (!row) throw new Error("account_connection_not_found");
  }
}
