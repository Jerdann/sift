import type BetterSqlite3 from "better-sqlite3";
import type { AccountProvider } from "../../shared/contracts/accounts";

export interface ApprovedSpamSelection {
  reviewId: string;
  analysisId: string;
  keys: ReadonlySet<string>;
}

export const spamSelectionKey = (
  senderDomain: string,
  receivingAddress: string,
): string =>
  `${senderDomain.trim().toLowerCase()}\0${receivingAddress.trim().toLowerCase()}`;

export const approvedSpamSelection = (
  database: BetterSqlite3.Database,
  profileId: string,
  provider: AccountProvider,
  connectionId: string,
  analysisId: string,
): ApprovedSpamSelection => {
  const review = database
    .prepare(
      `SELECT id,analysis_id FROM spam_reviews
       WHERE profile_id=? AND provider=? AND connection_id=? AND state='completed'
       ORDER BY created_at DESC,rowid DESC LIMIT 1`,
    )
    .get(profileId, provider, connectionId) as
    | { id: string; analysis_id: string }
    | undefined;
  if (!review || review.analysis_id !== analysisId)
    throw new Error("spam_review_required");
  const rows = database
    .prepare(
      `SELECT sender_domain,receiving_address FROM spam_review_candidates
       WHERE review_id=? AND decision='spam'`,
    )
    .all(review.id) as Array<{
    sender_domain: string;
    receiving_address: string;
  }>;
  return {
    reviewId: review.id,
    analysisId: review.analysis_id,
    keys: new Set(
      rows.map((row) =>
        spamSelectionKey(row.sender_domain, row.receiving_address),
      ),
    ),
  };
};

export const spamApplicationComplete = (
  database: BetterSqlite3.Database,
  provider: AccountProvider,
  connectionId: string,
  reviewId: string,
): boolean => {
  const planTable =
    provider === "gmail"
      ? "gmail_organization_plans"
      : provider === "outlook"
        ? "outlook_history_plans"
        : "cleanup_plans";
  const actionTable =
    provider === "gmail"
      ? "gmail_history_batches"
      : provider === "outlook"
        ? "outlook_history_actions"
        : "cleanup_actions";
  const row = database
    .prepare(
      `SELECT plan.id,plan.state,
              (SELECT COUNT(*) FROM ${actionTable} action WHERE action.plan_id=plan.id) action_count
       FROM ${planTable} plan
       WHERE plan.connection_id=? AND plan.plan_kind='spam' AND plan.spam_review_id=?
       ORDER BY plan.rowid DESC LIMIT 1`,
    )
    .get(connectionId, reviewId) as
    | { id: string; state: string; action_count: number }
    | undefined;
  return Boolean(row && (row.state === "completed" || row.action_count === 0));
};
