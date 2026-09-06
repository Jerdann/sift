import type BetterSqlite3 from "better-sqlite3";
import type { AccountProvider } from "../../shared/contracts/accounts";
import { CLASSIFIER_VERSION } from "../../core/classification/mail-classifier";
import { MailHandlingRepository } from "./mail-handling-repository";

// Old classification snapshots must never acquire new destructive behavior.
export function assertCurrentClassification(
  db: BetterSqlite3.Database,
  profileId: string,
  provider: AccountProvider,
  connectionId: string,
  proposalId?: string,
): void {
  const table =
    provider === "proton" ? "mailbox_analyses" : `${provider}_mailbox_analyses`;
  const analysis = db
    .prepare(
      `SELECT classifier_version FROM ${table} WHERE profile_id=? AND connection_id=? ORDER BY rowid DESC LIMIT 1`,
    )
    .get(profileId, connectionId) as { classifier_version: string } | undefined;
  if (analysis?.classifier_version !== CLASSIFIER_VERSION)
    throw new Error("classification_changed_rebuild_proposal");
  if (proposalId) {
    const proposal = db
      .prepare(
        "SELECT classifier_version,handling_revision FROM organization_proposals WHERE id=? AND profile_id=? AND provider=? AND connection_id=?",
      )
      .get(proposalId, profileId, provider, connectionId) as
      | { classifier_version: string | null; handling_revision: string | null }
      | undefined;
    if (proposal?.classifier_version !== CLASSIFIER_VERSION)
      throw new Error("classification_changed_rebuild_proposal");
    if (
      proposal.handling_revision !==
      new MailHandlingRepository(db, profileId).revision(provider, connectionId)
    )
      throw new Error("mail_handling_changed_rebuild_plan");
  }
}
