import * as Dialog from "@radix-ui/react-dialog";
import {
  Archive,
  Check,
  ChevronRight,
  CircleDot,
  FolderTree,
  Inbox,
  LockKeyhole,
  ListFilter,
  MailPlus,
  Search,
  ShieldCheck,
  Tags,
  UserRound,
  X,
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import type { ProfileSummary } from "../shared/contracts/profiles";
import type {
  BridgeConnectResult,
  BridgeCredentials,
  BridgeDiagnostic,
  ProtonConnectionSummary,
  ProtonDiscoverySummary,
} from "../shared/contracts/proton";
import type { ProtonAuditProgress } from "../shared/contracts/proton-audit";
import type {
  MailboxAnalysisSummary,
  MailCategory,
} from "../shared/contracts/analysis";
import type { CleanupPlan, CleanupProgress } from "../shared/contracts/cleanup";
import type {
  SubscriptionDashboard,
  UnsubscribeProgress,
} from "../shared/contracts/unsubscribe";
import { buildPortableRulePack } from "../core/rules/rule-pack";
import type {
  GmailAuditSummary,
  GmailConnectionSummary,
} from "../shared/contracts/gmail";
import type { GmailOrganizationPlan } from "../shared/contracts/gmail-organize";
import type {
  AccountIdentitySummary,
  AccountIdentityUpdateInput,
  MailAccountSummary,
} from "../shared/contracts/accounts";
import type {
  EditOrganizationProposal,
  OrganizationProposal,
} from "../shared/contracts/organization";
import type {
  RuleInventory,
  RuleReconciliationPlan,
} from "../shared/contracts/rule-management";
import type {
  OutlookAuditSummary,
  OutlookConnectionSummary,
} from "../shared/contracts/outlook";
import { rankStaleStreams } from "../core/pruning/stale-stream-ranking";

const mailCategoryOptions: MailCategory[] = [
  "personal",
  "security",
  "accounts",
  "transactions",
  "finance",
  "shopping",
  "travel",
  "games",
  "subscriptions",
  "promotions",
  "social",
  "suspicious",
  "spam",
  "other",
];

type PageId =
  | "overview"
  | "accounts"
  | "audit"
  | "addresses"
  | "organize"
  | "rules"
  | "unsubscribe"
  | "delete";
const navItems: ReadonlyArray<{
  id: PageId;
  label: string;
  icon: typeof Inbox;
}> = [
  { id: "overview", label: "Overview", icon: Inbox },
  { id: "accounts", label: "Accounts", icon: MailPlus },
  { id: "audit", label: "Scan", icon: Search },
  { id: "addresses", label: "Addresses", icon: UserRound },
  { id: "organize", label: "Organize", icon: FolderTree },
  { id: "rules", label: "Rules", icon: ListFilter },
  { id: "unsubscribe", label: "Unsubscribe", icon: Tags },
  { id: "delete", label: "Trash review", icon: Archive },
];

const BrandMark = () => (
  <div className="brand-mark" aria-hidden="true">
    <span />
    <span />
    <span />
  </div>
);

interface ProfilePickerProps {
  profiles: ProfileSummary[];
  loadError: string;
  onCreate(profileName: string): Promise<void>;
  onOpen(profile: ProfileSummary): Promise<void>;
}

const ProfilePicker = ({
  profiles,
  loadError,
  onCreate,
  onOpen,
}: ProfilePickerProps) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = profileName.trim();
    if (value.length < 2) {
      setError("Enter at least 2 characters.");
      return;
    }
    setBusy(true);
    try {
      await onCreate(value);
      setDialogOpen(false);
    } catch {
      setError(
        "Sift couldn't create this local profile. Try a different name.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="profile-screen">
      <section className="profile-picker" aria-labelledby="product-name">
        <div className="brand-lockup">
          <BrandMark />
          <span>SIFT</span>
        </div>
        <p className="eyebrow">LOCAL MAILBOX OPERATIONS</p>
        <h1 id="product-name">A lighter inbox starts here.</h1>
        <p className="profile-intro">
          Sift finds the accounts, newsletters, receipts, promotions, and noise
          buried in your mailbox—then builds a cleanup plan you control.
        </p>

        <div className="trust-line" aria-label="Local privacy protections">
          <span>
            <LockKeyhole size={16} /> Encrypted locally
          </span>
          <span>
            <ShieldCheck size={16} /> Approval required
          </span>
        </div>

        <div className="picker-divider" />

        <div className="picker-heading">
          <div>
            <h2>Local profiles</h2>
            <p>Profiles keep each person's accounts and plans separate.</p>
          </div>
          <span className="count-label">
            {profiles.length} {profiles.length === 1 ? "PROFILE" : "PROFILES"}
          </span>
        </div>

        {loadError ? (
          <p className="workspace-error" role="alert">
            {loadError}
          </p>
        ) : null}
        {profiles.length === 0 ? (
          <div className="no-profiles">
            <UserRound size={20} />
            <div>
              <strong>No profiles on this computer</strong>
              <span>Create one to start mapping your mail.</span>
            </div>
          </div>
        ) : (
          <div className="profile-list">
            {profiles.map((profile) => (
              <div className="profile-row" key={profile.id}>
                <span className="profile-avatar">
                  {profile.displayName.slice(0, 1).toUpperCase()}
                </span>
                <span className="profile-row-copy">
                  <strong>{profile.displayName}</strong>
                  <small>
                    {profile.providerCount} connected providers ·{" "}
                    {profile.lastOpenedAt
                      ? "Used on this computer"
                      : "Never opened"}
                  </small>
                </span>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => void onOpen(profile)}
                >
                  Open
                </button>
              </div>
            ))}
          </div>
        )}

        <Dialog.Root open={dialogOpen} onOpenChange={setDialogOpen}>
          <Dialog.Trigger asChild>
            <button className="primary-button" type="button">
              Create local profile <ChevronRight size={16} />
            </button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="dialog-overlay" />
            <Dialog.Content
              className="dialog-content"
              aria-describedby="profile-help"
            >
              <div className="dialog-header">
                <div>
                  <Dialog.Title>Create local profile</Dialog.Title>
                  <Dialog.Description id="profile-help">
                    This creates an isolated workspace on this computer.
                  </Dialog.Description>
                </div>
                <Dialog.Close className="icon-button" aria-label="Close dialog">
                  <X size={18} />
                </Dialog.Close>
              </div>
              <form onSubmit={submit} noValidate>
                <label htmlFor="profile-name">Profile name</label>
                <input
                  id="profile-name"
                  autoComplete="off"
                  autoFocus
                  value={profileName}
                  onChange={(event) => {
                    setProfileName(event.target.value);
                    setError("");
                  }}
                  aria-invalid={Boolean(error)}
                  aria-describedby="profile-helper profile-error"
                />
                <p id="profile-helper" className="field-helper">
                  Stored only on this computer. You can add email accounts after
                  opening it.
                </p>
                <p id="profile-error" className="field-error" role="alert">
                  {error}
                </p>
                <div className="dialog-actions">
                  <Dialog.Close asChild>
                    <button className="secondary-button" type="button">
                      Cancel
                    </button>
                  </Dialog.Close>
                  <button
                    className="primary-button compact"
                    type="submit"
                    disabled={busy}
                  >
                    {busy ? "Creating…" : "Create profile"}
                  </button>
                </div>
              </form>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        <p className="picker-footnote">
          A local profile is not an email account. You'll connect Proton Mail or
          Gmail later.
        </p>
      </section>
      <div className="screen-corner-status">
        <CircleDot size={12} /> LOCAL ONLY
      </div>
    </main>
  );
};

interface AppShellProps {
  profileName: string;
  onSwitchProfile(): void;
  accounts: MailAccountSummary[];
  identities: Record<string, AccountIdentitySummary[]>;
  onSelectAccount(account: MailAccountSummary): Promise<void>;
  onRefreshIdentities(account: MailAccountSummary): Promise<void>;
  onUpdateIdentity(input: AccountIdentityUpdateInput): Promise<void>;
  proposals: Record<string, OrganizationProposal | null>;
  onGenerateProposal(account: MailAccountSummary): Promise<void>;
  onEditProposal(input: EditOrganizationProposal): Promise<void>;
  ruleInventories: Record<string, RuleInventory | null>;
  rulePlans: Record<string, RuleReconciliationPlan | null>;
  onRefreshRuleInventory(account: MailAccountSummary): Promise<void>;
  onGenerateRulePlan(account: MailAccountSummary): Promise<void>;
  onApproveRulePlan(plan: RuleReconciliationPlan): Promise<void>;
  onRetryRulePlan(plan: RuleReconciliationPlan): Promise<void>;
  onUndoRulePlan(plan: RuleReconciliationPlan): Promise<void>;
  onExportProtonRulePlan(plan: RuleReconciliationPlan): Promise<string>;
  protonConnection: ProtonConnectionSummary | null;
  protonDiscovery: ProtonDiscoverySummary | null;
  onDiagnoseProton(credentials: BridgeCredentials): Promise<BridgeDiagnostic>;
  onConnectProton(credentials: BridgeCredentials): Promise<BridgeConnectResult>;
  onDisconnectProton(connectionId: string): Promise<void>;
  onDiscoverProton(): Promise<ProtonDiscoverySummary>;
  protonAudit: ProtonAuditProgress | null;
  onStartProtonAudit(extractBodies: boolean): Promise<void>;
  onPauseProtonAudit(jobId: string): Promise<void>;
  onResumeProtonAudit(jobId: string): Promise<void>;
  analysis: MailboxAnalysisSummary | null;
  onAnalyzeMailbox(): Promise<void>;
  cleanupPlan: CleanupPlan | null;
  onGenerateCleanup(containers: Record<string, string>): Promise<void>;
  onApproveCleanup(planId: string, revision: string): Promise<void>;
  onResumeCleanup(planId: string, revision: string): Promise<void>;
  onRetryCleanup(planId: string, actionIds: string[]): Promise<void>;
  onUndoCleanup(planId: string): Promise<void>;
  deletionPlan: CleanupPlan | null;
  onGenerateDeletion(senderDomains: string[]): Promise<void>;
  onApproveDeletion(planId: string, revision: string): Promise<void>;
  onResumeDeletion(planId: string, revision: string): Promise<void>;
  onRetryDeletion(planId: string, actionIds: string[]): Promise<void>;
  onUndoDeletion(planId: string): Promise<void>;
  subscriptions: SubscriptionDashboard | null;
  onScanSubscriptions(): Promise<void>;
  onStartUnsubscribe(candidateIds: string[]): Promise<void>;
  onResumeUnsubscribe(jobId: string): Promise<void>;
  onRetryUnsubscribe(jobId: string, candidateIds: string[]): Promise<void>;
  gmailConnection: GmailConnectionSummary | null;
  onConnectGmail(clientId: string, clientSecret?: string): Promise<void>;
  onDisconnectGmail(connectionId: string): Promise<void>;
  gmailAudit: GmailAuditSummary | null;
  onStartGmailAudit(): Promise<void>;
  gmailAnalysis: MailboxAnalysisSummary | null;
  onAnalyzeGmail(): Promise<void>;
  gmailOrganization: GmailOrganizationPlan | null;
  onGenerateGmailOrganization(): Promise<void>;
  onApproveGmailOrganization(planId: string, revision: string): Promise<void>;
  onRetryGmailOrganization(planId: string, batchIds: string[]): Promise<void>;
  onUndoGmailOrganization(planId: string): Promise<void>;
  gmailDeletion: GmailOrganizationPlan | null;
  onGenerateGmailDeletion(senderDomains: string[]): Promise<void>;
  gmailSubscriptions: SubscriptionDashboard | null;
  onScanGmailSubscriptions(): Promise<void>;
  onStartGmailUnsubscribe(candidateIds: string[]): Promise<void>;
  onResumeGmailUnsubscribe(jobId: string): Promise<void>;
  onRetryGmailUnsubscribe(jobId: string, candidateIds: string[]): Promise<void>;
  outlookConnection: OutlookConnectionSummary | null;
  outlookAudit: OutlookAuditSummary | null;
  outlookAnalysis: MailboxAnalysisSummary | null;
  onConnectOutlook(
    clientId: string,
    tenant: "common" | "consumers" | "organizations",
  ): Promise<void>;
  onDisconnectOutlook(connectionId: string): Promise<void>;
  onStartOutlookAudit(): Promise<void>;
  onAnalyzeOutlook(): Promise<void>;
  outlookOrganization: GmailOrganizationPlan | null;
  outlookDeletion: GmailOrganizationPlan | null;
  onGenerateOutlookOrganization(): Promise<void>;
  onGenerateOutlookDeletion(domains: string[]): Promise<void>;
  onApproveOutlookOrganization(planId: string, revision: string): Promise<void>;
  onRetryOutlookOrganization(
    planId: string,
    actionIds: string[],
  ): Promise<void>;
  onUndoOutlookOrganization(planId: string): Promise<void>;
  outlookSubscriptions: SubscriptionDashboard | null;
  onScanOutlookSubscriptions(): Promise<void>;
  onStartOutlookUnsubscribe(candidateIds: string[]): Promise<void>;
  onResumeOutlookUnsubscribe(jobId: string): Promise<void>;
  onRetryOutlookUnsubscribe(
    jobId: string,
    candidateIds: string[],
  ): Promise<void>;
}

interface ProtonConnectionPanelProps {
  connection: ProtonConnectionSummary | null;
  discovery: ProtonDiscoverySummary | null;
  onDiagnose(credentials: BridgeCredentials): Promise<BridgeDiagnostic>;
  onConnect(credentials: BridgeCredentials): Promise<BridgeConnectResult>;
  onDisconnect(connectionId: string): Promise<void>;
  onDiscover(): Promise<ProtonDiscoverySummary>;
  mode?: "connect" | "audit";
}

const ProtonConnectionPanel = ({
  connection,
  discovery,
  onDiagnose,
  onConnect,
  onDisconnect,
  onDiscover,
  mode = "connect",
}: ProtonConnectionPanelProps) => {
  const [credentials, setCredentials] = useState<BridgeCredentials>({
    host: "127.0.0.1",
    port: 1143,
    username: "",
    password: "",
    security: "starttls",
  });
  const [diagnostic, setDiagnostic] = useState<BridgeDiagnostic | null>(null);
  const [busy, setBusy] = useState<
    "test" | "save" | "disconnect" | "discover" | null
  >(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);

  const update = <Key extends keyof BridgeCredentials>(
    key: Key,
    value: BridgeCredentials[Key],
  ) => {
    setCredentials((current) => ({ ...current, [key]: value }));
    setDiagnostic(null);
    setError("");
  };

  const testConnection = async () => {
    setBusy("test");
    setError("");
    try {
      setDiagnostic(await onDiagnose(credentials));
    } catch {
      setError(
        "Connection diagnostics could not run. No credentials were saved.",
      );
    } finally {
      setBusy(null);
    }
  };

  const saveConnection = async () => {
    setBusy("save");
    setError("");
    try {
      const result = await onConnect(credentials);
      setDiagnostic(result.diagnostic);
      if (result.connection) {
        setCredentials((current) => ({ ...current, password: "" }));
        setAdding(false);
      }
    } catch {
      setError("Sift could not encrypt and save this Bridge connection.");
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    if (!connection) return;
    setBusy("disconnect");
    setError("");
    try {
      await onDisconnect(connection.id);
      setDiagnostic(null);
    } catch {
      setError("The local Bridge credential could not be removed. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const discover = async () => {
    setBusy("discover");
    setError("");
    try {
      await onDiscover();
    } catch {
      setError(
        "The read-only discovery stopped before it finished. Check that Proton Bridge is running, then try again.",
      );
    } finally {
      setBusy(null);
    }
  };

  if (mode === "audit" && !connection) return null;
  if (connection && !adding) {
    return (
      <section
        className="readiness-panel proton-panel"
        aria-labelledby="proton-title"
      >
        <div className="panel-header">
          <div>
            <p className="eyebrow">
              {mode === "audit" ? "PROTON SCAN SOURCE" : "PROTON BRIDGE"}
            </p>
            <h2 id="proton-title">
              {mode === "audit"
                ? "Map the Bridge mailbox"
                : "Connected locally"}
            </h2>
          </div>
          <span className="secured-label">
            <ShieldCheck size={14} /> Credentials encrypted
          </span>
        </div>
        <div className="connection-summary">
          <span className="state-icon safe">
            <Check size={15} />
          </span>
          <span>
            <strong>{connection.username}</strong>
            <small>
              {connection.host}:{connection.port} ·{" "}
              {connection.security.toUpperCase()} · Combined-address audit ready
            </small>
          </span>
          <b>{connection.state === "connected" ? "READY" : "ATTENTION"}</b>
        </div>
        <div className="panel-action connection-actions">
          {mode === "audit" ? (
            <button
              className="primary-button"
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void discover()}
            >
              {busy === "discover"
                ? "Mapping mailbox…"
                : discovery
                  ? "Refresh mailbox map"
                  : "Map folders and delivery addresses"}
            </button>
          ) : null}
          {mode === "connect" ? (
            <button
              className="secondary-button"
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void disconnect()}
            >
              {busy === "disconnect"
                ? "Disconnecting…"
                : "Remove local credential"}
            </button>
          ) : null}
          {mode === "connect" ? (
            <button
              className="secondary-button"
              type="button"
              disabled={Boolean(busy)}
              onClick={() => setAdding(true)}
            >
              Add another Proton account
            </button>
          ) : null}
          {error ? (
            <p className="field-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        {mode === "audit" && discovery ? (
          <div className="discovery-scope" aria-live="polite">
            <div className="scope-heading">
              <span>
                <Search size={16} />
              </span>
              <div>
                <strong>Read-only scope discovered</strong>
                <small>
                  {new Date(discovery.discoveredAt).toLocaleString()} · zero
                  mailbox changes
                </small>
              </div>
            </div>
            <div className="scope-metrics">
              <div>
                <b>{discovery.mailboxes.length.toLocaleString()}</b>
                <span>folders</span>
              </div>
              <div>
                <b>{discovery.totalMessageEstimate.toLocaleString()}</b>
                <span>folder messages*</span>
              </div>
              <div>
                <b>{discovery.addresses.length.toLocaleString()}</b>
                <span>observed delivery addresses</span>
              </div>
            </div>
            <div className="scope-columns">
              <div>
                <h3>Observed delivery addresses</h3>
                {discovery.addresses.length ? (
                  <ul>
                    {discovery.addresses.slice(0, 8).map((item) => (
                      <li key={item.address}>
                        <span>{item.address}</span>
                        <b>{item.occurrenceCount}</b>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>
                    No delivery addresses found in the bounded header sample.
                  </p>
                )}
              </div>
              <div>
                <h3>Largest folders</h3>
                <ul>
                  {[...discovery.mailboxes]
                    .sort((a, b) => b.messageCount - a.messageCount)
                    .slice(0, 8)
                    .map((item) => (
                      <li key={item.id}>
                        <span>{item.name}</span>
                        <b>{item.messageCount.toLocaleString()}</b>
                      </li>
                    ))}
                </ul>
              </div>
            </div>
            <p className="scope-footnote">
              *Folder totals may overlap when Proton exposes All Mail alongside
              Inbox and Archive.
            </p>
            <p className="scope-footnote">
              Delivery addresses come from message headers, not Proton's
              identity settings. Forwarders, mailing lists, old aliases, To, and
              Cc fields can appear here; confirm ownership before migrating or
              retiring one.
            </p>
            <p className="scope-footnote">
              Bridge exposes folders and messages over IMAP, but not Proton's
              existing server-side filters. Sift can propose new rules and
              export Sieve, but cannot inventory filters Bridge does not expose.
            </p>
          </div>
        ) : null}
      </section>
    );
  }

  const formReady =
    credentials.username.trim().length > 0 &&
    credentials.password.length > 0 &&
    credentials.port > 0;

  return (
    <section
      className="readiness-panel proton-panel"
      aria-labelledby="proton-title"
    >
      <div className="panel-header">
        <div>
          <p className="eyebrow">ACCOUNT CONNECTION</p>
          <h2 id="proton-title">Connect Proton Bridge</h2>
        </div>
        <span className="secured-label">
          <LockKeyhole size={14} /> Bridge credentials only
        </span>
      </div>
      <div className="bridge-notice">
        <ShieldCheck size={18} />
        <p>
          <strong>Do not enter your Proton account password.</strong> Open
          Proton Mail Bridge and copy the IMAP username, password, port, and
          connection security shown there.
        </p>
      </div>
      <form
        className="bridge-form"
        onSubmit={(event) => event.preventDefault()}
      >
        <label>
          <span>Local host</span>
          <input
            value={credentials.host}
            disabled
            aria-label="Bridge local host"
          />
        </label>
        <label>
          <span>IMAP port</span>
          <input
            type="number"
            min={1}
            max={65535}
            value={credentials.port}
            onChange={(event) => update("port", Number(event.target.value))}
          />
        </label>
        <label className="field-wide">
          <span>Bridge IMAP username</span>
          <input
            autoComplete="off"
            value={credentials.username}
            onChange={(event) => update("username", event.target.value)}
          />
        </label>
        <label className="field-wide">
          <span>Bridge IMAP password</span>
          <input
            type="password"
            autoComplete="new-password"
            value={credentials.password}
            onChange={(event) => update("password", event.target.value)}
          />
        </label>
        <label className="field-wide">
          <span>Connection security</span>
          <select
            value={credentials.security}
            onChange={(event) =>
              update(
                "security",
                event.target.value as BridgeCredentials["security"],
              )
            }
          >
            <option value="starttls">STARTTLS (Bridge default)</option>
            <option value="tls">TLS</option>
            <option value="plain">None — loopback only</option>
          </select>
        </label>
      </form>
      {diagnostic ? (
        <div
          className={
            diagnostic.ok
              ? "diagnostic-result success"
              : "diagnostic-result failure"
          }
          role="status"
        >
          {diagnostic.ok ? <Check size={16} /> : <CircleDot size={16} />}
          <span>
            <strong>
              {diagnostic.ok
                ? "Bridge connection verified"
                : "Connection needs attention"}
            </strong>
            <small>{diagnostic.message}</small>
          </span>
        </div>
      ) : null}
      {error ? (
        <p className="connection-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="panel-action connection-actions">
        {connection ? (
          <button
            className="secondary-button"
            type="button"
            disabled={Boolean(busy)}
            onClick={() => setAdding(false)}
          >
            Cancel
          </button>
        ) : null}
        <button
          className="secondary-button"
          type="button"
          disabled={!formReady || Boolean(busy)}
          onClick={() => void testConnection()}
        >
          {busy === "test" ? "Testing…" : "Test connection"}
        </button>
        <button
          className="primary-button"
          type="button"
          disabled={!diagnostic?.ok || Boolean(busy)}
          onClick={() => void saveConnection()}
        >
          {busy === "save" ? "Encrypting…" : "Save encrypted connection"}
        </button>
        <p>
          Testing and saving do not change any message, folder, label, or read
          state.
        </p>
      </div>
    </section>
  );
};

interface ProtonAuditPanelProps {
  discovery: ProtonDiscoverySummary | null;
  audit: ProtonAuditProgress | null;
  onStart(extractBodies: boolean): Promise<void>;
  onPause(jobId: string): Promise<void>;
  onResume(jobId: string): Promise<void>;
}

const ProtonAuditPanel = ({
  discovery,
  audit,
  onStart,
  onPause,
  onResume,
}: ProtonAuditPanelProps) => {
  const [extractBodies, setExtractBodies] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!discovery) return null;

  const running = audit?.job.state === "running";
  const resumable = audit?.job.state === "pending";
  const finished =
    audit &&
    ["succeeded", "failed", "verification_mismatch"].includes(audit.job.state);
  const act = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch {
      setError(
        "The audit could not continue. Proton Bridge may need attention; completed folders are still saved.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="readiness-panel audit-panel"
      aria-labelledby="audit-title"
    >
      <div className="panel-header">
        <div>
          <p className="eyebrow">READ-ONLY INDEX</p>
          <h2 id="audit-title">Audit the mailbox</h2>
        </div>
        <span className="secured-label">
          <ShieldCheck size={14} /> No IMAP mutations
        </span>
      </div>
      {audit ? (
        <div className="audit-progress" aria-live="polite">
          <div className="audit-progress-copy">
            <span>
              <strong>
                {finished
                  ? "Audit pass complete"
                  : running
                    ? `Scanning ${audit.currentFolder ?? "mailbox"}`
                    : "Audit paused safely"}
              </strong>
              <small>
                {audit.indexedMessages.toLocaleString()} indexed ·{" "}
                {audit.failureCount} recoverable failures
                {audit.extractBodies
                  ? " · bounded text enabled"
                  : " · metadata only"}
              </small>
            </span>
            <b>{audit.job.percent}%</b>
          </div>
          <progress max={100} value={audit.job.percent} />
          <div className="audit-range">
            <span>
              Earliest{" "}
              <b>
                {audit.earliestAt
                  ? new Date(audit.earliestAt).toLocaleDateString()
                  : "—"}
              </b>
            </span>
            <span>
              Latest{" "}
              <b>
                {audit.latestAt
                  ? new Date(audit.latestAt).toLocaleDateString()
                  : "—"}
              </b>
            </span>
            <span>
              Folders{" "}
              <b>
                {audit.job.completedItems}/{audit.job.totalItems}
              </b>
            </span>
          </div>
          <div className="folder-progress-list">
            {audit.folders.map((folder) => (
              <div key={folder.path}>
                <span>{folder.path}</span>
                <small>
                  {folder.indexedCount.toLocaleString()} / ~
                  {folder.messageEstimate.toLocaleString()}
                </small>
                <b>{folder.state.toUpperCase()}</b>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="audit-consent">
          <p>
            The audit stores headers, dates, senders, recipients, folder state,
            and UIDs locally. It never marks mail read, moves messages, or
            downloads attachments.
          </p>
          <label>
            <input
              type="checkbox"
              checked={extractBodies}
              onChange={(event) => setExtractBodies(event.target.checked)}
            />
            <span>
              <strong>Allow bounded plain-text evidence</strong>
              <small>
                Optional: up to 32 KB from a non-attachment text part per
                message, processed only on this computer.
              </small>
            </span>
          </label>
        </div>
      )}
      <div className="panel-action connection-actions">
        {!audit || finished ? (
          <button
            className="primary-button"
            type="button"
            disabled={busy}
            onClick={() => void act(() => onStart(extractBodies))}
          >
            {busy
              ? "Starting…"
              : finished
                ? "Run a fresh audit"
                : "Start read-only audit"}
          </button>
        ) : null}
        {running ? (
          <button
            className="secondary-button"
            type="button"
            disabled={busy}
            onClick={() => void act(() => onPause(audit.job.id))}
          >
            Pause after this batch
          </button>
        ) : null}
        {resumable ? (
          <button
            className="primary-button"
            type="button"
            disabled={busy}
            onClick={() => void act(() => onResume(audit.job.id))}
          >
            {busy ? "Resuming…" : "Resume from checkpoint"}
          </button>
        ) : null}
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
};

const AnalysisPanel = ({
  audit,
  analysis,
  onAnalyze,
  provider = "proton",
}: {
  audit: { indexedMessages: number } | null;
  analysis: MailboxAnalysisSummary | null;
  onAnalyze(): Promise<void>;
  provider?: "proton" | "gmail" | "outlook";
}) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [exportStatus, setExportStatus] = useState("");
  if (!audit?.indexedMessages) return null;
  const rulePack = analysis ? buildPortableRulePack(analysis) : null;
  const analyze = async () => {
    setBusy(true);
    setError("");
    try {
      await onAnalyze();
    } catch {
      setError(
        "Analysis could not finish. Your saved audit is unchanged; try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="readiness-panel analysis-panel"
      aria-labelledby={`${provider}-analysis-title`}
    >
      <div className="panel-header">
        <div>
          <p className="eyebrow">
            {provider.toUpperCase()} ORGANIZATION PROPOSAL
          </p>
          <h2 id={`${provider}-analysis-title`}>
            What this mailbox is actually used for
          </h2>
        </div>
        <span className="secured-label">
          <LockKeyhole size={14} /> Classified locally
        </span>
      </div>
      {!analysis ? (
        <div className="analysis-empty">
          <p>
            Turn the saved audit into proposed folders, sender streams, and an
            evidence-based map of which services use each receiving address.
          </p>
          <button
            className="primary-button compact"
            type="button"
            disabled={busy}
            onClick={() => void analyze()}
          >
            {busy ? "Analyzing locally…" : "Build organization proposal"}
          </button>
          {error ? (
            <p className="field-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="analysis-results">
          <div className="analysis-summary-line">
            <span>
              <strong>
                {analysis.uniqueMessages.toLocaleString()} unique messages
                analyzed
              </strong>
              <small>
                {analysis.categories.length} categories ·{" "}
                {analysis.addresses.length} observed delivery addresses ·{" "}
                {analysis.classifierVersion}
              </small>
            </span>
            <button
              className="secondary-button"
              type="button"
              disabled={busy}
              onClick={() => void analyze()}
            >
              {busy ? "Refreshing…" : "Refresh proposal"}
            </button>
          </div>
          <div
            className="proposal-table"
            role="table"
            aria-label="Proposed mailbox folders"
          >
            <div className="proposal-row proposal-head" role="row">
              <span>Category</span>
              <span>Proposed folder</span>
              <span>Messages</span>
              <span>Confidence</span>
            </div>
            {analysis.categories.map((category) => (
              <div className="proposal-row" role="row" key={category.category}>
                <strong>{category.label}</strong>
                <span>{category.proposedFolder}</span>
                <b>{category.messageCount.toLocaleString()}</b>
                <small>{Math.round(category.averageConfidence * 100)}%</small>
              </div>
            ))}
          </div>
          <div className="analysis-columns">
            <div>
              <h3>Largest sender streams</h3>
              <ul>
                {analysis.topStreams.slice(0, 12).map((stream) => (
                  <li
                    key={`${stream.senderDomain}:${stream.category}:${stream.receivingAddress}`}
                  >
                    <span>
                      <strong>{stream.senderDomain}</strong>
                      <small>
                        {stream.category} → {stream.receivingAddress}
                      </small>
                    </span>
                    <b>{stream.messageCount.toLocaleString()}</b>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3>Verified sending identities</h3>
              {analysis.addresses.length ? (
                <ul>
                  {analysis.addresses.slice(0, 15).map((address) => (
                    <li key={address.address}>
                      <span>
                        <strong>{address.address}</strong>
                        <small>
                          {address.services
                            .slice(0, 3)
                            .map((service) => service.domain)
                            .join(", ") || "No linked service evidence yet"}
                        </small>
                      </span>
                      <b className={`recommendation ${address.recommendation}`}>
                        {address.recommendation === "consider_deactivation"
                          ? "review retirement"
                          : address.recommendation.replace("_", " ")}
                      </b>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="analysis-empty-note">
                  No owned identity is proven yet. Sift needs an address in the
                  From field of a message stored in Proton's Sent folder.
                </p>
              )}
            </div>
          </div>
          {rulePack ? (
            <div className="rule-pack-panel">
              <div>
                <span>
                  <strong>
                    {rulePack.rules.length} conservative future rules ready
                  </strong>
                  <small>
                    {rulePack.skippedAmbiguousStreams} ambiguous sender streams
                    omitted automatically
                  </small>
                </span>
                <div>
                  {provider === "proton" ? (
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() =>
                        void window.emailOrganizer
                          .exportRulePack({
                            format: "proton-sieve",
                            source: provider,
                          })
                          .then((result) =>
                            setExportStatus(
                              result.canceled
                                ? ""
                                : `Saved ${result.ruleCount} Proton rules to ${result.path}`,
                            ),
                          )
                          .catch(() =>
                            setExportStatus(
                              "Rule export failed; your mailbox was not changed.",
                            ),
                          )
                      }
                    >
                      Save Proton Sieve
                    </button>
                  ) : null}
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() =>
                      void window.emailOrganizer
                        .exportRulePack({
                          format: "portable-json",
                          source: provider,
                        })
                        .then((result) =>
                          setExportStatus(
                            result.canceled
                              ? ""
                              : `Saved portable rule pack to ${result.path}`,
                          ),
                        )
                        .catch(() =>
                          setExportStatus(
                            "Rule export failed; your mailbox was not changed.",
                          ),
                        )
                    }
                  >
                    Save portable pack
                  </button>
                </div>
              </div>
              {exportStatus ? <p>{exportStatus}</p> : null}
              <small>
                Rules use observed sender domain + receiving address. Personal,
                suspicious, uncertain, and mixed-use streams are excluded;
                security alerts are never marked read.
              </small>
            </div>
          ) : null}
          <p className="analysis-disclosure">
            Sending identities require provider alias evidence or a message
            stored in that provider's Sent folder with the address in its From
            field. Recipients, forwarding participants, and copied addresses can
            never become owned identities.
          </p>
        </div>
      )}
    </section>
  );
};

type OrganizationStage = "senders" | "apply";

const organizationStages: ReadonlyArray<{
  id: OrganizationStage;
  label: string;
}> = [
  { id: "senders", label: "Sender cleanup" },
  { id: "apply", label: "Apply history" },
];

const recency = (latestAt: string | null): { label: string; days: number } => {
  if (!latestAt)
    return { label: "No recent date", days: Number.POSITIVE_INFINITY };
  const days = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(latestAt)) / 86_400_000),
  );
  if (days < 2) return { label: "Today", days };
  if (days < 30) return { label: `${days} days ago`, days };
  if (days < 365) return { label: `${Math.floor(days / 30)} months ago`, days };
  return { label: `${Math.floor(days / 365)} years ago`, days };
};

const ProtonOrganizationFlow = ({
  audit,
  analysis,
  cleanupPlan,
  onAnalyze,
  onGenerateCleanup,
  onApproveCleanup,
  onResumeCleanup,
  onRetryCleanup,
  onUndoCleanup,
  onContinue,
}: {
  audit: ProtonAuditProgress | null;
  analysis: MailboxAnalysisSummary | null;
  cleanupPlan: CleanupPlan | null;
  onAnalyze(): Promise<void>;
  onGenerateCleanup(containers: Record<string, string>): Promise<void>;
  onApproveCleanup(planId: string, revision: string): Promise<void>;
  onResumeCleanup(planId: string, revision: string): Promise<void>;
  onRetryCleanup(planId: string, actionIds: string[]): Promise<void>;
  onUndoCleanup(planId: string): Promise<void>;
  onContinue(): void;
}) => {
  const [stage, setStage] = useState<OrganizationStage>("senders");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [senderLimit, setSenderLimit] = useState(25);

  if (!audit?.indexedMessages) return null;
  const analyze = async () => {
    setBusy(true);
    setError("");
    try {
      await onAnalyze();
      setStage("senders");
    } catch {
      setError(
        "Sift could not rebuild the proposal. The saved scan is still available; try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  if (!analysis) {
    return (
      <section className="readiness-panel organization-flow">
        <div className="panel-header">
          <div>
            <p className="eyebrow">PROTON ORGANIZE</p>
            <h2>Start with the aliases inside this mailbox</h2>
          </div>
          <span className="secured-label">
            <LockKeyhole size={14} /> Local analysis
          </span>
        </div>
        <div className="analysis-empty">
          <p>
            Sift will prove owned aliases first, then build separate category
            and cleanup proposals for each address.
          </p>
          <button
            className="primary-button compact"
            type="button"
            disabled={busy}
            onClick={() => void analyze()}
          >
            {busy ? "Building alias map…" : "Build address-first proposal"}
          </button>
          {error ? <p className="field-error">{error}</p> : null}
        </div>
      </section>
    );
  }

  const stageIndex = organizationStages.findIndex((item) => item.id === stage);
  const senders = [
    ...new Set(analysis.topStreams.map((stream) => stream.senderDomain)),
  ]
    .map((domain) => {
      const streams = analysis.topStreams.filter(
        (stream) => stream.senderDomain === domain,
      );
      const latestAt =
        streams
          .map((stream) => stream.latestAt)
          .filter((value): value is string => Boolean(value))
          .sort()
          .at(-1) ?? null;
      return {
        domain,
        messages: streams.reduce((sum, stream) => sum + stream.messageCount, 0),
        latestAt,
        addresses: [
          ...new Set(streams.map((stream) => stream.receivingAddress)),
        ],
      };
    })
    .sort((left, right) => right.messages - left.messages);
  const containers = Object.fromEntries(
    analysis.addresses
      .filter(
        (identity) =>
          identity.containerEnabled && identity.containerName?.trim(),
      )
      .map((identity) => [identity.address, identity.containerName!.trim()]),
  );

  return (
    <>
      <section
        className="readiness-panel organization-flow"
        aria-labelledby="organization-flow-title"
      >
        <div className="organization-flow-head">
          <div>
            <p className="eyebrow">PROTON ORGANIZATION</p>
            <h2 id="organization-flow-title">Shape one address at a time</h2>
            <p>
              {analysis.uniqueMessages.toLocaleString()} inbound messages ·{" "}
              {analysis.addresses.length} proven aliases ·{" "}
              {analysis.classifierVersion}
            </p>
          </div>
          <button
            className="secondary-button"
            type="button"
            disabled={busy}
            onClick={() => void analyze()}
          >
            {busy ? "Refreshing…" : "Rebuild proposal"}
          </button>
        </div>
        <nav
          className="organization-stages"
          aria-label="Organization proposal stages"
        >
          {organizationStages.map((item, index) => (
            <button
              key={item.id}
              type="button"
              className={
                stage === item.id
                  ? "active"
                  : index < stageIndex
                    ? "complete"
                    : ""
              }
              onClick={() => setStage(item.id)}
            >
              <span>
                {index < stageIndex ? <Check size={13} /> : index + 1}
              </span>
              {item.label}
            </button>
          ))}
        </nav>

        {stage === "senders" ? (
          <div className="organization-stage">
            <div className="stage-intro">
              <span>1</span>
              <div>
                <h3>Catch the largest and stalest sender streams</h3>
                <p>
                  Volume shows the widest net. Last activity separates ongoing
                  noise from abandoned history that is safer to remove in one
                  batch.
                </p>
              </div>
            </div>
            <div className="sender-review">
              <div className="sender-review-head">
                <span>Sender</span>
                <span>Addresses</span>
                <span>Last message</span>
                <span>Suggested next move</span>
                <span>Messages</span>
              </div>
              {senders.slice(0, senderLimit).map((sender) => {
                const age = recency(sender.latestAt);
                const suggestion =
                  age.days > 365
                    ? "Delete old history"
                    : age.days > 180
                      ? "Review for deletion"
                      : sender.messages > 100
                        ? "Filter future mail"
                        : "Keep categorized";
                return (
                  <div key={sender.domain}>
                    <strong>{sender.domain}</strong>
                    <span>
                      {sender.addresses.length === 1
                        ? sender.addresses[0]
                        : `${sender.addresses.length} addresses`}
                    </span>
                    <small>{age.label}</small>
                    <b className={age.days > 180 ? "stale" : ""}>
                      {suggestion}
                    </b>
                    <em>{sender.messages.toLocaleString()}</em>
                  </div>
                );
              })}
            </div>
            {senderLimit < Math.min(senders.length, 100) ? (
              <button
                className="sender-expand"
                type="button"
                onClick={() =>
                  setSenderLimit((current) => Math.min(current + 25, 100))
                }
              >
                Show the next{" "}
                {Math.min(25, Math.min(senders.length, 100) - senderLimit)}{" "}
                senders
              </button>
            ) : null}
          </div>
        ) : null}

        {stage === "apply" ? (
          <div className="organization-stage">
            <div className="stage-intro">
              <span>2</span>
              <div>
                <h3>Apply the approved structure to existing Proton history</h3>
                <p>
                  {Object.keys(containers).length} address containers selected.
                  Preview the exact message moves below; future automation is
                  reviewed separately on the Rules page.
                </p>
              </div>
            </div>
          </div>
        ) : null}

        <div className="organization-flow-actions">
          <button
            className="secondary-button"
            type="button"
            disabled={stageIndex === 0}
            onClick={() => setStage(organizationStages[stageIndex - 1]!.id)}
          >
            Back
          </button>
          {stageIndex < organizationStages.length - 1 ? (
            <button
              className="primary-button compact"
              type="button"
              onClick={() => setStage(organizationStages[stageIndex + 1]!.id)}
            >
              Continue to{" "}
              {organizationStages[stageIndex + 1]!.label.toLowerCase()}
            </button>
          ) : (
            <button
              className="primary-button compact"
              type="button"
              onClick={onContinue}
            >
              Continue to unsubscribe
            </button>
          )}
        </div>
      </section>
      {stage === "apply" ? (
        <CleanupPanel
          analysis={analysis}
          plan={cleanupPlan}
          onGenerate={() => onGenerateCleanup(containers)}
          onApprove={onApproveCleanup}
          onResume={onResumeCleanup}
          onRetry={onRetryCleanup}
          onUndo={onUndoCleanup}
        />
      ) : null}
    </>
  );
};

const CleanupPanel = ({
  analysis,
  plan,
  onGenerate,
  onApprove,
  onResume,
  onRetry,
  onUndo,
  mode = "organize",
  canGenerate = true,
}: {
  analysis: MailboxAnalysisSummary | null;
  plan: CleanupPlan | null;
  onGenerate(): Promise<void>;
  onApprove(planId: string, revision: string): Promise<void>;
  onResume(planId: string, revision: string): Promise<void>;
  onRetry(planId: string, actionIds: string[]): Promise<void>;
  onUndo(planId: string): Promise<void>;
  mode?: "organize" | "trash";
  canGenerate?: boolean;
}) => {
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!analysis) return null;
  const act = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch {
      setError(
        "Cleanup stopped safely. Completed actions remain recorded; failed actions can be retried from their checkpoint.",
      );
    } finally {
      setBusy(false);
    }
  };
  const running = plan?.job?.state === "running";
  const resumable = plan?.job?.state === "pending" && plan.state !== "draft";
  const retryable = plan?.failedActions ?? [];
  const canUndo = plan?.job?.state === "succeeded" && !plan.undoJob;
  const trash = mode === "trash";
  return (
    <section
      className="readiness-panel cleanup-panel"
      aria-labelledby="cleanup-title"
    >
      <div className="panel-header">
        <div>
          <p className="eyebrow">
            {trash ? "FINAL PRUNING PASS" : "REVIEW & APPLY"}
          </p>
          <h2 id="cleanup-title">
            {trash
              ? "Move selected stale history to Proton Trash"
              : "Clean the Proton inbox"}
          </h2>
        </div>
        <span className="secured-label">
          <ShieldCheck size={14} /> Explicit approval required
        </span>
      </div>
      {!plan ? (
        <div className="analysis-empty">
          <p>
            {trash
              ? "Generate an exact reversible action list for the sender domains selected above. Security, accounts, transactions, finance, personal, and suspicious mail remain protected."
              : "Generate an immutable action list from this proposal. Uncertain, personal, and low-confidence messages stay untouched."}
          </p>
          <button
            className="primary-button compact"
            type="button"
            disabled={busy || !canGenerate}
            onClick={() => void act(onGenerate)}
          >
            {busy
              ? "Calculating impact…"
              : trash
                ? "Build exact Trash plan"
                : "Preview exact cleanup impact"}
          </button>
        </div>
      ) : (
        <div className="cleanup-review">
          <div className="cleanup-totals">
            <div>
              <b>{plan.actionCount.toLocaleString()}</b>
              <span>{trash ? "messages selected" : "approved candidates"}</span>
            </div>
            <div>
              <b>
                {trash
                  ? plan.trashCount.toLocaleString()
                  : plan.spamCount.toLocaleString()}
              </b>
              <span>
                {trash ? "native Trash actions" : "native Spam actions"}
              </span>
            </div>
            <div>
              <b>{plan.skippedCount.toLocaleString()}</b>
              <span>left untouched</span>
            </div>
          </div>
          <div
            className="proposal-table"
            role="table"
            aria-label="Cleanup impact"
          >
            <div className="cleanup-impact-row cleanup-impact-head">
              <span>Category</span>
              <span>Destination</span>
              <span>Action</span>
              <span>Messages</span>
            </div>
            {plan.impacts.map((impact) => (
              <div
                className="cleanup-impact-row"
                key={`${impact.category}:${impact.targetFolder}`}
              >
                <strong>{impact.category}</strong>
                <span>{impact.targetFolder}</span>
                <small>
                  {impact.action === "native_spam"
                    ? "Report / move to Spam"
                    : impact.action === "native_trash"
                      ? "Move to provider Trash"
                      : "Mark read · move · archive"}
                </small>
                <b>{impact.messageCount.toLocaleString()}</b>
              </div>
            ))}
          </div>
          {plan.state === "draft" ? (
            <div className="cleanup-approval">
              <label>
                <input
                  type="checkbox"
                  checked={approved}
                  onChange={(event) => setApproved(event.target.checked)}
                />
                <span>
                  <strong>I approve these exact mailbox changes</strong>
                  <small>
                    {trash
                      ? "Move only the listed non-critical messages into Proton’s native Trash folder. Nothing is permanently erased."
                      : "Create the listed folders, mark selected messages read, move/archive them, and route only the listed high-confidence junk through Proton Spam."}
                  </small>
                </span>
              </label>
              <button
                className="primary-button"
                type="button"
                disabled={!approved || busy || plan.actionCount === 0}
                onClick={() =>
                  void act(() => onApprove(plan.id, plan.revision))
                }
              >
                {busy
                  ? "Starting cleanup…"
                  : trash
                    ? `Move ${plan.actionCount.toLocaleString()} messages to Trash`
                    : `Apply ${plan.actionCount.toLocaleString()} approved actions`}
              </button>
            </div>
          ) : null}
          {plan.job ? (
            <div className="cleanup-execution" aria-live="polite">
              <div>
                <span>
                  <strong>
                    {plan.undoJob?.state === "succeeded"
                      ? "Original mailbox state restored"
                      : plan.state === "completed"
                        ? "Cleanup completed and recorded"
                        : running
                          ? "Applying approved cleanup"
                          : plan.state === "failed"
                            ? "Cleanup finished with recoverable failures"
                            : "Cleanup paused at a checkpoint"}
                  </strong>
                  <small>
                    {plan.undoJob
                      ? `${plan.undoJob.completedItems.toLocaleString()} / ${plan.undoJob.totalItems.toLocaleString()} restore actions verified`
                      : `${plan.job.completedItems.toLocaleString()} / ${plan.job.totalItems.toLocaleString()} actions processed`}
                  </small>
                </span>
                <b>{plan.undoJob?.percent ?? plan.job.percent}%</b>
              </div>
              <progress
                max={100}
                value={plan.undoJob?.percent ?? plan.job.percent}
              />
              <div className="cleanup-job-actions">
                {resumable ? (
                  <button
                    className="primary-button compact"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void act(() => onResume(plan.id, plan.revision))
                    }
                  >
                    {busy ? "Resuming…" : "Resume cleanup"}
                  </button>
                ) : null}
                {retryable.length ? (
                  <button
                    className="primary-button compact"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void act(() =>
                        onRetry(
                          plan.id,
                          retryable.map((action) => action.id),
                        ),
                      )
                    }
                  >
                    {busy ? "Retrying…" : `Retry ${retryable.length} failed`}
                  </button>
                ) : null}
                {canUndo ? (
                  <button
                    className="secondary-button danger"
                    type="button"
                    disabled={busy}
                    onClick={() => void act(() => onUndo(plan.id))}
                  >
                    {busy ? "Restoring…" : "Undo verified moves"}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
          <p className="cleanup-warning">
            No permanent deletion is used.{" "}
            {trash
              ? "The selected history moves to Proton’s native Trash and remains recoverable under the provider’s retention policy."
              : "Messages excluded as personal, suspicious, low-confidence, or uncategorized remain where they are."}
          </p>
        </div>
      )}
      {error ? (
        <p className="connection-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
};

const TrashReviewPanel = ({
  analysis,
  plan,
  onGenerate,
  onApprove,
  onResume,
  onRetry,
  onUndo,
}: {
  analysis: MailboxAnalysisSummary | null;
  plan: CleanupPlan | null;
  onGenerate(senderDomains: string[]): Promise<void>;
  onApprove(planId: string, revision: string): Promise<void>;
  onResume(planId: string, revision: string): Promise<void>;
  onRetry(planId: string, actionIds: string[]): Promise<void>;
  onUndo(planId: string): Promise<void>;
}) => {
  const [selected, setSelected] = useState<string[]>([]);
  if (!analysis) return null;
  const candidates = rankStaleStreams(analysis.topStreams).map((candidate) => ({
    ...candidate,
    age: recency(candidate.latestAt),
  }));
  return (
    <>
      <section className="readiness-panel trash-review-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">STALE HISTORY</p>
            <h2>Choose old sender streams to remove</h2>
          </div>
          <span className="secured-label">
            <Archive size={14} /> Reversible Trash only
          </span>
        </div>
        <div className="trash-review-copy">
          <p>
            Sift shows senders whose newest message is at least six months old.
            Selecting a sender never includes security, account, transaction,
            finance, personal, or suspicious classifications.
          </p>
          <span>
            <b>
              {candidates
                .reduce((sum, item) => sum + item.messages, 0)
                .toLocaleString()}
            </b>{" "}
            removable messages across <b>{candidates.length}</b> stale senders
          </span>
        </div>
        <div className="trash-candidates">
          <div className="trash-candidate-head">
            <span></span>
            <span>Sender</span>
            <span>Alias scope</span>
            <span>Newest message</span>
            <span>Protected</span>
            <span>Removable</span>
          </div>
          {candidates.slice(0, 200).map((candidate) => (
            <label key={candidate.domain}>
              <input
                type="checkbox"
                checked={selected.includes(candidate.domain)}
                onChange={(event) =>
                  setSelected((current) =>
                    event.target.checked
                      ? [...current, candidate.domain]
                      : current.filter((domain) => domain !== candidate.domain),
                  )
                }
              />
              <strong>{candidate.domain}</strong>
              <span>
                {candidate.addresses.length === 1
                  ? candidate.addresses[0]
                  : `${candidate.addresses.length} aliases`}
              </span>
              <small>{candidate.age.label}</small>
              <b>{candidate.protected.toLocaleString()}</b>
              <em>{candidate.messages.toLocaleString()}</em>
            </label>
          ))}
        </div>
        {!candidates.length ? (
          <p className="analysis-empty-note">
            No non-critical sender stream is old enough for the stale-history
            pass.
          </p>
        ) : null}
        {candidates.length ? (
          <div className="trash-selection">
            <button
              className="secondary-button"
              type="button"
              onClick={() =>
                setSelected(
                  selected.length === candidates.length
                    ? []
                    : candidates.map((candidate) => candidate.domain),
                )
              }
            >
              {selected.length === candidates.length
                ? "Clear selection"
                : "Select all stale senders"}
            </button>
            <span>
              {selected.length} sender{selected.length === 1 ? "" : "s"}{" "}
              selected
            </span>
          </div>
        ) : null}
      </section>
      <CleanupPanel
        analysis={analysis}
        plan={plan}
        onGenerate={() => onGenerate(selected)}
        onApprove={onApprove}
        onResume={onResume}
        onRetry={onRetry}
        onUndo={onUndo}
        mode="trash"
        canGenerate={selected.length > 0}
      />
    </>
  );
};

const UnsubscribePanel = ({
  analysis,
  dashboard,
  onScan,
  onStart,
  onResume,
  onRetry,
  provider = "proton",
}: {
  analysis: MailboxAnalysisSummary | null;
  dashboard: SubscriptionDashboard | null;
  onScan(): Promise<void>;
  onStart(candidateIds: string[]): Promise<void>;
  onResume(jobId: string): Promise<void>;
  onRetry(jobId: string, candidateIds: string[]): Promise<void>;
  provider?: "proton" | "gmail" | "outlook";
}) => {
  const [selected, setSelected] = useState<string[]>([]);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!analysis) return null;
  const act = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch {
      setError(
        "Bulk unsubscribe stopped. Completed requests are recorded; no spam or protected sender was contacted.",
      );
    } finally {
      setBusy(false);
    }
  };
  const eligible =
    dashboard?.candidates.filter(
      (candidate) =>
        candidate.eligibility === "eligible" && candidate.status === "pending",
    ) ?? [];
  const protectedCount =
    dashboard?.candidates.filter(
      (candidate) => candidate.eligibility === "protected",
    ).length ?? 0;
  const manualCount =
    dashboard?.candidates.filter(
      (candidate) => candidate.eligibility === "manual",
    ).length ?? 0;
  const spamCount =
    dashboard?.candidates.filter(
      (candidate) => candidate.eligibility === "spam_skipped",
    ).length ?? 0;
  const runActive =
    dashboard?.job?.state === "pending" || dashboard?.job?.state === "running";
  const failed =
    dashboard?.candidates.filter(
      (candidate) => candidate.status === "failed",
    ) ?? [];
  return (
    <section
      className="readiness-panel unsubscribe-panel"
      aria-labelledby={`${provider}-unsubscribe-title`}
    >
      <div className="panel-header">
        <div>
          <p className="eyebrow">{provider.toUpperCase()} BULK UNSUBSCRIBE</p>
          <h2 id={`${provider}-unsubscribe-title`}>
            Stop legitimate junk without confirming spam
          </h2>
        </div>
        <span className="secured-label">
          <ShieldCheck size={14} /> Authenticated one-click only
        </span>
      </div>
      {!dashboard ? (
        <div className="analysis-empty">
          <p>
            Find authenticated mailing lists, separate protected transactional
            mail, and quarantine likely spam from all automated unsubscribe
            requests.
          </p>
          <button
            className="primary-button compact"
            type="button"
            disabled={busy}
            onClick={() => void act(onScan)}
          >
            {busy ? "Finding lists…" : "Build unsubscribe dashboard"}
          </button>
        </div>
      ) : (
        <div className="unsubscribe-review">
          <div className="unsubscribe-summary">
            <span>
              <b>{eligible.length}</b> safe one-click candidates
            </span>
            <span>
              <b>{manualCount}</b> need manual action
            </span>
            <span>
              <b>{protectedCount}</b> protected lists
            </span>
            <span>
              <b>{spamCount}</b> spam contacts blocked
            </span>
            <button
              className="secondary-button"
              type="button"
              disabled={busy || runActive}
              onClick={() =>
                void act(async () => {
                  await onScan();
                  setSelected([]);
                  setConsent(false);
                })
              }
            >
              Refresh
            </button>
          </div>
          <div className="unsubscribe-list">
            {eligible.map((candidate) => (
              <label key={candidate.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(candidate.id)}
                  onChange={(event) =>
                    setSelected((current) =>
                      event.target.checked
                        ? [...current, candidate.id]
                        : current.filter((id) => id !== candidate.id),
                    )
                  }
                />
                <span>
                  <strong>{candidate.senderDomain}</strong>
                  <small>
                    {candidate.messageCount.toLocaleString()} messages ·{" "}
                    {candidate.messagesPerMonth.toFixed(1)}/month ·{" "}
                    {Math.round(candidate.readRate * 100)}% read →{" "}
                    {candidate.receivingAddress} ·{" "}
                    {candidate.sampleSubjects[0] ?? candidate.listId}
                  </small>
                </span>
                <b>
                  {candidate.recurrence === "recurring"
                    ? "RECURRING"
                    : `SCORE ${Math.round(candidate.priorityScore)}`}
                </b>
              </label>
            ))}
            {!eligible.length ? (
              <p>No pending authenticated one-click subscriptions remain.</p>
            ) : null}
          </div>
          {eligible.length ? (
            <div className="unsubscribe-select">
              <button
                className="secondary-button"
                type="button"
                onClick={() =>
                  setSelected(
                    selected.length === eligible.length
                      ? []
                      : eligible.map((candidate) => candidate.id),
                  )
                }
              >
                {selected.length === eligible.length
                  ? "Clear selection"
                  : "Select all safe candidates"}
              </button>
              <span>{selected.length} selected</span>
            </div>
          ) : null}
          {selected.length ? (
            <div className="unsubscribe-consent">
              <label>
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                />
                <span>
                  <strong>
                    I authorize {selected.length} one-click unsubscribe request
                    {selected.length === 1 ? "" : "s"}
                  </strong>
                  <small>
                    HTTPS POST only, no cookies or account credentials, public
                    hosts only, and no requests to anything classified as spam,
                    suspicious, transactional, security, account, or finance
                    mail.
                  </small>
                </span>
              </label>
              <button
                className="primary-button"
                type="button"
                disabled={!consent || busy}
                onClick={() => void act(() => onStart(selected))}
              >
                {busy
                  ? "Sending approved requests…"
                  : `Unsubscribe from ${selected.length} selected list${selected.length === 1 ? "" : "s"}`}
              </button>
            </div>
          ) : null}
          {dashboard.job ? (
            <div className="cleanup-execution">
              <div>
                <span>
                  <strong>
                    {dashboard.job.state === "succeeded"
                      ? "Bulk unsubscribe complete"
                      : dashboard.job.state === "running"
                        ? "Sending approved one-click requests"
                        : dashboard.job.state === "failed"
                          ? "Finished with retryable failures"
                          : "Unsubscribe run paused"}
                  </strong>
                  <small>
                    {dashboard.job.completedItems} / {dashboard.job.totalItems}{" "}
                    requests processed
                  </small>
                </span>
                <b>{dashboard.job.percent}%</b>
              </div>
              <progress max={100} value={dashboard.job.percent} />
              <div className="cleanup-job-actions">
                {dashboard.job.state === "pending" ? (
                  <button
                    className="primary-button compact"
                    type="button"
                    disabled={busy}
                    onClick={() => void act(() => onResume(dashboard.job!.id))}
                  >
                    Resume unsubscribe run
                  </button>
                ) : null}
                {failed.length ? (
                  <button
                    className="primary-button compact"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void act(() =>
                        onRetry(
                          dashboard.job!.id,
                          failed.map((candidate) => candidate.id),
                        ),
                      )
                    }
                  >
                    Retry {failed.length} failed
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
          {(["manual", "protected", "spam_skipped"] as const).map(
            (eligibility) => (
              <details className="unsubscribe-exclusions" key={eligibility}>
                <summary>
                  {eligibility === "manual"
                    ? `Manual action queue (${manualCount})`
                    : eligibility === "protected"
                      ? `Protected mail (${protectedCount})`
                      : `Spam contacts blocked (${spamCount})`}
                </summary>
                <ul>
                  {dashboard.candidates
                    .filter(
                      (candidate) => candidate.eligibility === eligibility,
                    )
                    .slice(0, 100)
                    .map((candidate) => (
                      <li key={candidate.id}>
                        <span>
                          <strong>{candidate.senderDomain}</strong>
                          <small>
                            {candidate.reason} · {candidate.receivingAddress}
                          </small>
                        </span>
                        <b>{candidate.messageCount.toLocaleString()}</b>
                      </li>
                    ))}
                </ul>
              </details>
            ),
          )}
        </div>
      )}
      {error ? (
        <p className="connection-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
};

const GmailConnectionPanel = ({
  connection,
  audit,
  onConnect,
  onDisconnect,
  onAudit,
  showAudit = false,
}: {
  connection: GmailConnectionSummary | null;
  audit: GmailAuditSummary | null;
  onConnect(clientId: string, clientSecret?: string): Promise<void>;
  onDisconnect(connectionId: string): Promise<void>;
  onAudit(): Promise<void>;
  showAudit?: boolean;
}) => {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const connect = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onConnect(clientId, clientSecret || undefined);
      setAdding(false);
    } catch {
      setError(
        "Gmail sign-in did not finish. Verify the Desktop OAuth client, Gmail API, consent-screen scopes, and test-user access.",
      );
    } finally {
      setBusy(false);
    }
  };
  if (showAudit && !connection) return null;
  return (
    <section
      className={`readiness-panel gmail-panel ${showAudit ? "gmail-audit-mode" : "gmail-connect-mode"}`}
      aria-labelledby="gmail-title"
    >
      <div className="panel-header">
        <div>
          <p className="eyebrow">GMAIL</p>
          <h2 id="gmail-title">Connect through Google’s consent screen</h2>
        </div>
        <span className="secured-label">
          <ShieldCheck size={14} /> OAuth + PKCE
        </span>
      </div>
      {connection && !adding ? (
        <div className="gmail-connected-wrap">
          <div className="gmail-connected">
            <div>
              <span className="state-icon safe">
                <Check size={15} />
              </span>
              <span>
                <strong>{connection.email}</strong>
                <small>
                  Refresh access is encrypted in this Windows profile. Your
                  Google password is never seen or stored.
                </small>
              </span>
              <b>CONNECTED</b>
            </div>
            <div className="connection-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={busy || audit?.state === "scanning"}
                onClick={() => setAdding(true)}
              >
                Add another Gmail
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={busy || audit?.state === "scanning"}
                onClick={() => void onDisconnect(connection.id)}
              >
                {busy ? "Disconnecting…" : "Disconnect Gmail"}
              </button>
            </div>
          </div>
          <div className="gmail-audit">
            <span>
              <strong>
                {audit?.state === "completed"
                  ? "Gmail history inventoried"
                  : audit?.state === "scanning"
                    ? "Reading Gmail metadata"
                    : audit?.state === "paused" || audit?.state === "failed"
                      ? "Audit can resume from its saved page"
                      : "Ready for a read-only history audit"}
              </strong>
              <small>
                {(audit?.indexedMessages ?? 0).toLocaleString()} indexed
                {audit?.totalEstimate
                  ? ` of about ${audit.totalEstimate.toLocaleString()}`
                  : ""}{" "}
                · includes Spam and Trash for accurate classification
              </small>
            </span>
            <button
              className="primary-button compact"
              type="button"
              disabled={busy || audit?.state === "scanning"}
              onClick={() => {
                setBusy(true);
                setError("");
                void onAudit()
                  .catch(() =>
                    setError(
                      "Gmail audit paused at its last saved page. Check the connection and resume.",
                    ),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              {busy
                ? "Scanning Gmail…"
                : audit?.state === "completed"
                  ? "Run fresh Gmail audit"
                  : audit?.indexedMessages
                    ? "Resume Gmail audit"
                    : "Start Gmail audit"}
            </button>
          </div>
          {audit?.state === "scanning" ? (
            <progress
              max={Math.max(audit.totalEstimate, 1)}
              value={audit.indexedMessages}
            />
          ) : null}
        </div>
      ) : (
        <form
          className="gmail-connect-form"
          onSubmit={(event) => void connect(event)}
        >
          <p>
            Use a Google Cloud <strong>Desktop app</strong> OAuth client with
            the Gmail API enabled. The browser handles sign-in; Sift listens
            only on a random <code>127.0.0.1</code> callback port.
          </p>
          <label>
            <span>OAuth client ID</span>
            <input
              required
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              placeholder="123456789-….apps.googleusercontent.com"
              autoComplete="off"
            />
          </label>
          <details>
            <summary>Client secret (optional for PKCE)</summary>
            <label>
              <span>OAuth client secret</span>
              <input
                type="password"
                value={clientSecret}
                onChange={(event) => setClientSecret(event.target.value)}
                autoComplete="off"
              />
            </label>
          </details>
          <div className="connection-actions">
            {connection ? (
              <button
                className="secondary-button"
                type="button"
                onClick={() => setAdding(false)}
              >
                Cancel
              </button>
            ) : null}
            <button
              className="primary-button"
              type="submit"
              disabled={busy || !clientId}
            >
              {busy ? "Waiting for Google…" : "Open Google sign-in"}
            </button>
            <small>
              For an unverified testing project, add each Gmail address as a
              test user.
            </small>
          </div>
        </form>
      )}
      {error ? (
        <p className="connection-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
};

const GmailOrganizationPanel = ({
  analysis,
  plan,
  onGenerate,
  onApprove,
  onRetry,
  onUndo,
  mode = "organize",
}: {
  analysis: MailboxAnalysisSummary | null;
  plan: GmailOrganizationPlan | null;
  onGenerate(): Promise<void>;
  onApprove(id: string, revision: string): Promise<void>;
  onRetry(id: string, batchIds: string[]): Promise<void>;
  onUndo(id: string): Promise<void>;
  mode?: "organize" | "trash";
}) => {
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!analysis) return null;
  const trash = mode === "trash";
  const act = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch {
      setError(
        "Gmail history stopped safely at a verified batch checkpoint. Retry failed work or rebuild the plan after a mailbox-state mismatch.",
      );
    } finally {
      setBusy(false);
    }
  };
  const progress = plan?.undoJob ?? plan?.job;
  return (
    <section
      className="readiness-panel gmail-organize-panel"
      aria-labelledby={`gmail-${mode}-title`}
    >
      <div className="panel-header">
        <div>
          <p className="eyebrow">
            {trash ? "GMAIL STALE HISTORY" : "GMAIL HISTORY"}
          </p>
          <h2 id={`gmail-${mode}-title`}>
            {trash
              ? "Move the approved old mail to Gmail Trash"
              : "Apply the approved labels to existing Gmail"}
          </h2>
        </div>
        <span className="secured-label">
          <ShieldCheck size={14} /> Verified batches
        </span>
      </div>
      {!plan ? (
        <div className="analysis-empty">
          <p>
            {trash
              ? "Build reversible 100-message Trash batches from the selected stale senders. Every batch verifies live labels before and after the move."
              : "Build 100-message batches from the corrected address-scoped proposal. Every batch checks live labels before changing anything and re-reads every message afterward."}
          </p>
          <button
            className="primary-button compact"
            disabled={busy}
            onClick={() => void act(onGenerate)}
          >
            {busy
              ? "Building batches…"
              : trash
                ? "Preview Gmail Trash impact"
                : "Preview Gmail history impact"}
          </button>
        </div>
      ) : (
        <div className="cleanup-review">
          <div className="cleanup-totals">
            <div>
              <b>{plan.impactCount}</b>
              <span>
                {trash ? "sender impacts" : "address/category impacts"}
              </span>
            </div>
            <div>
              <b>{plan.existingMessageCount.toLocaleString()}</b>
              <span>existing messages</span>
            </div>
            <div>
              <b>{plan.skippedAmbiguousStreams}</b>
              <span>protected or uncertain</span>
            </div>
          </div>
          <div className="proposal-table">
            <div className="cleanup-impact-row cleanup-impact-head">
              <span>Address / source</span>
              <span>Label</span>
              <span>Action</span>
              <span>Messages</span>
            </div>
            {plan.impacts.slice(0, 100).map((impact) => (
              <div className="cleanup-impact-row" key={impact.id}>
                <strong>{impact.scopeAddress ?? impact.sourceCategory}</strong>
                <span>{impact.targetLabel}</span>
                <small>
                  {impact.trash
                    ? "Move to Trash"
                    : impact.spam
                      ? "Move to Spam"
                      : `${impact.markRead ? "read · " : ""}${impact.archive ? "archive" : "keep in inbox"}`}
                </small>
                <b>{impact.existingMessages}</b>
              </div>
            ))}
          </div>
          {plan.state === "draft" ? (
            <div className="cleanup-approval">
              <label>
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                />
                <span>
                  <strong>I approve these exact Gmail history changes</strong>
                  <small>
                    {trash
                      ? "Only the listed old, non-critical messages move to Gmail Trash. Exact prior labels are retained for Undo."
                      : "Future filters are managed separately on Rules. This pass changes only the listed existing messages and keeps exact prior labels for Undo."}
                  </small>
                </span>
              </label>
              <button
                className="primary-button"
                disabled={!consent || busy || !plan.impactCount}
                onClick={() =>
                  void act(() => onApprove(plan.id, plan.revision))
                }
              >
                {busy
                  ? "Applying and verifying…"
                  : trash
                    ? "Move approved mail to Gmail Trash"
                    : "Apply approved Gmail history"}
              </button>
            </div>
          ) : (
            <div className="cleanup-execution">
              <div>
                <span>
                  <strong>
                    {plan.undoJob?.state === "succeeded"
                      ? "Original Gmail labels restored"
                      : plan.state === "completed"
                        ? trash
                          ? "Gmail Trash moves verified"
                          : "Gmail history verified"
                        : plan.state === "failed"
                          ? "Some batches need attention"
                          : trash
                            ? "Moving Gmail history to Trash"
                            : "Applying Gmail history"}
                  </strong>
                  <small>
                    {progress?.completedItems ?? 0} /{" "}
                    {progress?.totalItems ?? plan.batchCount} batches processed
                  </small>
                </span>
                <b>{progress?.percent ?? 0}%</b>
              </div>
              <progress max={100} value={progress?.percent ?? 0} />
              <div className="cleanup-job-actions">
                {plan.job?.state === "pending" ? (
                  <button
                    className="primary-button compact"
                    disabled={busy}
                    onClick={() => void act(() => onApprove(plan.id, plan.revision))}
                  >
                    Resume Microsoft actions
                  </button>
                ) : null}
                {plan.failedBatches.length ? (
                  <button
                    className="primary-button compact"
                    disabled={busy}
                    onClick={() =>
                      void act(() =>
                        onRetry(
                          plan.id,
                          plan.failedBatches.map((batch) => batch.id),
                        ),
                      )
                    }
                  >
                    Retry {plan.failedBatches.length} failed
                  </button>
                ) : null}
                {plan.job?.state === "succeeded" && !plan.undoJob ? (
                  <button
                    className="secondary-button danger"
                    disabled={busy}
                    onClick={() => void act(() => onUndo(plan.id))}
                  >
                    Undo verified batches
                  </button>
                ) : null}
              </div>
            </div>
          )}
        </div>
      )}
      {error ? <p className="connection-error">{error}</p> : null}
    </section>
  );
};

const GmailTrashReviewPanel = ({
  analysis,
  plan,
  onGenerate,
  onApprove,
  onRetry,
  onUndo,
}: {
  analysis: MailboxAnalysisSummary;
  plan: GmailOrganizationPlan | null;
  onGenerate(senderDomains: string[]): Promise<void>;
  onApprove(id: string, revision: string): Promise<void>;
  onRetry(id: string, batchIds: string[]): Promise<void>;
  onUndo(id: string): Promise<void>;
}) => {
  const [selected, setSelected] = useState<string[]>([]);
  const candidates = rankStaleStreams(analysis.topStreams).map((candidate) => ({
    ...candidate,
    age: recency(candidate.latestAt),
  }));
  return (
    <>
      <section className="readiness-panel trash-review-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">GMAIL STALE HISTORY</p>
            <h2>Choose old Gmail sender streams to remove</h2>
          </div>
          <span className="secured-label">
            <Archive size={14} /> Reversible Trash only
          </span>
        </div>
        <div className="trash-review-copy">
          <p>
            Only mail older than six months is eligible. Critical
            classifications and anything already in Spam or Trash stay out of
            the plan.
          </p>
          <span>
            <b>
              {candidates
                .reduce((sum, item) => sum + item.messages, 0)
                .toLocaleString()}
            </b>{" "}
            removable messages across <b>{candidates.length}</b> stale senders
          </span>
        </div>
        <div className="trash-candidates">
          <div className="trash-candidate-head">
            <span></span>
            <span>Sender</span>
            <span>Alias scope</span>
            <span>Newest message</span>
            <span>Protected</span>
            <span>Removable</span>
          </div>
          {candidates.slice(0, 200).map((candidate) => (
            <label key={candidate.domain}>
              <input
                type="checkbox"
                checked={selected.includes(candidate.domain)}
                onChange={(event) =>
                  setSelected((current) =>
                    event.target.checked
                      ? [...current, candidate.domain]
                      : current.filter((domain) => domain !== candidate.domain),
                  )
                }
              />
              <strong>{candidate.domain}</strong>
              <span>
                {candidate.addresses.length === 1
                  ? candidate.addresses[0]
                  : `${candidate.addresses.length} aliases`}
              </span>
              <small>{candidate.age.label}</small>
              <b>{candidate.protected.toLocaleString()}</b>
              <em>{candidate.messages.toLocaleString()}</em>
            </label>
          ))}
        </div>
        {!candidates.length ? (
          <p className="analysis-empty-note">
            No non-critical Gmail sender stream is old enough for this pass.
          </p>
        ) : null}
        {candidates.length ? (
          <div className="trash-selection">
            <button
              className="secondary-button"
              type="button"
              onClick={() =>
                setSelected(
                  selected.length === candidates.length
                    ? []
                    : candidates.map((candidate) => candidate.domain),
                )
              }
            >
              {selected.length === candidates.length
                ? "Clear selection"
                : "Select all stale senders"}
            </button>
            <span>
              {selected.length} sender{selected.length === 1 ? "" : "s"}{" "}
              selected
            </span>
          </div>
        ) : null}
      </section>
      {selected.length || plan ? (
        <GmailOrganizationPanel
          analysis={analysis}
          plan={plan}
          onGenerate={() => onGenerate(selected)}
          onApprove={onApprove}
          onRetry={onRetry}
          onUndo={onUndo}
          mode="trash"
        />
      ) : null}
    </>
  );
};

const OutlookConnectionPanel = ({
  connection,
  audit,
  onConnect,
  onDisconnect,
  onAudit,
  showAudit = false,
}: {
  connection: OutlookConnectionSummary | null;
  audit: OutlookAuditSummary | null;
  onConnect(
    clientId: string,
    tenant: "common" | "consumers" | "organizations",
  ): Promise<void>;
  onDisconnect(id: string): Promise<void>;
  onAudit(): Promise<void>;
  showAudit?: boolean;
}) => {
  const [clientId, setClientId] = useState("");
  const [tenant, setTenant] = useState<
    "common" | "consumers" | "organizations"
  >("common");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (showAudit && !connection) return null;
  return (
    <section className="readiness-panel gmail-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">OUTLOOK / HOTMAIL</p>
          <h2>
            {showAudit
              ? "Audit Microsoft mailbox history"
              : "Connect through Microsoft sign-in"}
          </h2>
        </div>
        <span className="secured-label">
          <ShieldCheck size={14} /> OAuth + PKCE
        </span>
      </div>
      {connection ? (
        <div className="gmail-connected-wrap">
          <div className="gmail-connected">
            <div>
              <span className="state-icon safe">
                <Check size={15} />
              </span>
              <span>
                <strong>{connection.email}</strong>
                <small>
                  Microsoft refresh access is encrypted locally. Sift never
                  receives the account password.
                </small>
              </span>
              <b>CONNECTED</b>
            </div>
            {!showAudit ? (
              <div className="connection-actions">
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => void onDisconnect(connection.id)}
                >
                  Disconnect Microsoft
                </button>
              </div>
            ) : null}
          </div>
          {showAudit ? (
            <div className="gmail-audit">
              <span>
                <strong>
                  {audit?.state === "completed"
                    ? "Microsoft history inventoried"
                    : audit?.state === "scanning"
                      ? "Reading Microsoft metadata"
                      : "Ready for a read-only Graph audit"}
                </strong>
                <small>
                  {(audit?.indexedMessages ?? 0).toLocaleString()} indexed
                  {audit?.totalEstimate
                    ? ` of about ${audit.totalEstimate.toLocaleString()}`
                    : ""}
                </small>
              </span>
              <button
                className="primary-button compact"
                disabled={busy || audit?.state === "scanning"}
                onClick={() => {
                  setBusy(true);
                  void onAudit()
                    .catch(() =>
                      setError("Microsoft audit paused at its saved page."),
                    )
                    .finally(() => setBusy(false));
                }}
              >
                {busy
                  ? "Scanning Microsoft mail…"
                  : audit?.indexedMessages
                    ? "Resume Microsoft audit"
                    : "Start Microsoft audit"}
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <form
          className="gmail-connect-form"
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            void onConnect(clientId, tenant)
              .catch(() =>
                setError(
                  "Microsoft sign-in did not finish. Verify the public desktop app registration and redirect URI.",
                ),
              )
              .finally(() => setBusy(false));
          }}
        >
          <p>
            Register a Microsoft identity platform{" "}
            <strong>Mobile and desktop application</strong> with the{" "}
            <code>http://localhost</code> redirect. Sift opens the system
            browser and uses PKCE without a client secret.
          </p>
          <label>
            <span>Application (client) ID</span>
            <input
              required
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
            />
          </label>
          <label>
            <span>Account audience</span>
            <select
              value={tenant}
              onChange={(event) =>
                setTenant(event.target.value as typeof tenant)
              }
            >
              <option value="common">Work, school, Outlook, or Hotmail</option>
              <option value="consumers">Outlook and Hotmail only</option>
              <option value="organizations">Work and school only</option>
            </select>
          </label>
          <button
            className="primary-button compact"
            disabled={busy || !clientId}
          >
            {busy ? "Waiting for Microsoft…" : "Open Microsoft sign-in"}
          </button>
        </form>
      )}
      {error ? <p className="connection-error">{error}</p> : null}
    </section>
  );
};

const OutlookHistoryPanel = ({
  analysis,
  plan,
  onGenerate,
  onApprove,
  onRetry,
  onUndo,
  mode = "organize",
}: {
  analysis: MailboxAnalysisSummary | null;
  plan: GmailOrganizationPlan | null;
  onGenerate(): Promise<void>;
  onApprove(id: string, revision: string): Promise<void>;
  onRetry(id: string, actionIds: string[]): Promise<void>;
  onUndo(id: string): Promise<void>;
  mode?: "organize" | "trash";
}) => {
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!analysis) return null;
  const trash = mode === "trash";
  const progress = plan?.undoJob ?? plan?.job;
  const act = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch {
      setError(
        "Microsoft stopped at a verified message checkpoint. Retry only the failed actions or rebuild the plan.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="readiness-panel gmail-organize-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">
            MICROSOFT {trash ? "STALE HISTORY" : "HISTORY"}
          </p>
          <h2>
            {trash
              ? "Move approved old mail to Deleted Items"
              : "File existing Outlook and Hotmail messages"}
          </h2>
        </div>
        <span className="secured-label">
          <ShieldCheck size={14} /> Immutable IDs + verification
        </span>
      </div>
      {!plan ? (
        <div className="analysis-empty">
          <p>
            {trash
              ? "Build a reversible plan for the selected old, non-critical senders."
              : "Build exact message actions from the corrected address-scoped proposal. Every move is re-read from Microsoft Graph before it is recorded."}
          </p>
          <button
            className="primary-button compact"
            disabled={busy}
            onClick={() => void act(onGenerate)}
          >
            {busy
              ? "Building plan…"
              : trash
                ? "Preview Microsoft Trash impact"
                : "Preview Microsoft history impact"}
          </button>
        </div>
      ) : (
        <div className="cleanup-review">
          <div className="cleanup-totals">
            <div>
              <b>{plan.impactCount}</b>
              <span>address/category impacts</span>
            </div>
            <div>
              <b>{plan.existingMessageCount.toLocaleString()}</b>
              <span>existing messages</span>
            </div>
            <div>
              <b>{plan.skippedAmbiguousStreams}</b>
              <span>protected or uncertain</span>
            </div>
          </div>
          <div className="proposal-table">
            <div className="cleanup-impact-row cleanup-impact-head">
              <span>Address / source</span>
              <span>Folder</span>
              <span>Action</span>
              <span>Messages</span>
            </div>
            {plan.impacts.slice(0, 100).map((impact) => (
              <div className="cleanup-impact-row" key={impact.id}>
                <strong>{impact.scopeAddress ?? impact.sourceCategory}</strong>
                <span>{impact.targetLabel}</span>
                <small>
                  {impact.trash
                    ? "Deleted Items"
                    : impact.spam
                      ? "Junk Email"
                      : `${impact.markRead ? "read · " : ""}move`}
                </small>
                <b>{impact.existingMessages}</b>
              </div>
            ))}
          </div>
          {plan.state === "draft" ? (
            <div className="cleanup-approval">
              <label>
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                />
                <span>
                  <strong>
                    I approve these exact Microsoft mailbox changes
                  </strong>
                  <small>
                    Each message keeps its original folder and read-state
                    receipt for Undo.
                  </small>
                </span>
              </label>
              <button
                className="primary-button"
                disabled={!consent || busy || !plan.impactCount}
                onClick={() =>
                  void act(() => onApprove(plan.id, plan.revision))
                }
              >
                {busy
                  ? "Applying and verifying…"
                  : trash
                    ? "Move approved mail to Deleted Items"
                    : "Apply approved Microsoft history"}
              </button>
            </div>
          ) : (
            <div className="cleanup-execution">
              <div>
                <span>
                  <strong>
                    {plan.undoJob?.state === "succeeded"
                      ? "Original Microsoft state restored"
                      : plan.state === "completed"
                        ? "Microsoft history verified"
                        : "Microsoft actions need attention"}
                  </strong>
                  <small>
                    {progress?.completedItems ?? 0} /{" "}
                    {progress?.totalItems ?? plan.batchCount} messages processed
                  </small>
                </span>
                <b>{progress?.percent ?? 0}%</b>
              </div>
              <progress max={100} value={progress?.percent ?? 0} />
              <div className="cleanup-job-actions">
                {plan.failedBatches.length ? (
                  <button
                    className="primary-button compact"
                    disabled={busy}
                    onClick={() =>
                      void act(() =>
                        onRetry(
                          plan.id,
                          plan.failedBatches.map((item) => item.id),
                        ),
                      )
                    }
                  >
                    Retry {plan.failedBatches.length} failed
                  </button>
                ) : null}
                {plan.job?.state === "succeeded" && !plan.undoJob ? (
                  <button
                    className="secondary-button danger"
                    disabled={busy}
                    onClick={() => void act(() => onUndo(plan.id))}
                  >
                    Undo verified actions
                  </button>
                ) : null}
              </div>
            </div>
          )}
        </div>
      )}
      {error ? <p className="connection-error">{error}</p> : null}
    </section>
  );
};

const OutlookTrashReviewPanel = ({
  analysis,
  plan,
  onGenerate,
  onApprove,
  onRetry,
  onUndo,
}: {
  analysis: MailboxAnalysisSummary;
  plan: GmailOrganizationPlan | null;
  onGenerate(domains: string[]): Promise<void>;
  onApprove(id: string, revision: string): Promise<void>;
  onRetry(id: string, actionIds: string[]): Promise<void>;
  onUndo(id: string): Promise<void>;
}) => {
  const [selected, setSelected] = useState<string[]>([]);
  const candidates = rankStaleStreams(analysis.topStreams).map((candidate) => ({
    ...candidate,
    age: recency(candidate.latestAt),
  }));
  return (
    <>
      <section className="readiness-panel trash-review-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">MICROSOFT STALE HISTORY</p>
            <h2>Choose old Outlook senders to remove</h2>
          </div>
          <span className="secured-label">
            <Archive size={14} /> Recoverable Deleted Items
          </span>
        </div>
        <div className="trash-review-copy">
          <p>
            Only mail older than six months is eligible. Security, account,
            transaction, finance, personal, and suspicious classifications stay
            protected.
          </p>
          <span>
            <b>
              {candidates
                .reduce((sum, item) => sum + item.messages, 0)
                .toLocaleString()}
            </b>{" "}
            removable messages across <b>{candidates.length}</b> stale senders
          </span>
        </div>
        <div className="trash-candidates">
          <div className="trash-candidate-head">
            <span></span>
            <span>Sender</span>
            <span>Alias scope</span>
            <span>Newest message</span>
            <span>Protected</span>
            <span>Removable</span>
          </div>
          {candidates.slice(0, 200).map((candidate) => (
            <label key={candidate.domain}>
              <input
                type="checkbox"
                checked={selected.includes(candidate.domain)}
                onChange={(event) =>
                  setSelected((current) =>
                    event.target.checked
                      ? [...current, candidate.domain]
                      : current.filter((domain) => domain !== candidate.domain),
                  )
                }
              />
              <strong>{candidate.domain}</strong>
              <span>
                {candidate.addresses.length === 1
                  ? candidate.addresses[0]
                  : `${candidate.addresses.length} aliases`}
              </span>
              <small>{candidate.age.label}</small>
              <b>{candidate.protected.toLocaleString()}</b>
              <em>{candidate.messages.toLocaleString()}</em>
            </label>
          ))}
        </div>
        {candidates.length ? (
          <div className="trash-selection">
            <button
              className="secondary-button"
              onClick={() =>
                setSelected(
                  selected.length === candidates.length
                    ? []
                    : candidates.map((item) => item.domain),
                )
              }
            >
              {selected.length === candidates.length
                ? "Clear selection"
                : "Select all stale senders"}
            </button>
            <span>{selected.length} selected</span>
          </div>
        ) : null}
      </section>
      {selected.length || plan ? (
        <OutlookHistoryPanel
          analysis={analysis}
          plan={plan}
          onGenerate={() => onGenerate(selected)}
          onApprove={onApprove}
          onRetry={onRetry}
          onUndo={onUndo}
          mode="trash"
        />
      ) : null}
    </>
  );
};

const AccountWorkspace = ({
  accounts,
  onSelect,
}: {
  accounts: MailAccountSummary[];
  onSelect(account: MailAccountSummary): Promise<void>;
}) => {
  const [busyId, setBusyId] = useState<string | null>(null);
  const attention = accounts.filter(
    (account) => account.state === "attention",
  ).length;
  return (
    <section
      className="readiness-panel account-workspace"
      aria-labelledby="account-workspace-title"
    >
      <div className="panel-header">
        <div>
          <p className="eyebrow">CONNECTED ACCOUNTS</p>
          <h2 id="account-workspace-title">One workspace, every mailbox</h2>
        </div>
        <span className="secured-label">
          <LockKeyhole size={14} /> Secrets stay local
        </span>
      </div>
      <div className="account-metrics">
        <div>
          <b>{accounts.length}</b>
          <span>connected</span>
        </div>
        <div>
          <b>{attention}</b>
          <span>need attention</span>
        </div>
        <div>
          <b>{accounts.filter((account) => account.selected).length}</b>
          <span>active scopes</span>
        </div>
      </div>
      {accounts.length ? (
        <>
          <div className="account-list" role="list">
            {accounts.map((account) => (
              <div
                className={
                  account.selected ? "account-row selected" : "account-row"
                }
                role="listitem"
                key={account.id}
              >
                <span
                  className={
                    account.state === "connected"
                      ? "state-icon safe"
                      : "state-icon warning"
                  }
                >
                  {account.state === "connected" ? (
                    <Check size={15} />
                  ) : (
                    <CircleDot size={15} />
                  )}
                </span>
                <span>
                  <strong>{account.label}</strong>
                  <small>
                    {account.provider === "gmail"
                      ? "Gmail · OAuth connection"
                      : "Proton Mail · local Bridge connection"}
                    {account.connectedAt
                      ? ` · connected ${new Date(account.connectedAt).toLocaleDateString()}`
                      : ""}
                  </small>
                </span>
                <b>
                  {account.selected ? "ACTIVE" : account.state.toUpperCase()}
                </b>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={account.selected || busyId === account.id}
                  onClick={() => {
                    setBusyId(account.id);
                    void onSelect(account).finally(() => setBusyId(null));
                  }}
                >
                  {busyId === account.id
                    ? "Switching…"
                    : account.selected
                      ? "Selected"
                      : "Use account"}
                </button>
              </div>
            ))}
          </div>
          <div
            className="capability-matrix"
            role="table"
            aria-label="Provider capabilities"
          >
            <div className="capability-row capability-head" role="row">
              <span>Account</span>
              <span>Organization</span>
              <span>Rules</span>
              <span>Addresses</span>
              <span>Spam / Trash</span>
            </div>
            {accounts.map((account) => (
              <div
                className="capability-row"
                role="row"
                key={`cap-${account.id}`}
              >
                <strong>
                  {account.provider === "gmail" ? "Gmail" : "Proton"}
                </strong>
                <span>{account.capabilities.organization}</span>
                <span>
                  {account.capabilities.rules === "live"
                    ? "Installed automatically"
                    : "Verified Sieve export"}
                </span>
                <span>
                  {account.capabilities.addresses === "provider"
                    ? "Provider identities"
                    : "Sent/direct-delivery evidence"}
                </span>
                <span>Native / native</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="analysis-empty">
          <p>
            No mailboxes are connected to this local profile yet. Add Gmail,
            Outlook, Hotmail, or Proton below to begin.
          </p>
        </div>
      )}
    </section>
  );
};

const evidenceCopy = (identity: AccountIdentitySummary): string => {
  const parts = [];
  if (identity.evidence.includes("provider_primary"))
    parts.push("Provider says this is the primary address");
  if (identity.evidence.includes("provider_alias"))
    parts.push("Provider says this is a send-as address");
  if (identity.evidence.includes("sent_from"))
    parts.push(
      `Used as From in ${identity.sentFromCount.toLocaleString()} Sent message${identity.sentFromCount === 1 ? "" : "s"}`,
    );
  if (
    identity.evidence.includes("delivered_to") ||
    identity.evidence.includes("x_original_to")
  )
    parts.push(
      `Mail delivered directly here ${identity.deliveredToCount.toLocaleString()} time${identity.deliveredToCount === 1 ? "" : "s"}`,
    );
  return parts.join(" · ") || "Needs evidence review";
};

const IdentityReview = ({
  account,
  identities,
  onRefresh,
  onUpdate,
}: {
  account: MailAccountSummary;
  identities: AccountIdentitySummary[];
  onRefresh(account: MailAccountSummary): Promise<void>;
  onUpdate(input: AccountIdentityUpdateInput): Promise<void>;
}) => {
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const [draftNames, setDraftNames] = useState<Record<string, string>>({});
  const save = async (
    identity: AccountIdentitySummary,
    status: AccountIdentitySummary["status"],
    containerEnabled = identity.containerEnabled,
  ) => {
    setBusyKey(identity.address);
    setError("");
    const defaultName = identity.address
      .split("@")[0]!
      .replace(/[._-]+/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase())
      .slice(0, 64);
    try {
      await onUpdate({
        provider: account.provider,
        connectionId: account.id,
        address: identity.address,
        status,
        containerEnabled: status === "confirmed" && containerEnabled,
        containerName:
          status === "confirmed" && containerEnabled
            ? (draftNames[identity.address] ??
              identity.containerName ??
              defaultName)
            : null,
      });
    } catch {
      setError(
        `Sift could not save the decision for ${identity.address}. Nothing downstream changed.`,
      );
    } finally {
      setBusyKey("");
    }
  };
  const counts = {
    confirmed: identities.filter((identity) => identity.status === "confirmed")
      .length,
    unreviewed: identities.filter(
      (identity) => identity.status === "unreviewed",
    ).length,
    rejected: identities.filter((identity) => identity.status === "rejected")
      .length,
  };
  return (
    <section
      className="readiness-panel identity-review"
      aria-labelledby={`identity-${account.id}`}
    >
      <div className="panel-header">
        <div>
          <p className="eyebrow">
            {account.provider.toUpperCase()} · {account.label}
          </p>
          <h2 id={`identity-${account.id}`}>Confirm what belongs to you</h2>
        </div>
        <button
          className="secondary-button"
          type="button"
          disabled={busyKey === "refresh"}
          onClick={() => {
            setBusyKey("refresh");
            setError("");
            void onRefresh(account)
              .catch(() =>
                setError(
                  "Address evidence could not be refreshed. Existing decisions are unchanged.",
                ),
              )
              .finally(() => setBusyKey(""));
          }}
        >
          {busyKey === "refresh" ? "Scanning addresses…" : "Scan addresses"}
        </button>
      </div>
      <div className="identity-metrics">
        <span>
          <b>{counts.confirmed}</b> confirmed
        </span>
        <span>
          <b>{counts.unreviewed}</b> need review
        </span>
        <span>
          <b>{counts.rejected}</b> not mine
        </span>
      </div>
      {identities.length ? (
        <div className="owned-identity-list">
          {identities.map((identity) => (
            <div
              className={`owned-identity-row ${identity.status}`}
              key={identity.id}
            >
              <span
                className={
                  identity.status === "confirmed"
                    ? "state-icon safe"
                    : identity.status === "rejected"
                      ? "state-icon rejected"
                      : "state-icon warning"
                }
              >
                {identity.status === "confirmed" ? (
                  <Check size={15} />
                ) : (
                  <CircleDot size={15} />
                )}
              </span>
              <span className="identity-copy">
                <strong>{identity.address}</strong>
                <small>{evidenceCopy(identity)}</small>
              </span>
              <span className="identity-status">
                {identity.status === "unreviewed"
                  ? "NEEDS REVIEW"
                  : identity.status === "rejected"
                    ? "NOT MINE"
                    : "CONFIRMED"}
              </span>
              <div className="identity-actions">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={
                    busyKey === identity.address ||
                    identity.status === "confirmed"
                  }
                  onClick={() => void save(identity, "confirmed")}
                >
                  Confirm
                </button>
                <button
                  className="secondary-button danger"
                  type="button"
                  disabled={
                    busyKey === identity.address ||
                    identity.status === "rejected"
                  }
                  onClick={() => void save(identity, "rejected", false)}
                >
                  Not mine
                </button>
              </div>
              {identity.status === "confirmed" ? (
                <label className="identity-container">
                  <input
                    type="checkbox"
                    checked={identity.containerEnabled}
                    onChange={(event) =>
                      void save(identity, "confirmed", event.target.checked)
                    }
                  />
                  <span>Create a separate container</span>
                  {identity.containerEnabled ? (
                    <input
                      aria-label={`Container name for ${identity.address}`}
                      value={
                        draftNames[identity.address] ??
                        identity.containerName ??
                        ""
                      }
                      onChange={(event) =>
                        setDraftNames((current) => ({
                          ...current,
                          [identity.address]: event.target.value
                            .replace(/[\\/]/g, "")
                            .slice(0, 64),
                        }))
                      }
                      onBlur={() => void save(identity, "confirmed", true)}
                    />
                  ) : null}
                </label>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="analysis-empty">
          <p>
            No owned address evidence has been found yet. Run a mailbox scan,
            then scan addresses again.
          </p>
        </div>
      )}
      {error ? (
        <p className="connection-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
};

const OrganizationProposalEditor = ({
  account,
  proposal,
  onGenerate,
  onEdit,
}: {
  account: MailAccountSummary;
  proposal: OrganizationProposal | null;
  onGenerate(account: MailAccountSummary): Promise<void>;
  onEdit(input: EditOrganizationProposal): Promise<void>;
}) => {
  const [selectedScope, setSelectedScope] = useState<string>("");
  const [draftPaths, setDraftPaths] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const scopes = proposal
    ? [...new Set(proposal.items.map((item) => item.scopeAddress ?? ""))]
    : [];
  const currentScope = scopes.includes(selectedScope)
    ? selectedScope
    : (scopes[0] ?? "");
  const items =
    proposal?.items.filter(
      (item) => (item.scopeAddress ?? "") === currentScope,
    ) ?? [];
  const save = async (
    item: OrganizationProposal["items"][number],
    changes: Partial<
      Pick<EditOrganizationProposal, "category" | "targetPath" | "enabled">
    >,
  ) => {
    if (!proposal) return;
    setBusyKey(item.id);
    setError("");
    try {
      await onEdit({
        proposalId: proposal.id,
        revision: proposal.revision,
        itemId: item.id,
        category: changes.category ?? item.category,
        targetPath:
          changes.targetPath ?? draftPaths[item.id] ?? item.targetPath,
        enabled: changes.enabled ?? item.enabled,
      });
    } catch {
      setError(
        "This proposal changed before the correction could be saved. Reload it and try again; no mailbox changes were made.",
      );
    } finally {
      setBusyKey("");
    }
  };
  return (
    <section
      className="readiness-panel organization-editor"
      aria-labelledby={`proposal-${account.id}`}
    >
      <div className="panel-header">
        <div>
          <p className="eyebrow">
            {account.provider.toUpperCase()} · {account.label}
          </p>
          <h2 id={`proposal-${account.id}`}>Shape the filing plan</h2>
        </div>
        <button
          className="secondary-button"
          type="button"
          disabled={busyKey === "generate"}
          onClick={() => {
            setBusyKey("generate");
            setError("");
            void onGenerate(account)
              .catch(() =>
                setError(
                  "Sift needs a completed mailbox scan before it can build this proposal.",
                ),
              )
              .finally(() => setBusyKey(""));
          }}
        >
          {busyKey === "generate"
            ? "Building proposal…"
            : proposal
              ? "Rebuild from mailbox"
              : "Build organization proposal"}
        </button>
      </div>
      {!proposal ? (
        <div className="analysis-empty">
          <p>
            Generate a local draft grouped by confirmed address containers.
            Every category stays editable, and nothing moves until a later
            approval step.
          </p>
        </div>
      ) : (
        <>
          <div className="proposal-revision">
            <span>
              <b>{proposal.items.filter((item) => item.enabled).length}</b>{" "}
              active categories
            </span>
            <span>
              <b>
                {proposal.items
                  .reduce((sum, item) => sum + item.messageCount, 0)
                  .toLocaleString()}
              </b>{" "}
              affected messages
            </span>
            <small>Draft revision {proposal.revision.slice(0, 10)}</small>
          </div>
          <div
            className="proposal-scope-tabs"
            role="tablist"
            aria-label={`Organization scopes for ${account.label}`}
          >
            {scopes.map((scope) => {
              const scopeItems = proposal.items.filter(
                (item) => (item.scopeAddress ?? "") === scope,
              );
              const container = scopeItems.find(
                (item) => item.containerName,
              )?.containerName;
              return (
                <button
                  key={scope || "shared"}
                  role="tab"
                  aria-selected={currentScope === scope}
                  className={currentScope === scope ? "active" : ""}
                  type="button"
                  onClick={() => setSelectedScope(scope)}
                >
                  <strong>{scope || "Shared mail"}</strong>
                  <small>
                    {container
                      ? `${container} container`
                      : scope
                        ? "Shared category tree"
                        : "No confirmed address match"}{" "}
                    ·{" "}
                    {scopeItems
                      .reduce((sum, item) => sum + item.messageCount, 0)
                      .toLocaleString()}{" "}
                    messages
                  </small>
                </button>
              );
            })}
          </div>
          <div className="editable-proposal-list">
            <div className="editable-proposal-head">
              <span>Use</span>
              <span>Category and evidence</span>
              <span>Target path</span>
              <span>Activity</span>
            </div>
            {items.map((item) => {
              const age = recency(item.latestAt);
              return (
                <div
                  className={
                    item.enabled
                      ? "editable-proposal-row"
                      : "editable-proposal-row disabled"
                  }
                  key={item.id}
                >
                  <input
                    aria-label={`Include ${item.category}`}
                    type="checkbox"
                    checked={item.enabled}
                    disabled={busyKey === item.id}
                    onChange={(event) =>
                      void save(item, { enabled: event.target.checked })
                    }
                  />
                  <span className="proposal-evidence">
                    <select
                      aria-label={`Category for ${item.targetPath}`}
                      value={item.category}
                      disabled={busyKey === item.id}
                      onChange={(event) =>
                        void save(item, {
                          category: event.target.value as MailCategory,
                        })
                      }
                    >
                      {mailCategoryOptions.map((category) => (
                        <option key={category} value={category}>
                          {category.replace("_", " ")}
                        </option>
                      ))}
                    </select>
                    <small>
                      {item.evidence.slice(0, 3).join(" · ") ||
                        "Classifier evidence unavailable"}
                    </small>
                    {item.samples.length ? (
                      <details>
                        <summary>
                          {item.samples.length} representative subject
                          {item.samples.length === 1 ? "" : "s"}
                        </summary>
                        <ul>
                          {item.samples.map((sample) => (
                            <li key={sample}>{sample}</li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </span>
                  <input
                    aria-label={`Target path for ${item.category}`}
                    value={draftPaths[item.id] ?? item.targetPath}
                    disabled={busyKey === item.id}
                    onChange={(event) =>
                      setDraftPaths((current) => ({
                        ...current,
                        [item.id]: event.target.value
                          .replace(/\\/g, "")
                          .slice(0, 192),
                      }))
                    }
                    onBlur={() => {
                      const targetPath = draftPaths[item.id];
                      if (targetPath && targetPath !== item.targetPath)
                        void save(item, { targetPath });
                    }}
                  />
                  <span className="proposal-activity">
                    <b>{item.messageCount.toLocaleString()}</b>
                    <small>
                      {age.label} · {Math.round(item.confidence * 100)}%
                      confidence
                    </small>
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
      {error ? (
        <p className="connection-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
};

const RuleReconciliationPanel = ({
  account,
  inventory,
  plan,
  onRefresh,
  onGenerate,
  onApprove,
  onRetry,
  onUndo,
  onExportProton,
}: {
  account: MailAccountSummary;
  inventory: RuleInventory | null;
  plan: RuleReconciliationPlan | null;
  onRefresh(account: MailAccountSummary): Promise<void>;
  onGenerate(account: MailAccountSummary): Promise<void>;
  onApprove(plan: RuleReconciliationPlan): Promise<void>;
  onRetry(plan: RuleReconciliationPlan): Promise<void>;
  onUndo(plan: RuleReconciliationPlan): Promise<void>;
  onExportProton(plan: RuleReconciliationPlan): Promise<string>;
}) => {
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const act = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setError("");
    setStatus("");
    try {
      await action();
    } catch {
      setError(
        "The rule operation stopped safely. Provider state will be inventoried again before any retry.",
      );
    } finally {
      setBusy("");
    }
  };
  const externalCount =
    inventory?.rules.filter((rule) => rule.ownership === "external").length ??
    0;
  const managedCount = inventory?.rules.length
    ? inventory.rules.length - externalCount
    : 0;
  const actionable =
    plan?.operations.filter((operation) => operation.kind !== "unchanged") ??
    [];
  const failed =
    plan?.operations.filter((operation) =>
      ["failed", "verification_mismatch"].includes(operation.state),
    ) ?? [];
  const completed =
    plan?.operations.filter((operation) => operation.state === "succeeded")
      .length ?? 0;
  return (
    <section
      className="readiness-panel rule-reconciliation"
      aria-labelledby={`rules-${account.id}`}
    >
      <div className="panel-header">
        <div>
          <p className="eyebrow">
            {account.provider.toUpperCase()} · {account.label}
          </p>
          <h2 id={`rules-${account.id}`}>
            {account.provider === "gmail"
              ? "Reconcile Gmail filters"
              : "Build the managed Proton Sieve export"}
          </h2>
        </div>
        <span className="secured-label">
          <ShieldCheck size={14} />
          {account.provider === "gmail"
            ? "Verified provider state"
            : "Manual Proton import"}
        </span>
      </div>
      <div className="rule-capability">
        <p>
          {account.provider === "gmail"
            ? "Sift inventories live Gmail filters, owns only the filters it creates, and replaces changed managed filters without touching unrelated rules."
            : "Proton Bridge does not expose server-side filters. Sift tracks only its versioned Sieve exports and never claims visibility into filters created in Proton Mail."}
        </p>
        <button
          className="secondary-button"
          type="button"
          disabled={Boolean(busy)}
          onClick={() => void act("inventory", () => onRefresh(account))}
        >
          {busy === "inventory"
            ? "Reading rules…"
            : inventory
              ? "Refresh rule inventory"
              : "Inventory rules first"}
        </button>
      </div>
      {inventory ? (
        <div className="rule-inventory-metrics">
          <span>
            <b>{inventory.rules.length}</b>
            <small>
              {account.provider === "gmail"
                ? "provider filters found"
                : "managed exports tracked"}
            </small>
          </span>
          <span>
            <b>{managedCount}</b>
            <small>Sift managed</small>
          </span>
          <span>
            <b>{externalCount}</b>
            <small>external · never modified</small>
          </span>
          <span>
            <b>{inventory.providerLimit ?? "—"}</b>
            <small>provider limit</small>
          </span>
        </div>
      ) : null}
      {!inventory ? (
        <div className="analysis-empty">
          <p>
            Inventory comes before proposal approval. This prevents duplicate
            managed rules and gives external filters an explicit protected
            boundary.
          </p>
        </div>
      ) : !plan ? (
        <div className="analysis-empty">
          <p>
            Compare the corrected address-scoped organization proposal with this
            inventory, then review every create, replacement, adoption, removal,
            and unchanged rule.
          </p>
          <button
            className="primary-button compact"
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void act("plan", () => onGenerate(account))}
          >
            {busy === "plan"
              ? "Reconciling…"
              : "Build rule reconciliation plan"}
          </button>
        </div>
      ) : (
        <div className="rule-plan-review">
          <div className="proposal-revision">
            <span>
              <b>{actionable.length}</b> provider changes
            </span>
            <span>
              <b>{plan.operations.length - actionable.length}</b> already
              correct
            </span>
            <small>Plan revision {plan.revision.slice(0, 10)}</small>
          </div>
          <div className="rule-operation-list">
            <div className="rule-operation-head">
              <span>Operation</span>
              <span>Sender and address</span>
              <span>Destination</span>
              <span>Status</span>
            </div>
            {plan.operations.slice(0, 200).map((operation) => (
              <div
                className={`rule-operation-row ${operation.kind}`}
                key={operation.id}
              >
                <b>{operation.kind.toUpperCase()}</b>
                <span>
                  <strong>
                    {operation.desired?.senderDomain ??
                      operation.prior?.criteria.from ??
                      "Retired managed rule"}
                  </strong>
                  <small>
                    {operation.desired?.receivingAddress ??
                      operation.prior?.criteria.to ??
                      "No address scope"}
                  </small>
                </span>
                <span>
                  {operation.desired?.targetPath ?? "Remove from Sift registry"}
                </span>
                <em>{operation.state.replace("_", " ")}</em>
              </div>
            ))}
          </div>
          {plan.state === "draft" ? (
            <div className="cleanup-approval">
              <label>
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                />
                <span>
                  <strong>I approve these exact managed-rule changes</strong>
                  <small>
                    {account.provider === "gmail"
                      ? `${externalCount} external filters remain untouched. Each Sift operation is re-read and verified before success.`
                      : "This saves a checksum-tracked Sieve file for manual review and import in Proton Mail."}
                  </small>
                </span>
              </label>
              <button
                className="primary-button"
                type="button"
                disabled={!consent || Boolean(busy)}
                onClick={() =>
                  void act("apply", async () => {
                    if (account.provider === "proton")
                      setStatus(await onExportProton(plan));
                    else await onApprove(plan);
                  })
                }
              >
                {busy === "apply"
                  ? account.provider === "proton"
                    ? "Preparing export…"
                    : "Applying and verifying…"
                  : account.provider === "proton"
                    ? "Save managed Sieve export"
                    : `Apply ${actionable.length} managed changes`}
              </button>
            </div>
          ) : (
            <div className="rule-plan-actions">
              <span>
                <strong>
                  {plan.state === "completed"
                    ? "Managed rules verified"
                    : plan.state === "undone"
                      ? "Supported changes undone"
                      : plan.state === "failed"
                        ? "Some operations need attention"
                        : "Rule job in progress"}
                </strong>
                <small>
                  {completed} / {plan.operations.length} operations verified
                </small>
              </span>
              <div>
                {failed.length ? (
                  <button
                    className="primary-button compact"
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => void act("retry", () => onRetry(plan))}
                  >
                    {busy === "retry"
                      ? "Retrying…"
                      : `Retry ${failed.length} failed`}
                  </button>
                ) : null}
                {account.provider === "gmail" &&
                plan.state === "completed" &&
                completed ? (
                  <button
                    className="secondary-button danger"
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => void act("undo", () => onUndo(plan))}
                  >
                    {busy === "undo" ? "Restoring…" : "Undo supported changes"}
                  </button>
                ) : null}
              </div>
            </div>
          )}
        </div>
      )}
      {status ? <p className="export-status">{status}</p> : null}
      {error ? (
        <p className="connection-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
};

const AppShell = ({
  profileName,
  onSwitchProfile,
  accounts,
  identities,
  onSelectAccount,
  onRefreshIdentities,
  onUpdateIdentity,
  proposals,
  onGenerateProposal,
  onEditProposal,
  ruleInventories,
  rulePlans,
  onRefreshRuleInventory,
  onGenerateRulePlan,
  onApproveRulePlan,
  onRetryRulePlan,
  onUndoRulePlan,
  onExportProtonRulePlan,
  protonConnection,
  protonDiscovery,
  onDiagnoseProton,
  onConnectProton,
  onDisconnectProton,
  onDiscoverProton,
  protonAudit,
  onStartProtonAudit,
  onPauseProtonAudit,
  onResumeProtonAudit,
  analysis,
  onAnalyzeMailbox,
  cleanupPlan,
  onGenerateCleanup,
  onApproveCleanup,
  onResumeCleanup,
  onRetryCleanup,
  onUndoCleanup,
  deletionPlan,
  onGenerateDeletion,
  onApproveDeletion,
  onResumeDeletion,
  onRetryDeletion,
  onUndoDeletion,
  subscriptions,
  onScanSubscriptions,
  onStartUnsubscribe,
  onResumeUnsubscribe,
  onRetryUnsubscribe,
  gmailConnection,
  onConnectGmail,
  onDisconnectGmail,
  gmailAudit,
  onStartGmailAudit,
  gmailAnalysis,
  onAnalyzeGmail,
  gmailOrganization,
  onGenerateGmailOrganization,
  onApproveGmailOrganization,
  onRetryGmailOrganization,
  onUndoGmailOrganization,
  gmailDeletion,
  onGenerateGmailDeletion,
  gmailSubscriptions,
  onScanGmailSubscriptions,
  onStartGmailUnsubscribe,
  onResumeGmailUnsubscribe,
  onRetryGmailUnsubscribe,
  outlookConnection,
  outlookAudit,
  outlookAnalysis,
  onConnectOutlook,
  onDisconnectOutlook,
  onStartOutlookAudit,
  onAnalyzeOutlook,
  outlookOrganization,
  outlookDeletion,
  onGenerateOutlookOrganization,
  onGenerateOutlookDeletion,
  onApproveOutlookOrganization,
  onRetryOutlookOrganization,
  onUndoOutlookOrganization,
  outlookSubscriptions,
  onScanOutlookSubscriptions,
  onStartOutlookUnsubscribe,
  onResumeOutlookUnsubscribe,
  onRetryOutlookUnsubscribe,
}: AppShellProps) => {
  const [activePage, setActivePage] = useState<PageId>("overview");
  const connectedCount = accounts.length;
  const scannedCount =
    Number(Boolean(protonAudit?.indexedMessages)) +
    Number(Boolean(gmailAudit?.indexedMessages)) +
    Number(Boolean(outlookAudit?.indexedMessages));
  const organizedCount = Object.values(proposals).filter(Boolean).length;
  const pageLabel =
    navItems.find((item) => item.id === activePage)?.label ?? "Overview";
  const emptyAccounts = accounts.length === 0;
  const selectedAccounts = accounts.filter((account) => account.selected);
  const addressReviewCount = selectedAccounts.reduce((sum, account) => {
    const accountIdentities = identities[account.id] ?? [];
    const unreviewed = accountIdentities.filter(
      (identity) => identity.status === "unreviewed",
    ).length;
    const confirmed = accountIdentities.some(
      (identity) => identity.status === "confirmed",
    );
    return sum + Math.max(unreviewed, confirmed ? 0 : 1);
  }, 0);

  const taskIntro = (title: string, copy: string) => (
    <div className="page-heading task-heading">
      <h1>{title}</h1>
      <p>{copy}</p>
    </div>
  );
  const prerequisite = (
    title: string,
    copy: string,
    target: PageId,
    action: string,
  ) => (
    <section className="task-empty">
      <FolderTree size={24} />
      <div>
        <h2>{title}</h2>
        <p>{copy}</p>
      </div>
      <button
        className="primary-button compact"
        type="button"
        onClick={() => setActivePage(target)}
      >
        {action}
      </button>
    </section>
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button
          className="sidebar-brand"
          type="button"
          onClick={() => setActivePage("overview")}
        >
          <BrandMark />
          <span>Sift</span>
        </button>
        <nav aria-label="Primary navigation">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              aria-label={label}
              title={label}
              className={activePage === id ? "nav-item active" : "nav-item"}
              type="button"
              onClick={() => setActivePage(id)}
            >
              <Icon size={18} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="local-status">
            <CircleDot size={12} /> Local only
          </div>
          <button
            className="profile-switcher"
            type="button"
            onClick={onSwitchProfile}
          >
            <span className="profile-avatar">
              {profileName.slice(0, 1).toUpperCase()}
            </span>
            <span>
              <strong>{profileName}</strong>
              <small>Switch profile</small>
            </span>
            <ChevronRight size={15} />
          </button>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div>
            <span>Sift</span>
            <ChevronRight size={14} />
            <strong>{pageLabel}</strong>
          </div>
          <div className="read-only-badge">
            <ShieldCheck size={14} /> Local-first
          </div>
        </header>
        <main className="overview">
          {activePage === "overview" ? (
            <>
              <section className="product-hero">
                <div>
                  <p className="eyebrow">INBOX PRUNING, WITH A PLAN</p>
                  <h1>Keep the mail that matters. Clear out the rest.</h1>
                  <p>
                    Sift turns years of accumulated email into a map of
                    accounts, purchases, subscriptions, promotions, and
                    noise—then lets you shape the rules before anything moves.
                  </p>
                  <div className="hero-actions">
                    <button
                      className="primary-button compact"
                      type="button"
                      onClick={() =>
                        setActivePage(emptyAccounts ? "accounts" : "audit")
                      }
                    >
                      {emptyAccounts
                        ? "Connect your first account"
                        : scannedCount
                          ? "Continue pruning"
                          : "Scan connected accounts"}
                    </button>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => setActivePage("accounts")}
                    >
                      Add another account
                    </button>
                  </div>
                </div>
                <div
                  className="workspace-pulse"
                  aria-label="Workspace progress"
                >
                  <div>
                    <b>{connectedCount}</b>
                    <span>accounts connected</span>
                  </div>
                  <div>
                    <b>{scannedCount}</b>
                    <span>mailboxes scanned</span>
                  </div>
                  <div>
                    <b>{organizedCount}</b>
                    <span>plans prepared</span>
                  </div>
                </div>
              </section>
              <section
                className="workflow-section"
                aria-labelledby="workflow-title"
              >
                <div className="section-heading">
                  <h2 id="workflow-title">
                    From crowded mailbox to a system that holds
                  </h2>
                  <p>
                    Every page owns one decision. Finish the broad, high-impact
                    work first; narrow toward deletion only after the system is
                    in place.
                  </p>
                </div>
                <ol className="workflow-steps">
                  <li>
                    <span>1</span>
                    <div>
                      <strong>Connect</strong>
                      <p>Add each mailbox to this private local profile.</p>
                    </div>
                  </li>
                  <li>
                    <span>2</span>
                    <div>
                      <strong>Scan</strong>
                      <p>Build a read-only inventory of years of history.</p>
                    </div>
                  </li>
                  <li>
                    <span>3</span>
                    <div>
                      <strong>Addresses</strong>
                      <p>
                        Confirm only identities you own and choose containers.
                      </p>
                    </div>
                  </li>
                  <li>
                    <span>4</span>
                    <div>
                      <strong>Organize</strong>
                      <p>Correct categories and approve historical filing.</p>
                    </div>
                  </li>
                  <li>
                    <span>5</span>
                    <div>
                      <strong>Rules</strong>
                      <p>Install or export durable future automation.</p>
                    </div>
                  </li>
                  <li>
                    <span>6</span>
                    <div>
                      <strong>Unsubscribe</strong>
                      <p>Stop authenticated bulk mail at the source.</p>
                    </div>
                  </li>
                  <li>
                    <span>7</span>
                    <div>
                      <strong>Trash</strong>
                      <p>Review old non-critical history last.</p>
                    </div>
                  </li>
                </ol>
              </section>
              <section className="next-action">
                <span>
                  <strong>
                    {emptyAccounts
                      ? "Start with an account"
                      : scannedCount < connectedCount
                        ? "Your next best action: scan"
                        : addressReviewCount
                          ? "Confirm your real addresses"
                          : "Your mailbox map is ready to shape"}
                  </strong>
                  <small>
                    {emptyAccounts
                      ? "Connect Proton, Gmail, Outlook, or Hotmail."
                      : scannedCount < connectedCount
                        ? "Build a complete inventory before designing labels and rules."
                        : addressReviewCount
                          ? `${addressReviewCount} evidence-backed address${addressReviewCount === 1 ? "" : "es"} need a decision before organization.`
                          : "Open Organize to review categories and prepare cleanup."}
                  </small>
                </span>
                <button
                  className="primary-button compact"
                  type="button"
                  onClick={() =>
                    setActivePage(
                      emptyAccounts
                        ? "accounts"
                        : scannedCount < connectedCount
                          ? "audit"
                          : addressReviewCount
                            ? "addresses"
                            : "organize",
                    )
                  }
                >
                  {emptyAccounts
                    ? "Open accounts"
                    : scannedCount < connectedCount
                      ? "Open scan"
                      : addressReviewCount
                        ? "Review addresses"
                        : "Open organize"}
                </button>
              </section>
            </>
          ) : null}

          {activePage === "accounts" ? (
            <>
              {taskIntro(
                "Bring every inbox into one pruning workspace.",
                "Connect an account, choose which mailbox you are working on, and add another whenever your email life expands. Proton uses Bridge; Gmail and Microsoft use browser OAuth.",
              )}
              <AccountWorkspace
                accounts={accounts}
                onSelect={onSelectAccount}
              />
              <GmailConnectionPanel
                connection={gmailConnection}
                audit={gmailAudit}
                onConnect={onConnectGmail}
                onDisconnect={onDisconnectGmail}
                onAudit={onStartGmailAudit}
              />
              <OutlookConnectionPanel
                connection={outlookConnection}
                audit={outlookAudit}
                onConnect={onConnectOutlook}
                onDisconnect={onDisconnectOutlook}
                onAudit={onStartOutlookAudit}
              />
              <ProtonConnectionPanel
                connection={protonConnection}
                discovery={protonDiscovery}
                onDiagnose={onDiagnoseProton}
                onConnect={onConnectProton}
                onDisconnect={onDisconnectProton}
                onDiscover={onDiscoverProton}
              />
            </>
          ) : null}

          {activePage === "audit" ? (
            <>
              {taskIntro(
                "Map the mailbox before you prune it.",
                "Scan message history into a private inventory of senders, dates, folders, and bounded text evidence. A scan changes nothing in the mailbox and can resume after interruption.",
              )}
              {emptyAccounts ? (
                prerequisite(
                  "Connect an account first",
                  "Sift needs a mailbox connection before it can build an inventory.",
                  "accounts",
                  "Open accounts",
                )
              ) : (
                <>
                  <OutlookConnectionPanel
                    connection={outlookConnection}
                    audit={outlookAudit}
                    onConnect={onConnectOutlook}
                    onDisconnect={onDisconnectOutlook}
                    onAudit={onStartOutlookAudit}
                    showAudit
                  />
                  <AnalysisPanel
                    audit={outlookAudit}
                    analysis={outlookAnalysis}
                    onAnalyze={onAnalyzeOutlook}
                    provider="outlook"
                  />
                  <GmailConnectionPanel
                    connection={gmailConnection}
                    audit={gmailAudit}
                    onConnect={onConnectGmail}
                    onDisconnect={onDisconnectGmail}
                    onAudit={onStartGmailAudit}
                    showAudit
                  />
                  <ProtonConnectionPanel
                    connection={protonConnection}
                    discovery={protonDiscovery}
                    onDiagnose={onDiagnoseProton}
                    onConnect={onConnectProton}
                    onDisconnect={onDisconnectProton}
                    onDiscover={onDiscoverProton}
                    mode="audit"
                  />
                  <ProtonAuditPanel
                    discovery={protonDiscovery}
                    audit={protonAudit}
                    onStart={onStartProtonAudit}
                    onPause={onPauseProtonAudit}
                    onResume={onResumeProtonAudit}
                  />
                </>
              )}
            </>
          ) : null}

          {activePage === "addresses" ? (
            <>
              {taskIntro(
                "Confirm only the addresses that actually belong to you.",
                "Sift accepts provider identities, Sent-folder From evidence, and direct-delivery headers. Group recipients, correspondents, forwarding participants, and arbitrary To/Cc addresses cannot become owned identities.",
              )}
              {!scannedCount ? (
                prerequisite(
                  "Scan a mailbox first",
                  "Address ownership needs provider or indexed message evidence.",
                  emptyAccounts ? "accounts" : "audit",
                  emptyAccounts ? "Connect an account" : "Open scan",
                )
              ) : (
                <>
                  {selectedAccounts.map((account) => (
                    <IdentityReview
                      key={account.id}
                      account={account}
                      identities={identities[account.id] ?? []}
                      onRefresh={onRefreshIdentities}
                      onUpdate={onUpdateIdentity}
                    />
                  ))}
                </>
              )}
            </>
          ) : null}

          {activePage === "organize" ? (
            <>
              {taskIntro(
                "Turn mailbox history into a durable system.",
                "Correct the address-scoped filing proposal, preview exact historical impact, and apply only the approved folders or labels. Future automation remains a separate Rules action.",
              )}
              {!protonAudit?.indexedMessages &&
              !gmailAudit?.indexedMessages &&
              !outlookAudit?.indexedMessages ? (
                prerequisite(
                  "Scan at least one mailbox",
                  "Organization proposals are learned from the message inventory, not from a generic template.",
                  emptyAccounts ? "accounts" : "audit",
                  emptyAccounts ? "Connect an account" : "Open scan",
                )
              ) : addressReviewCount ? (
                prerequisite(
                  "Finish address review first",
                  `${addressReviewCount} address decision${addressReviewCount === 1 ? "" : "s"} remain. Organization never guesses who owns an address.`,
                  "addresses",
                  "Review addresses",
                )
              ) : (
                <>
                  {selectedAccounts.map((account) => (
                    <div
                      className="account-organization-sequence"
                      key={account.id}
                    >
                      <OrganizationProposalEditor
                        account={account}
                        proposal={proposals[account.id] ?? null}
                        onGenerate={onGenerateProposal}
                        onEdit={onEditProposal}
                      />
                      {account.provider === "gmail" && proposals[account.id] ? (
                        <GmailOrganizationPanel
                          analysis={gmailAnalysis}
                          plan={gmailOrganization}
                          onGenerate={onGenerateGmailOrganization}
                          onApprove={onApproveGmailOrganization}
                          onRetry={onRetryGmailOrganization}
                          onUndo={onUndoGmailOrganization}
                        />
                      ) : null}
                      {account.provider === "outlook" &&
                      proposals[account.id] ? (
                        <OutlookHistoryPanel
                          analysis={outlookAnalysis}
                          plan={outlookOrganization}
                          onGenerate={onGenerateOutlookOrganization}
                          onApprove={onApproveOutlookOrganization}
                          onRetry={onRetryOutlookOrganization}
                          onUndo={onUndoOutlookOrganization}
                        />
                      ) : null}
                    </div>
                  ))}
                  <ProtonOrganizationFlow
                    audit={protonAudit}
                    analysis={analysis}
                    cleanupPlan={cleanupPlan}
                    onAnalyze={onAnalyzeMailbox}
                    onGenerateCleanup={onGenerateCleanup}
                    onApproveCleanup={onApproveCleanup}
                    onResumeCleanup={onResumeCleanup}
                    onRetryCleanup={onRetryCleanup}
                    onUndoCleanup={onUndoCleanup}
                    onContinue={() => setActivePage("rules")}
                  />
                </>
              )}
            </>
          ) : null}

          {activePage === "rules" ? (
            <>
              {taskIntro(
                "Keep the new system working automatically.",
                "Inventory existing provider rules first, protect anything Sift does not own, then approve a deterministic create, replace, adopt, or remove plan.",
              )}
              {selectedAccounts.some((account) => proposals[account.id]) ? (
                <>
                  {selectedAccounts.map((account) => (
                    <RuleReconciliationPanel
                      key={account.id}
                      account={account}
                      inventory={ruleInventories[account.id] ?? null}
                      plan={rulePlans[account.id] ?? null}
                      onRefresh={onRefreshRuleInventory}
                      onGenerate={onGenerateRulePlan}
                      onApprove={onApproveRulePlan}
                      onRetry={onRetryRulePlan}
                      onUndo={onUndoRulePlan}
                      onExportProton={onExportProtonRulePlan}
                    />
                  ))}
                </>
              ) : (
                prerequisite(
                  "Finish an organization proposal first",
                  "Rules are derived from the corrected address-scoped filing plan, never directly from a generic template.",
                  scannedCount ? "organize" : "audit",
                  scannedCount ? "Open organize" : "Open scan",
                )
              )}
            </>
          ) : null}

          {activePage === "unsubscribe" ? (
            <>
              {taskIntro(
                "Stop the mail you never wanted to keep.",
                "Find authenticated mailing lists, protect receipts and account notices, and send approved one-click unsubscribe requests without confirming your address to suspected spam.",
              )}
              {!analysis && !gmailAnalysis && !outlookAnalysis ? (
                prerequisite(
                  "Build an organization proposal first",
                  "Sift needs classified sender streams to separate safe subscriptions from protected and suspicious mail.",
                  emptyAccounts
                    ? "accounts"
                    : scannedCount
                      ? "organize"
                      : "audit",
                  emptyAccounts
                    ? "Connect an account"
                    : scannedCount
                      ? "Open organize"
                      : "Open scan",
                )
              ) : (
                <>
                  <UnsubscribePanel
                    provider="outlook"
                    analysis={outlookAnalysis}
                    dashboard={outlookSubscriptions}
                    onScan={onScanOutlookSubscriptions}
                    onStart={onStartOutlookUnsubscribe}
                    onResume={onResumeOutlookUnsubscribe}
                    onRetry={onRetryOutlookUnsubscribe}
                  />
                  <UnsubscribePanel
                    provider="gmail"
                    analysis={gmailAnalysis}
                    dashboard={gmailSubscriptions}
                    onScan={onScanGmailSubscriptions}
                    onStart={onStartGmailUnsubscribe}
                    onResume={onResumeGmailUnsubscribe}
                    onRetry={onRetryGmailUnsubscribe}
                  />
                  <UnsubscribePanel
                    analysis={analysis}
                    dashboard={subscriptions}
                    onScan={onScanSubscriptions}
                    onStart={onStartUnsubscribe}
                    onResume={onResumeUnsubscribe}
                    onRetry={onRetryUnsubscribe}
                  />
                  <section className="next-action">
                    <span>
                      <strong>Finish with stale history</strong>
                      <small>
                        Unsubscribing stops future mail. The last pass
                        identifies old, non-critical sender history that can
                        move to recoverable Trash.
                      </small>
                    </span>
                    <button
                      className="primary-button compact"
                      type="button"
                      onClick={() => setActivePage("delete")}
                    >
                      Continue to Trash review
                    </button>
                  </section>
                </>
              )}
            </>
          ) : null}

          {activePage === "delete" ? (
            <>
              {taskIntro(
                "Delete last, when the broad cleanup work is already done.",
                "Review stale sender history by volume and last activity, protect critical classifications, then move only the exact approved messages into each provider’s recoverable Trash.",
              )}
              {!analysis && !gmailAnalysis && !outlookAnalysis ? (
                prerequisite(
                  "Build an organization proposal first",
                  "The final deletion pass depends on proven aliases and classified sender history.",
                  scannedCount ? "organize" : "audit",
                  scannedCount ? "Open organize" : "Open scan",
                )
              ) : (
                <>
                  {outlookAnalysis ? (
                    <OutlookTrashReviewPanel
                      analysis={outlookAnalysis}
                      plan={outlookDeletion}
                      onGenerate={onGenerateOutlookDeletion}
                      onApprove={onApproveOutlookOrganization}
                      onRetry={onRetryOutlookOrganization}
                      onUndo={onUndoOutlookOrganization}
                    />
                  ) : null}
                  {gmailAnalysis ? (
                    <GmailTrashReviewPanel
                      analysis={gmailAnalysis}
                      plan={gmailDeletion}
                      onGenerate={onGenerateGmailDeletion}
                      onApprove={onApproveGmailOrganization}
                      onRetry={onRetryGmailOrganization}
                      onUndo={onUndoGmailOrganization}
                    />
                  ) : null}
                  {analysis ? (
                    <TrashReviewPanel
                      analysis={analysis}
                      plan={deletionPlan}
                      onGenerate={onGenerateDeletion}
                      onApprove={onApproveDeletion}
                      onResume={onResumeDeletion}
                      onRetry={onRetryDeletion}
                      onUndo={onUndoDeletion}
                    />
                  ) : null}
                </>
              )}
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
};

export const App = () => {
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [activeProfile, setActiveProfile] = useState<ProfileSummary | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [protonConnection, setProtonConnection] =
    useState<ProtonConnectionSummary | null>(null);
  const [protonDiscovery, setProtonDiscovery] =
    useState<ProtonDiscoverySummary | null>(null);
  const [protonAudit, setProtonAudit] = useState<ProtonAuditProgress | null>(
    null,
  );
  const [analysis, setAnalysis] = useState<MailboxAnalysisSummary | null>(null);
  const [cleanupPlan, setCleanupPlan] = useState<CleanupPlan | null>(null);
  const [deletionPlan, setDeletionPlan] = useState<CleanupPlan | null>(null);
  const [subscriptions, setSubscriptions] =
    useState<SubscriptionDashboard | null>(null);
  const [gmailConnection, setGmailConnection] =
    useState<GmailConnectionSummary | null>(null);
  const [outlookConnection, setOutlookConnection] =
    useState<OutlookConnectionSummary | null>(null);
  const [outlookAudit, setOutlookAudit] = useState<OutlookAuditSummary | null>(
    null,
  );
  const [outlookAnalysis, setOutlookAnalysis] =
    useState<MailboxAnalysisSummary | null>(null);
  const [outlookOrganization, setOutlookOrganization] =
    useState<GmailOrganizationPlan | null>(null);
  const [outlookDeletion, setOutlookDeletion] =
    useState<GmailOrganizationPlan | null>(null);
  const [outlookSubscriptions, setOutlookSubscriptions] =
    useState<SubscriptionDashboard | null>(null);
  const [gmailAudit, setGmailAudit] = useState<GmailAuditSummary | null>(null);
  const [gmailAnalysis, setGmailAnalysis] =
    useState<MailboxAnalysisSummary | null>(null);
  const [gmailOrganization, setGmailOrganization] =
    useState<GmailOrganizationPlan | null>(null);
  const [gmailDeletion, setGmailDeletion] =
    useState<GmailOrganizationPlan | null>(null);
  const [gmailSubscriptions, setGmailSubscriptions] =
    useState<SubscriptionDashboard | null>(null);
  const [accounts, setAccounts] = useState<MailAccountSummary[]>([]);
  const [identities, setIdentities] = useState<
    Record<string, AccountIdentitySummary[]>
  >({});
  const [proposals, setProposals] = useState<
    Record<string, OrganizationProposal | null>
  >({});
  const [ruleInventories, setRuleInventories] = useState<
    Record<string, RuleInventory | null>
  >({});
  const [rulePlans, setRulePlans] = useState<
    Record<string, RuleReconciliationPlan | null>
  >({});

  const loadWorkspace = async () => {
    const [
      connection,
      discovery,
      audit,
      mailboxAnalysis,
      currentCleanupPlan,
      currentDeletionPlan,
      currentSubscriptions,
      currentGmail,
      currentGmailAudit,
      currentGmailAnalysis,
      currentGmailOrganization,
      currentGmailDeletion,
      currentGmailSubscriptions,
      currentOutlook,
      currentOutlookAudit,
      currentOutlookAnalysis,
      currentOutlookOrganization,
      currentOutlookDeletion,
      currentOutlookSubscriptions,
      currentAccounts,
    ] = await Promise.all([
      window.emailOrganizer.getProtonConnection(),
      window.emailOrganizer.getProtonDiscovery(),
      window.emailOrganizer.getCurrentProtonAudit(),
      window.emailOrganizer.getMailboxAnalysis(),
      window.emailOrganizer.getCleanupPlan({ kind: "organize" }),
      window.emailOrganizer.getCleanupPlan({ kind: "trash" }),
      window.emailOrganizer.getSubscriptionDashboard(),
      window.emailOrganizer.getGmailConnection(),
      window.emailOrganizer.getGmailAudit(),
      window.emailOrganizer.getGmailAnalysis(),
      window.emailOrganizer.getGmailOrganizationPlan(),
      window.emailOrganizer.getGmailDeletionPlan(),
      window.emailOrganizer.getGmailSubscriptionDashboard(),
      window.emailOrganizer.getOutlookConnection(),
      window.emailOrganizer.getOutlookAudit(),
      window.emailOrganizer.getOutlookAnalysis(),
      window.emailOrganizer.getOutlookOrganizationPlan(),
      window.emailOrganizer.getOutlookDeletionPlan(),
      window.emailOrganizer.getOutlookSubscriptionDashboard(),
      window.emailOrganizer.listMailAccounts(),
    ]);
    setProtonConnection(connection);
    setProtonDiscovery(discovery);
    setProtonAudit(audit);
    setAnalysis(mailboxAnalysis);
    setCleanupPlan(currentCleanupPlan);
    setDeletionPlan(currentDeletionPlan);
    setSubscriptions(currentSubscriptions);
    setGmailConnection(currentGmail);
    setGmailAudit(currentGmailAudit);
    setGmailAnalysis(currentGmailAnalysis);
    setGmailOrganization(currentGmailOrganization);
    setGmailDeletion(currentGmailDeletion);
    setGmailSubscriptions(currentGmailSubscriptions);
    setAccounts(currentAccounts);
    setOutlookConnection(currentOutlook);
    setOutlookAudit(currentOutlookAudit);
    setOutlookAnalysis(currentOutlookAnalysis);
    setOutlookOrganization(currentOutlookOrganization);
    setOutlookDeletion(currentOutlookDeletion);
    setOutlookSubscriptions(currentOutlookSubscriptions);
    const identityEntries = await Promise.all(
      currentAccounts.map(
        async (account) =>
          [
            account.id,
            await window.emailOrganizer.listAccountIdentities({
              provider: account.provider,
              connectionId: account.id,
            }),
          ] as const,
      ),
    );
    const proposalEntries = await Promise.all(
      currentAccounts.map(
        async (account) =>
          [
            account.id,
            await window.emailOrganizer.getOrganizationProposal({
              provider: account.provider,
              connectionId: account.id,
            }),
          ] as const,
      ),
    );
    const ruleInventoryEntries = await Promise.all(
      currentAccounts.map(
        async (account) =>
          [
            account.id,
            await window.emailOrganizer.getRuleInventory({
              provider: account.provider,
              connectionId: account.id,
            }),
          ] as const,
      ),
    );
    const rulePlanEntries = await Promise.all(
      currentAccounts.map(
        async (account) =>
          [
            account.id,
            await window.emailOrganizer.getRulePlan({
              provider: account.provider,
              connectionId: account.id,
            }),
          ] as const,
      ),
    );
    setIdentities(Object.fromEntries(identityEntries));
    setProposals(Object.fromEntries(proposalEntries));
    setRuleInventories(Object.fromEntries(ruleInventoryEntries));
    setRulePlans(Object.fromEntries(rulePlanEntries));
  };

  useEffect(() => {
    void window.emailOrganizer
      .listProfiles()
      .then(setProfiles)
      .catch(() =>
        setLoadError(
          "Sift couldn't load local profiles. Try reopening the app.",
        ),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(
    () =>
      window.emailOrganizer.onProtonAuditProgress((progress) => {
        if (progress.profileId === activeProfile?.id) setProtonAudit(progress);
      }),
    [activeProfile?.id],
  );
  useEffect(
    () =>
      window.emailOrganizer.onCleanupProgress((progress: CleanupProgress) => {
        if (progress.profileId !== activeProfile?.id) return;
        if (progress.plan.kind === "trash") setDeletionPlan(progress.plan);
        else setCleanupPlan(progress.plan);
      }),
    [activeProfile?.id],
  );
  useEffect(
    () =>
      window.emailOrganizer.onGmailOrganizationProgress((progress) => {
        if (progress.profileId !== activeProfile?.id) return;
        if (progress.plan.kind === "trash") setGmailDeletion(progress.plan);
        else setGmailOrganization(progress.plan);
      }),
    [activeProfile?.id],
  );
  useEffect(
    () =>
      window.emailOrganizer.onUnsubscribeProgress(
        (progress: UnsubscribeProgress) => {
          if (progress.profileId === activeProfile?.id)
            setSubscriptions(progress.dashboard);
        },
      ),
    [activeProfile?.id],
  );
  useEffect(
    () =>
      window.emailOrganizer.onGmailAuditProgress((progress) => {
        if (progress.profileId === activeProfile?.id)
          setGmailAudit(progress.summary);
      }),
    [activeProfile?.id],
  );
  useEffect(
    () =>
      window.emailOrganizer.onGmailUnsubscribeProgress((progress) => {
        if (progress.profileId === activeProfile?.id)
          setGmailSubscriptions(progress.dashboard);
      }),
    [activeProfile?.id],
  );
  useEffect(
    () =>
      window.emailOrganizer.onOutlookAuditProgress((progress) => {
        if (progress.profileId === activeProfile?.id)
          setOutlookAudit(progress.summary);
      }),
    [activeProfile?.id],
  );
  useEffect(
    () =>
      window.emailOrganizer.onOutlookOrganizationProgress((progress) => {
        if (progress.profileId !== activeProfile?.id) return;
        if (progress.plan.kind === "trash") setOutlookDeletion(progress.plan);
        else setOutlookOrganization(progress.plan);
      }),
    [activeProfile?.id],
  );
  useEffect(
    () =>
      window.emailOrganizer.onOutlookUnsubscribeProgress((progress) => {
        if (progress.profileId === activeProfile?.id)
          setOutlookSubscriptions(progress.dashboard);
      }),
    [activeProfile?.id],
  );

  const createProfile = async (displayName: string) => {
    const profile = await window.emailOrganizer.createProfile({ displayName });
    setProfiles((existing) => [...existing, profile]);
    setActiveProfile(profile);
    await loadWorkspace();
  };

  const openProfile = async (profile: ProfileSummary) => {
    const selected = await window.emailOrganizer.selectProfile({
      profileId: profile.id,
    });
    setProfiles((existing) =>
      existing.map((item) => (item.id === selected.id ? selected : item)),
    );
    setActiveProfile(selected);
    await loadWorkspace();
  };

  const connectProton = async (credentials: BridgeCredentials) => {
    const result = await window.emailOrganizer.connectProtonBridge(credentials);
    if (result.connection) await loadWorkspace();
    return result;
  };

  const disconnectProton = async (connectionId: string) => {
    await window.emailOrganizer.disconnectProtonBridge({ connectionId });
    await loadWorkspace();
  };

  const discoverProton = async () => {
    const discovery = await window.emailOrganizer.discoverProtonMailbox();
    setProtonDiscovery(discovery);
    return discovery;
  };

  const startProtonAudit = async (extractBodies: boolean) => {
    setProtonAudit(
      await window.emailOrganizer.startProtonAudit({ extractBodies }),
    );
  };

  const pauseProtonAudit = async (jobId: string) => {
    setProtonAudit(await window.emailOrganizer.pauseProtonAudit({ jobId }));
  };

  const resumeProtonAudit = async (jobId: string) => {
    setProtonAudit(await window.emailOrganizer.resumeProtonAudit({ jobId }));
  };

  const analyzeCurrentMailbox = async () => {
    setAnalysis(await window.emailOrganizer.analyzeMailbox());
    setCleanupPlan(null);
    setDeletionPlan(null);
    setSubscriptions(null);
  };

  const generateCleanup = async (containers: Record<string, string>) =>
    setCleanupPlan(
      await window.emailOrganizer.generateCleanupPlan({
        kind: "organize",
        containers,
        trashSenderDomains: [],
      }),
    );
  const approveCleanup = async (planId: string, revision: string) => {
    const progress = await window.emailOrganizer.approveCleanupPlan({
      planId,
      revision,
    });
    setCleanupPlan(progress.plan);
  };
  const resumeCleanup = async (planId: string, revision: string) => {
    const progress = await window.emailOrganizer.resumeCleanupPlan({
      planId,
      revision,
    });
    setCleanupPlan(progress.plan);
  };
  const retryCleanup = async (planId: string, actionIds: string[]) => {
    const progress = await window.emailOrganizer.retryCleanupPlan({
      planId,
      actionIds,
    });
    setCleanupPlan(progress.plan);
  };
  const undoCleanup = async (planId: string) => {
    const progress = await window.emailOrganizer.undoCleanupPlan({ planId });
    setCleanupPlan(progress.plan);
  };
  const generateDeletion = async (senderDomains: string[]) =>
    setDeletionPlan(
      await window.emailOrganizer.generateCleanupPlan({
        kind: "trash",
        containers: {},
        trashSenderDomains: senderDomains,
      }),
    );
  const approveDeletion = async (planId: string, revision: string) => {
    const progress = await window.emailOrganizer.approveCleanupPlan({
      planId,
      revision,
    });
    setDeletionPlan(progress.plan);
  };
  const resumeDeletion = async (planId: string, revision: string) => {
    const progress = await window.emailOrganizer.resumeCleanupPlan({
      planId,
      revision,
    });
    setDeletionPlan(progress.plan);
  };
  const retryDeletion = async (planId: string, actionIds: string[]) => {
    const progress = await window.emailOrganizer.retryCleanupPlan({
      planId,
      actionIds,
    });
    setDeletionPlan(progress.plan);
  };
  const undoDeletion = async (planId: string) => {
    const progress = await window.emailOrganizer.undoCleanupPlan({ planId });
    setDeletionPlan(progress.plan);
  };
  const scanSubscriptions = async () =>
    setSubscriptions(await window.emailOrganizer.scanSubscriptions());
  const startUnsubscribe = async (candidateIds: string[]) => {
    const progress = await window.emailOrganizer.startBulkUnsubscribe({
      candidateIds,
    });
    setSubscriptions(progress.dashboard);
  };
  const resumeUnsubscribe = async (jobId: string) => {
    const progress = await window.emailOrganizer.resumeBulkUnsubscribe({
      jobId,
    });
    setSubscriptions(progress.dashboard);
  };
  const connectGmail = async (clientId: string, clientSecret?: string) => {
    await window.emailOrganizer.connectGmail({
      clientId,
      ...(clientSecret ? { clientSecret } : {}),
    });
    await loadWorkspace();
  };
  const disconnectGmail = async (connectionId: string) => {
    await window.emailOrganizer.disconnectGmail({ connectionId });
    await loadWorkspace();
  };
  const selectAccount = async (account: MailAccountSummary) => {
    await window.emailOrganizer.selectMailAccount({
      provider: account.provider,
      connectionId: account.id,
    });
    await loadWorkspace();
  };
  const refreshIdentities = async (account: MailAccountSummary) => {
    const refreshed = await window.emailOrganizer.refreshAccountIdentities({
      provider: account.provider,
      connectionId: account.id,
    });
    setIdentities((current) => ({ ...current, [account.id]: refreshed }));
    setProposals((current) => ({ ...current, [account.id]: null }));
    setRulePlans((current) => ({ ...current, [account.id]: null }));
  };
  const connectOutlook = async (
    clientId: string,
    tenant: "common" | "consumers" | "organizations",
  ) => {
    await window.emailOrganizer.connectOutlook({ clientId, tenant });
    await loadWorkspace();
  };
  const disconnectOutlook = async (connectionId: string) => {
    await window.emailOrganizer.disconnectOutlook({ connectionId });
    await loadWorkspace();
  };
  const startOutlookAudit = async () =>
    setOutlookAudit(await window.emailOrganizer.startOutlookAudit());
  const analyzeOutlook = async () =>
    setOutlookAnalysis(await window.emailOrganizer.analyzeOutlook());
  const generateOutlookOrganization = async () =>
    setOutlookOrganization(
      await window.emailOrganizer.generateOutlookOrganizationPlan(),
    );
  const generateOutlookDeletion = async (senderDomains: string[]) =>
    setOutlookDeletion(
      await window.emailOrganizer.generateOutlookDeletionPlan({
        senderDomains,
        olderThanDays: 180,
      }),
    );
  const approveOutlookOrganization = async (
    planId: string,
    revision: string,
  ) => {
    const plan = await window.emailOrganizer.approveOutlookOrganizationPlan({
      planId,
      revision,
    });
    plan.kind === "trash"
      ? setOutlookDeletion(plan)
      : setOutlookOrganization(plan);
  };
  const retryOutlookOrganization = async (
    planId: string,
    batchIds: string[],
  ) => {
    const plan = await window.emailOrganizer.retryOutlookOrganizationPlan({
      planId,
      batchIds,
    });
    plan.kind === "trash"
      ? setOutlookDeletion(plan)
      : setOutlookOrganization(plan);
  };
  const undoOutlookOrganization = async (planId: string) => {
    const plan = await window.emailOrganizer.undoOutlookOrganizationPlan({
      planId,
    });
    plan.kind === "trash"
      ? setOutlookDeletion(plan)
      : setOutlookOrganization(plan);
  };
  const scanOutlookSubscriptions = async () =>
    setOutlookSubscriptions(
      await window.emailOrganizer.scanOutlookSubscriptions(),
    );
  const startOutlookUnsubscribe = async (candidateIds: string[]) =>
    setOutlookSubscriptions(
      await window.emailOrganizer.startOutlookBulkUnsubscribe({ candidateIds }),
    );
  const resumeOutlookUnsubscribe = async (jobId: string) =>
    setOutlookSubscriptions(
      await window.emailOrganizer.resumeOutlookBulkUnsubscribe({ jobId }),
    );
  const retryOutlookUnsubscribe = async (
    jobId: string,
    candidateIds: string[],
  ) =>
    setOutlookSubscriptions(
      await window.emailOrganizer.retryOutlookBulkUnsubscribe({
        jobId,
        candidateIds,
      }),
    );
  const retryUnsubscribe = async (jobId: string, candidateIds: string[]) => {
    const progress = await window.emailOrganizer.retryBulkUnsubscribe({
      jobId,
      candidateIds,
    });
    setSubscriptions(progress.dashboard);
  };
  const updateIdentity = async (input: AccountIdentityUpdateInput) => {
    const updated = await window.emailOrganizer.updateAccountIdentity(input);
    setIdentities((current) => ({
      ...current,
      [input.connectionId]: (current[input.connectionId] ?? []).map(
        (identity) =>
          identity.address === updated.address ? updated : identity,
      ),
    }));
    if (input.provider === "gmail") {
      setGmailAnalysis(
        gmailAudit?.indexedMessages
          ? await window.emailOrganizer.analyzeGmail()
          : await window.emailOrganizer.getGmailAnalysis(),
      );
    } else if (input.provider === "outlook") {
      setOutlookAnalysis(
        outlookAudit?.indexedMessages
          ? await window.emailOrganizer.analyzeOutlook()
          : await window.emailOrganizer.getOutlookAnalysis(),
      );
    } else {
      setAnalysis(
        protonAudit?.indexedMessages
          ? await window.emailOrganizer.analyzeMailbox()
          : await window.emailOrganizer.getMailboxAnalysis(),
      );
    }
    setProposals((current) => ({ ...current, [input.connectionId]: null }));
    setRulePlans((current) => ({ ...current, [input.connectionId]: null }));
    if (input.provider === "gmail") setGmailOrganization(null);
    else if (input.provider === "outlook") setOutlookOrganization(null);
    else setCleanupPlan(null);
  };
  const generateProposal = async (account: MailAccountSummary) => {
    if (account.provider === "gmail" && gmailAudit?.indexedMessages) {
      setGmailAnalysis(await window.emailOrganizer.analyzeGmail());
    } else if (
      account.provider === "outlook" &&
      outlookAudit?.indexedMessages
    ) {
      setOutlookAnalysis(await window.emailOrganizer.analyzeOutlook());
    } else if (account.provider === "proton" && protonAudit?.indexedMessages) {
      setAnalysis(await window.emailOrganizer.analyzeMailbox());
    }
    const proposal = await window.emailOrganizer.generateOrganizationProposal({
      provider: account.provider,
      connectionId: account.id,
    });
    setProposals((current) => ({ ...current, [account.id]: proposal }));
    setRulePlans((current) => ({ ...current, [account.id]: null }));
    if (account.provider === "gmail") setGmailOrganization(null);
    else if (account.provider === "outlook") setOutlookOrganization(null);
    else setCleanupPlan(null);
  };
  const editProposal = async (input: EditOrganizationProposal) => {
    const proposal =
      await window.emailOrganizer.editOrganizationProposal(input);
    setProposals((current) => ({
      ...current,
      [proposal.connectionId]: proposal,
    }));
    setRulePlans((current) => ({ ...current, [proposal.connectionId]: null }));
    if (proposal.provider === "gmail") setGmailOrganization(null);
    else if (proposal.provider === "outlook") setOutlookOrganization(null);
    else setCleanupPlan(null);
  };
  const refreshRuleInventory = async (account: MailAccountSummary) => {
    const inventory = await window.emailOrganizer.refreshRuleInventory({
      provider: account.provider,
      connectionId: account.id,
    });
    setRuleInventories((current) => ({ ...current, [account.id]: inventory }));
    setRulePlans((current) => ({ ...current, [account.id]: null }));
  };
  const generateRulePlan = async (account: MailAccountSummary) => {
    const plan = await window.emailOrganizer.generateRulePlan({
      provider: account.provider,
      connectionId: account.id,
    });
    setRulePlans((current) => ({ ...current, [account.id]: plan }));
  };
  const approveRulePlan = async (plan: RuleReconciliationPlan) => {
    const updated = await window.emailOrganizer.approveRulePlan({
      planId: plan.id,
      revision: plan.revision,
    });
    setRulePlans((current) => ({
      ...current,
      [updated.connectionId]: updated,
    }));
  };
  const retryRulePlan = async (plan: RuleReconciliationPlan) => {
    const operationIds = plan.operations
      .filter((operation) =>
        ["failed", "verification_mismatch"].includes(operation.state),
      )
      .map((operation) => operation.id);
    if (!operationIds.length) return;
    const updated = await window.emailOrganizer.retryRulePlan({
      planId: plan.id,
      operationIds,
    });
    setRulePlans((current) => ({
      ...current,
      [updated.connectionId]: updated,
    }));
  };
  const undoRulePlan = async (plan: RuleReconciliationPlan) => {
    const updated = await window.emailOrganizer.undoRulePlan({
      planId: plan.id,
    });
    setRulePlans((current) => ({
      ...current,
      [updated.connectionId]: updated,
    }));
  };
  const exportProtonRulePlan = async (plan: RuleReconciliationPlan) => {
    const result = await window.emailOrganizer.exportProtonRulePlan({
      planId: plan.id,
      revision: plan.revision,
    });
    setRulePlans((current) => ({
      ...current,
      [result.plan.connectionId]: result.plan,
    }));
    return result.canceled
      ? ""
      : `Saved ${result.ruleCount} managed rules. Checksum ${result.checksum?.slice(0, 12)}…`;
  };
  const startGmailAudit = async () =>
    setGmailAudit(await window.emailOrganizer.startGmailAudit());
  const analyzeGmail = async () =>
    setGmailAnalysis(await window.emailOrganizer.analyzeGmail());
  const setGmailHistoryPlan = (plan: GmailOrganizationPlan) =>
    plan.kind === "trash" ? setGmailDeletion(plan) : setGmailOrganization(plan);
  const generateGmailOrganization = async () =>
    setGmailHistoryPlan(
      await window.emailOrganizer.generateGmailOrganizationPlan(),
    );
  const generateGmailDeletion = async (senderDomains: string[]) =>
    setGmailHistoryPlan(
      await window.emailOrganizer.generateGmailDeletionPlan({
        senderDomains,
        olderThanDays: 180,
      }),
    );
  const approveGmailOrganization = async (planId: string, revision: string) =>
    setGmailHistoryPlan(
      await window.emailOrganizer.approveGmailOrganizationPlan({
        planId,
        revision,
      }),
    );
  const retryGmailOrganization = async (planId: string, batchIds: string[]) =>
    setGmailHistoryPlan(
      await window.emailOrganizer.retryGmailOrganizationPlan({
        planId,
        batchIds,
      }),
    );
  const undoGmailOrganization = async (planId: string) =>
    setGmailHistoryPlan(
      await window.emailOrganizer.undoGmailOrganizationPlan({ planId }),
    );
  const scanGmailSubscriptions = async () =>
    setGmailSubscriptions(await window.emailOrganizer.scanGmailSubscriptions());
  const startGmailUnsubscribe = async (candidateIds: string[]) =>
    setGmailSubscriptions(
      await window.emailOrganizer.startGmailBulkUnsubscribe({ candidateIds }),
    );
  const resumeGmailUnsubscribe = async (jobId: string) =>
    setGmailSubscriptions(
      await window.emailOrganizer.resumeGmailBulkUnsubscribe({ jobId }),
    );
  const retryGmailUnsubscribe = async (jobId: string, candidateIds: string[]) =>
    setGmailSubscriptions(
      await window.emailOrganizer.retryGmailBulkUnsubscribe({
        jobId,
        candidateIds,
      }),
    );

  if (loading) {
    return (
      <main className="loading-screen" aria-live="polite">
        <BrandMark />
        <span>Preparing local workspace…</span>
      </main>
    );
  }

  return activeProfile ? (
    <AppShell
      profileName={activeProfile.displayName}
      onSwitchProfile={() => setActiveProfile(null)}
      accounts={accounts}
      identities={identities}
      onSelectAccount={selectAccount}
      onRefreshIdentities={refreshIdentities}
      onUpdateIdentity={updateIdentity}
      proposals={proposals}
      onGenerateProposal={generateProposal}
      onEditProposal={editProposal}
      ruleInventories={ruleInventories}
      rulePlans={rulePlans}
      onRefreshRuleInventory={refreshRuleInventory}
      onGenerateRulePlan={generateRulePlan}
      onApproveRulePlan={approveRulePlan}
      onRetryRulePlan={retryRulePlan}
      onUndoRulePlan={undoRulePlan}
      onExportProtonRulePlan={exportProtonRulePlan}
      protonConnection={protonConnection}
      protonDiscovery={protonDiscovery}
      onDiagnoseProton={(credentials) =>
        window.emailOrganizer.diagnoseProtonBridge(credentials)
      }
      onConnectProton={connectProton}
      onDisconnectProton={disconnectProton}
      onDiscoverProton={discoverProton}
      protonAudit={protonAudit}
      onStartProtonAudit={startProtonAudit}
      onPauseProtonAudit={pauseProtonAudit}
      onResumeProtonAudit={resumeProtonAudit}
      analysis={analysis}
      onAnalyzeMailbox={analyzeCurrentMailbox}
      cleanupPlan={cleanupPlan}
      onGenerateCleanup={generateCleanup}
      onApproveCleanup={approveCleanup}
      onResumeCleanup={resumeCleanup}
      onRetryCleanup={retryCleanup}
      onUndoCleanup={undoCleanup}
      deletionPlan={deletionPlan}
      onGenerateDeletion={generateDeletion}
      onApproveDeletion={approveDeletion}
      onResumeDeletion={resumeDeletion}
      onRetryDeletion={retryDeletion}
      onUndoDeletion={undoDeletion}
      subscriptions={subscriptions}
      onScanSubscriptions={scanSubscriptions}
      onStartUnsubscribe={startUnsubscribe}
      onResumeUnsubscribe={resumeUnsubscribe}
      onRetryUnsubscribe={retryUnsubscribe}
      gmailConnection={gmailConnection}
      onConnectGmail={connectGmail}
      onDisconnectGmail={disconnectGmail}
      gmailAudit={gmailAudit}
      onStartGmailAudit={startGmailAudit}
      gmailAnalysis={gmailAnalysis}
      onAnalyzeGmail={analyzeGmail}
      gmailOrganization={gmailOrganization}
      onGenerateGmailOrganization={generateGmailOrganization}
      onApproveGmailOrganization={approveGmailOrganization}
      onRetryGmailOrganization={retryGmailOrganization}
      onUndoGmailOrganization={undoGmailOrganization}
      gmailDeletion={gmailDeletion}
      onGenerateGmailDeletion={generateGmailDeletion}
      gmailSubscriptions={gmailSubscriptions}
      onScanGmailSubscriptions={scanGmailSubscriptions}
      onStartGmailUnsubscribe={startGmailUnsubscribe}
      onResumeGmailUnsubscribe={resumeGmailUnsubscribe}
      onRetryGmailUnsubscribe={retryGmailUnsubscribe}
      outlookConnection={outlookConnection}
      outlookAudit={outlookAudit}
      outlookAnalysis={outlookAnalysis}
      onConnectOutlook={connectOutlook}
      onDisconnectOutlook={disconnectOutlook}
      onStartOutlookAudit={startOutlookAudit}
      onAnalyzeOutlook={analyzeOutlook}
      outlookOrganization={outlookOrganization}
      outlookDeletion={outlookDeletion}
      onGenerateOutlookOrganization={generateOutlookOrganization}
      onGenerateOutlookDeletion={generateOutlookDeletion}
      onApproveOutlookOrganization={approveOutlookOrganization}
      onRetryOutlookOrganization={retryOutlookOrganization}
      onUndoOutlookOrganization={undoOutlookOrganization}
      outlookSubscriptions={outlookSubscriptions}
      onScanOutlookSubscriptions={scanOutlookSubscriptions}
      onStartOutlookUnsubscribe={startOutlookUnsubscribe}
      onResumeOutlookUnsubscribe={resumeOutlookUnsubscribe}
      onRetryOutlookUnsubscribe={retryOutlookUnsubscribe}
    />
  ) : (
    <ProfilePicker
      profiles={profiles}
      loadError={loadError}
      onCreate={createProfile}
      onOpen={openProfile}
    />
  );
};
