import { useEffect, useRef, useState } from "react";
import type { MailAccountSummary } from "../shared/contracts/accounts";
import type { OrganizationProposal } from "../shared/contracts/organization";
import type { JobProgress } from "../core/jobs/job-types";
import { withParentFolders } from "../core/classification/folder-paths";

export function FolderSetupPanel({
  account,
  proposal,
  onReady,
  onContinue,
}: {
  account: MailAccountSummary;
  proposal: OrganizationProposal;
  onReady: () => void;
  onContinue: () => void;
}) {
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const ready = useRef(onReady);
  ready.current = onReady;
  const input = {
    provider: account.provider,
    connectionId: account.id,
    proposalId: proposal.id,
    revision: proposal.revision,
  };
  const groups = new Map<string, Set<string>>();
  for (const item of proposal.items.filter(
    (item) =>
      item.enabled &&
      item.scopeAddress &&
      !["INBOX", "SPAM", "TRASH"].includes(item.targetPath.toUpperCase()),
  )) {
    const key =
      proposal.groups?.find((g) => g.addresses.includes(item.scopeAddress!))
        ?.name ??
      item.containerName ??
      "Main";
    groups.set(
      key,
      new Set(withParentFolders([...(groups.get(key) ?? []), item.targetPath])),
    );
  }
  const paths = [
    ...new Set([...groups.values()].flatMap((group) => [...group])),
  ];
  useEffect(() => {
    let canceled = false;
    setConsent(false);
    setProgress(null);
    setError("");
    const read = async () => {
      try {
        const value = await window.emailOrganizer.getOrganizationFolders(input);
        if (!canceled) {
          setProgress(value);
          if (value?.state === "succeeded") {
            ready.current();
            clearInterval(timer);
          }
        }
      } catch {
        if (!canceled)
          setError("Rebuild the folder proposal before creating folders.");
      }
    };
    void read();
    const timer = setInterval(() => void read(), 2000);
    return () => {
      canceled = true;
      clearInterval(timer);
    };
  }, [account.id, proposal.id, proposal.revision]);
  const running =
    progress?.state === "pending" || progress?.state === "running";
  const start = async () => {
    setBusy(true);
    setError("");
    try {
      setProgress(await window.emailOrganizer.createOrganizationFolders(input));
    } catch {
      setError(
        "Could not start folder creation. Finish any active mail job, then retry. Existing mail and filters were not changed.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="readiness-panel folder-setup"
      aria-labelledby={`folder-setup-${account.id}`}
    >
      <div className="panel-header">
        <div>
          <p className="eyebrow">
            {account.provider} · {account.label}
          </p>
          <h2 id={`folder-setup-${account.id}`}>Create the selected folders</h2>
        </div>
      </div>
      <div className="handling-content">
        <p>
          Reuse matching folders and create missing ones. This step does not
          move messages, change read status, delete folders, or install filters.
          Existing mail is reviewed separately in Rules, after Spam.
        </p>
        {[...groups].map(([name, targets]) => (
          <section className="folder-setup-group" key={name}>
            <h3>
              <span
                className="group-color-dot"
                data-color={
                  proposal.groups?.find((g) => g.name === name)?.color ?? "blue"
                }
              />
              {name}
            </h3>
            <ul>
              {[...targets].sort().map((path) => (
                <li key={path}>{path}</li>
              ))}
            </ul>
          </section>
        ))}
        {!paths.length ? (
          <p>No custom folders are needed for these choices.</p>
        ) : null}
        <p>
          {account.provider === "gmail"
            ? "Apply each group's color to these Gmail labels and their parent labels, including matching labels that already exist."
            : account.provider === "proton"
              ? "Colors shown here are the planned group colors. Set folder colors in Proton Mail; Bridge cannot apply them."
              : "Group colors are shown in Sift only. Set any Outlook color categories in Outlook; folder colors are not changed by this step."}
        </p>
        <label className="handling-consent">
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
            disabled={
              running ||
              busy ||
              proposal.requiresRebuild ||
              progress?.state === "succeeded"
            }
          />
          <span>
            Create or reuse these {paths.length} folders
            {account.provider === "gmail"
              ? " and apply the selected group colors"
              : ""}
            . Do not move or delete any mail.
          </span>
        </label>
        <div className="handling-actions">
          <button
            className="primary-button compact"
            disabled={!consent || running || busy || proposal.requiresRebuild}
            onClick={() => void start()}
          >
            {running
              ? "Creating and checking folders…"
              : busy
                ? "Starting…"
                : progress?.state === "succeeded"
                  ? "Folders verified"
                  : "Create or reuse selected folders"}
          </button>
          {progress?.state === "succeeded" ? (
            <button className="secondary-button" onClick={onContinue}>
              Continue to Spam
            </button>
          ) : null}
        </div>
        {progress ? (
          <p role="status">
            {progress.counts.succeeded} of {progress.totalItems} folders
            verified
            {progress.counts.failed
              ? `. ${progress.counts.failed} not completed. Retry checks existing folders and creates only missing ones.`
              : ""}
          </p>
        ) : null}
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
