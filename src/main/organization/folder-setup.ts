import type BetterSqlite3 from "better-sqlite3";
import { createHash } from "node:crypto";
import type { CreateOrganizationFolders } from "../../shared/contracts/organization";
import { OrganizationProposalRepository } from "./organization-proposal-repository";
import { MailHandlingRepository } from "../settings/mail-handling-repository";
import { handlingFor } from "../../core/classification/mail-handling";
import { JobRepository } from "../jobs/job-repository";
import { GROUP_COLORS } from "../../shared/contracts/address-groups";
import { withParentFolders } from "../../core/classification/folder-paths";

const active = new Set<string>();
export class FolderSetup {
  readonly jobs: JobRepository;
  constructor(
    readonly db: BetterSqlite3.Database,
    readonly profileId: string,
  ) {
    this.jobs = new JobRepository(db);
  }
  private plan(input: CreateOrganizationFolders) {
    const proposal = new OrganizationProposalRepository(
      this.db,
      this.profileId,
    ).get(input.provider, input.connectionId);
    if (
      !proposal ||
      proposal.requiresRebuild ||
      proposal.id !== input.proposalId ||
      proposal.revision !== input.revision
    )
      throw new Error("organization_proposal_changed");
    const handling = new MailHandlingRepository(this.db, this.profileId);
    const paths = [
      ...new Set(
        proposal.items
          .filter(
            (item) =>
              item.enabled &&
              item.scopeAddress &&
              handlingFor(
                handling.resolve(
                  input.provider,
                  input.connectionId,
                  item.scopeAddress,
                  item.handlingRuleId,
                ),
                item.category,
              ).destination === "file",
          )
          .map((item) => item.targetPath),
      ),
    ].sort();
    if (
      paths.some(
        (path) =>
          /[\0\r\n\\]/.test(path) ||
          path
            .split("/")
            .some((part) => !part.trim() || [".", ".."].includes(part)),
      )
    )
      throw new Error("folder_path_invalid");
    const colors = new Map<string, string>();
    for (const item of proposal.items.filter(
      (i) => i.enabled && paths.includes(i.targetPath),
    )) {
      const group = proposal.groups?.find((g) =>
        g.addresses.includes(item.scopeAddress!),
      );
      if (group) {
        const parts = item.targetPath.split("/");
        for (let n = 1; n <= parts.length; n++) {
          const path = parts.slice(0, n).join("/");
          if (
            colors.has(path) &&
            colors.get(path) !== GROUP_COLORS[group.color].hex
          )
            throw new Error("group_color_conflict");
          colors.set(path, GROUP_COLORS[group.color].hex);
        }
      }
    }
    const key = `folder-setup:${proposal.id}:${proposal.revision}:${handling.revision(input.provider, input.connectionId)}`;
    return { paths: withParentFolders(paths), key, colors };
  }
  get(input: CreateOrganizationFolders) {
    const { key } = this.plan(input);
    const row = this.db
      .prepare("SELECT id FROM jobs WHERE profile_id=? AND idempotency_key=?")
      .get(this.profileId, key) as { id: string } | undefined;
    return row ? this.jobs.getProgress(row.id) : null;
  }
  start(
    input: CreateOrganizationFolders,
    prepare: () => Promise<{
      ensure(path: string, color?: string): Promise<void>;
      close(): Promise<void>;
    }>,
  ) {
    const { paths, key, colors } = this.plan(input);
    if (active.has(key)) return this.get(input)!;
    if (
      this.db
        .prepare(
          "SELECT 1 FROM jobs WHERE profile_id=? AND state IN ('pending','running') AND idempotency_key<>? LIMIT 1",
        )
        .get(this.profileId, key)
    )
      throw new Error("mail_job_running");
    const byKey = new Map(
      paths.map((path) => [
        createHash("sha256").update(path).digest("hex"),
        path,
      ]),
    );
    const job = this.jobs.createJob({
      profileId: this.profileId,
      kind: "folder-setup",
      idempotencyKey: key,
      itemKeys: [...byKey.keys()],
    });
    if (!paths.length) {
      this.db
        .prepare("UPDATE jobs SET state='succeeded',finished_at=? WHERE id=?")
        .run(new Date().toISOString(), job.id);
      return this.jobs.getProgress(job.id);
    }
    if (job.state === "succeeded") return this.jobs.getProgress(job.id);
    const failed = this.db
      .prepare(
        "SELECT item_key FROM job_items WHERE job_id=? AND state IN ('failed','verification_mismatch')",
      )
      .all(job.id) as Array<{ item_key: string }>;
    if (failed.length)
      this.jobs.retryItems(
        job.id,
        failed.map((row) => row.item_key),
      );
    this.jobs.requeueRunning(job.id, "folder_setup_interrupted");
    active.add(key);
    void (async () => {
      let client: Awaited<ReturnType<typeof prepare>> | undefined;
      try {
        client = await prepare();
        for (;;) {
          const item = this.jobs.claimNextPending(job.id);
          if (!item) break;
          try {
            const path = byKey.get(item.itemKey)!;
            await client.ensure(
              path,
              input.provider === "gmail" ? colors.get(path) : undefined,
            );
            this.jobs.transitionItem(item.id, "succeeded", {
              result: { operation: "provider-rule-action", verified: true },
            });
          } catch {
            this.jobs.transitionItem(item.id, "failed", {
              errorCode: "folder_creation_failed",
            });
            break;
          }
        }
      } catch {
        const item = this.jobs.claimNextPending(job.id);
        if (item)
          this.jobs.transitionItem(item.id, "failed", {
            errorCode: "folder_connection_failed",
          });
      } finally {
        // A failed request is terminal for this attempt. Retry reuses verified folders.
        for (;;) {
          const item = this.jobs.claimNextPending(job.id);
          if (!item) break;
          this.jobs.transitionItem(item.id, "failed", {
            errorCode: "folder_setup_stopped",
          });
        }
        await client?.close().catch(() => undefined);
        active.delete(key);
      }
    })();
    return this.jobs.getProgress(job.id);
  }
}
