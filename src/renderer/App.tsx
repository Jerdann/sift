import * as Dialog from "@radix-ui/react-dialog";
import {
  Archive,
  Check,
  ChevronRight,
  CircleDot,
  CloudOff,
  Database,
  FolderTree,
  Inbox,
  KeyRound,
  LockKeyhole,
  ListFilter,
  LifeBuoy,
  MailPlus,
  RefreshCw,
  Search,
  Settings2,
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
import { providerHasDestinations } from "../core/rules/folder-readiness";
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
import type {
  BackupResult,
  DiagnosticsExportResult,
  DiagnosticsSummary,
  RebuildIndexResult,
  RestoreResult,
} from "../shared/contracts/recovery";
import type {
  AppSettings,
  ManualUpdateCheckResult,
  UpdateAppSettingsInput,
} from "../shared/contracts/settings";
import type {
  SpamReview,
  SpamReviewDecision,
} from "../shared/contracts/spam-review";

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

const mailCategoryLabels: Record<MailCategory, string> = {
  personal: "Personal",
  security: "Security",
  accounts: "Accounts",
  transactions: "Transactions",
  finance: "Finance",
  shopping: "Shopping",
  travel: "Travel",
  games: "Games",
  subscriptions: "Subscriptions",
  promotions: "Promotions",
  social: "Social",
  suspicious: "Suspicious review",
  spam: "Spam",
  other: "Unsorted review",
};

type PageId =
  | "overview"
  | "accounts"
  | "audit"
  | "organize"
  | "spam"
  | "rules"
  | "unsubscribe"
  | "delete"
  | "recovery"
  | "settings";
const navItems: ReadonlyArray<{
  id: PageId;
  label: string;
  icon: typeof Inbox;
}> = [
  { id: "overview", label: "Overview", icon: Inbox },
  { id: "accounts", label: "Accounts", icon: MailPlus },
  { id: "audit", label: "Scan", icon: Search },
  { id: "organize", label: "Organize", icon: FolderTree },
  { id: "spam", label: "Spam", icon: ShieldCheck },
  { id: "rules", label: "Rules", icon: ListFilter },
  { id: "unsubscribe", label: "Unsubscribe", icon: Tags },
  { id: "delete", label: "Delete", icon: Archive },
  { id: "recovery", label: "Recovery", icon: LifeBuoy },
  { id: "settings", label: "Settings", icon: Settings2 },
];

const BrandMark = () => (
  <div className="brand-mark" aria-hidden="true">
    <span />
    <span />
    <span />
  </div>
);

const SettingsPanel = ({
  settings,
  onUpdate,
  onCheck,
  onOpenAccounts,
  onOpenRecovery,
}: {
  settings: AppSettings;
  onUpdate(input: UpdateAppSettingsInput): Promise<void>;
  onCheck(): Promise<ManualUpdateCheckResult>;
  onOpenAccounts?: () => void;
  onOpenRecovery?: () => void;
}) => {
  const [preferenceBusy, setPreferenceBusy] = useState(false);
  const [checkBusy, setCheckBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const setAutomaticUpdates = async (enabled: boolean) => {
    setPreferenceBusy(true);
    setError("");
    setNotice("");
    try {
      await onUpdate({ autoUpdateEnabled: enabled });
      setNotice(
        enabled
          ? "Automatic update checks are enabled."
          : "Automatic update checks are disabled.",
      );
    } catch {
      setError(
        "Sift could not save the update preference. The previous setting is still in effect.",
      );
    } finally {
      setPreferenceBusy(false);
    }
  };

  const checkForUpdates = async () => {
    setCheckBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await onCheck();
      setNotice(
        result.status === "update_available"
          ? "A newer version is downloading. Sift will ask before restarting."
          : result.status === "up_to_date"
            ? `No newer release is available right now. This is Sift v${result.currentVersion}.`
            : "Manual update checks work only in the installed Windows app.",
      );
    } catch {
      setError(
        "Sift could not check for updates. Check your internet connection and try again.",
      );
    } finally {
      setCheckBusy(false);
    }
  };

  return (
    <>
      <div className="page-heading task-heading settings-heading">
        <h1>Settings</h1>
        <p>
          <strong>Goal:</strong> Control software updates and understand what Sift stores on this computer.
        </p>
        <div className="page-method" role="note">
          <strong>How this page works</strong>
          <ul>
            <li>The automatic-update setting applies to every local profile.</li>
            <li>Privacy information lists what is stored, why it is stored, and how to remove it.</li>
            <li>Each profile keeps its own email connections, scan data, plans, and action history.</li>
          </ul>
        </div>
      </div>

      <section
        className="readiness-panel settings-update-panel"
        aria-labelledby="software-update-title"
      >
        <div className="panel-header">
          <div>
            <p className="eyebrow">SOFTWARE UPDATES</p>
            <h2 id="software-update-title">Automatic updates</h2>
          </div>
          <span className="secured-label">v{settings.appVersion}</span>
        </div>
        <div className="settings-update-control">
          <span className="settings-control-icon">
            <RefreshCw size={18} />
          </span>
          <span>
            <strong>Download updates automatically</strong>
            <small>
              When enabled, installed Windows builds check Sift’s public GitHub
              releases page hourly and download newer versions in the background.
            </small>
          </span>
          <label className="settings-switch">
            <input
              type="checkbox"
              role="switch"
              aria-label="Download updates automatically"
              checked={settings.autoUpdateEnabled}
              disabled={preferenceBusy}
              onChange={(event) =>
                void setAutomaticUpdates(event.target.checked)
              }
            />
            <span aria-hidden="true" />
            <b>{settings.autoUpdateEnabled ? "On" : "Off"}</b>
          </label>
        </div>
        <div className="settings-update-check">
          <span>
            <strong>Check for a new version now</strong>
            <small>
              This performs one update check even when automatic updates are off.
            </small>
          </span>
          <button
            className="secondary-button compact"
            type="button"
            disabled={checkBusy}
            onClick={() => void checkForUpdates()}
          >
            <RefreshCw
              aria-hidden="true"
              className={checkBusy ? "is-spinning" : undefined}
              size={14}
            />
            {checkBusy ? "Checking…" : "Check for updates"}
          </button>
        </div>
        <div className="update-behavior-grid">
          <div>
            <strong>
              {settings.automaticUpdatesActive
                ? "Background checks are active"
                : settings.autoUpdateEnabled && !settings.updatesSupported
                  ? "Preference saved for installed builds"
                  : "No new automatic checks or downloads"}
            </strong>
            <p>
              {settings.automaticUpdatesActive
                ? "Sift checks for complete public releases. It sends no mailbox data with an update request."
                : settings.autoUpdateEnabled && !settings.updatesSupported
                  ? "Automatic updates run only after Sift is installed on Windows. They do not run from source code or an uninstalled copy."
                  : "You can install a release manually whenever you choose. A request already in progress may finish after this switch is turned off."}
            </p>
          </div>
          <div>
            <strong>Restart timing</strong>
            <p>
              Sift defaults its update prompt to Later and never forces Sift to
              restart while you are using it. Once an update has downloaded,
              Sift installs it the next time the app starts even if you chose
              Later.
            </p>
          </div>
        </div>
        {notice ? (
          <p className="settings-notice" role="status">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p className="connection-error" role="alert">
            {error}
          </p>
        ) : null}
      </section>

      <section
        className="readiness-panel privacy-panel"
        aria-labelledby="privacy-policy-title"
      >
        <div className="panel-header">
          <div>
            <p className="eyebrow">PRIVACY &amp; DATA RETENTION</p>
            <h2 id="privacy-policy-title">Where Sift stores data</h2>
          </div>
          <span className="secured-label">
            <LockKeyhole size={14} /> Stored on this computer
          </span>
        </div>
        <p className="privacy-lead">
          Sift has no online email database, advertising, analytics, or usage
          tracking. Its working data is stored on this computer. Sift connects
          directly to Proton Bridge, Google, or Microsoft.
        </p>
        <div
          className="retention-table"
          role="table"
          aria-label="Data retention policy"
        >
          <div className="retention-head" role="row">
            <span role="columnheader">Data</span>
            <span role="columnheader">What is retained</span>
            <span role="columnheader">How to remove it</span>
          </div>
          <div role="row">
            <span className="retention-label" role="cell">
              <Database size={16} />
              <strong>Saved scan data</strong>
            </span>
            <p role="cell">
              Sender and recipient addresses, dates, subjects, selected message
              headers, message IDs, and folder or label information. Proton
              message text is stored only when you enable that option. Gmail
              and Outlook scans do not save message text.
            </p>
            <p role="cell">
              Disconnect an account to remove its saved scan, or use Recovery →
              Delete the local scan and start again to remove saved message
              information and categories for the profile.
            </p>
          </div>
          <div role="row">
            <span className="retention-label" role="cell">
              <KeyRound size={16} />
              <strong>Sign-in credentials</strong>
            </span>
            <p role="cell">
              Google and Microsoft sign-in tokens and Proton Bridge credentials
              are encrypted for the current Windows user. The screen displaying
              Sift cannot read the unencrypted values.
            </p>
            <p role="cell">
              Disconnecting an account removes its encrypted credential and
              local connection record. Encrypted backups remain wherever you
              chose to save them.
            </p>
          </div>
          <div role="row">
            <span className="retention-label" role="cell">
              <ShieldCheck size={16} />
              <strong>Saved work and Undo records</strong>
            </span>
            <p role="cell">
              Confirmed email addresses, folder plans, records of filters created
              by Sift, unsubscribe results, unfinished work, and Undo records remain
              in the local profile so interrupted work can resume.
            </p>
            <p role="cell">
              Delete saved scan clears folder choices and unfinished work but preserves
              records of filters created by Sift and completed unsubscribe
              requests. Removing the local profile files removes the remaining
              local records.
            </p>
          </div>
          <div role="row">
            <span className="retention-label" role="cell">
              <CloudOff size={16} />
              <strong>Email stored by Proton, Google, or Microsoft</strong>
            </span>
            <p role="cell">
              Messages remain with Proton, Google, or Microsoft. Sift does not
              keep an online copy and does not permanently delete email.
            </p>
            <p role="cell">
              Proton, Google, or Microsoft controls how long messages remain in
              Spam, Trash, or Deleted Items. Sift shows an Undo option only for
              changes it can reverse.
            </p>
          </div>
        </div>
        <div className="privacy-network-boundary">
          <strong>Internet connections</strong>
          <p>
            Sift connects to your email services, Proton Bridge, Google or
            Microsoft sign-in, approved one-click unsubscribe links, and—only
            when automatic updates are enabled—the public Sift update service.
            Update checks do not send saved email data, credentials, subjects,
            or addresses.
          </p>
        </div>
        <div className="privacy-removal-note">
          <strong>Uninstalling Sift may leave local files behind.</strong>
          <p>
            On a shared computer, disconnect accounts before uninstalling.
            Windows may leave encrypted profile files after Sift is removed.
            Delete Sift’s application-data folder separately to remove them.
          </p>
          {onOpenAccounts || onOpenRecovery ? (
            <div>
              {onOpenAccounts ? (
                <button
                  className="secondary-button compact"
                  type="button"
                  onClick={onOpenAccounts}
                >
                  Open connected accounts
                </button>
              ) : null}
              {onOpenRecovery ? (
                <button
                  className="secondary-button compact"
                  type="button"
                  onClick={onOpenRecovery}
                >
                  Open Recovery
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>
    </>
  );
};

interface ProfilePickerProps {
  profiles: ProfileSummary[];
  loadError: string;
  settings: AppSettings;
  onUpdateSettings(input: UpdateAppSettingsInput): Promise<void>;
  onCheckForUpdates(): Promise<ManualUpdateCheckResult>;
  onCreate(profileName: string): Promise<void>;
  onOpen(profile: ProfileSummary): Promise<void>;
}

const ProfilePicker = ({
  profiles,
  loadError,
  settings,
  onUpdateSettings,
  onCheckForUpdates,
  onCreate,
  onOpen,
}: ProfilePickerProps) => {
  const [showSettings, setShowSettings] = useState(false);
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

  if (showSettings) {
    return (
      <main className="profile-screen settings-entry-screen">
        <section className="settings-entry-content">
          <button
            className="settings-back-button"
            type="button"
            onClick={() => setShowSettings(false)}
          >
            <ChevronRight size={15} /> Back to local profiles
          </button>
          <SettingsPanel
            settings={settings}
            onUpdate={onUpdateSettings}
            onCheck={onCheckForUpdates}
          />
        </section>
        <div className="screen-corner-status">
          <CircleDot size={12} /> LOCAL ONLY
        </div>
      </main>
    );
  }

  return (
    <main className="profile-screen">
      <section className="profile-picker" aria-labelledby="product-name">
        <div className="brand-lockup">
          <BrandMark />
          <span>SIFT</span>
        </div>
        <p className="eyebrow">LOCAL EMAIL ORGANIZATION</p>
        <h1 id="product-name">Organize email accounts on this computer.</h1>
        <p className="profile-intro">
          Connect an email account, scan it, review every suggested change, and
          approve which messages, folders, filters, and subscriptions Sift changes.
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
              <p>Each profile has separate email connections, scans, and saved choices.</p>
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
              <strong>No local profiles</strong>
              <span>Create a profile before connecting an email account.</span>
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
                    {profile.providerCount} connected email services ·{" "}
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
                    This stores the profile separately from other profiles on this computer.
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
        <button
          className="picker-settings-button"
          type="button"
          onClick={() => setShowSettings(true)}
        >
          <Settings2 size={14} /> Privacy &amp; update settings
        </button>
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
  settings: AppSettings;
  onUpdateSettings(input: UpdateAppSettingsInput): Promise<void>;
  onCheckForUpdates(): Promise<ManualUpdateCheckResult>;
  accounts: MailAccountSummary[];
  identities: Record<string, AccountIdentitySummary[]>;
  onSelectAccount(account: MailAccountSummary): Promise<void>;
  onRefreshIdentities(account: MailAccountSummary): Promise<void>;
  onUpdateIdentity(input: AccountIdentityUpdateInput): Promise<void>;
  proposals: Record<string, OrganizationProposal | null>;
  onGenerateProposal(account: MailAccountSummary): Promise<void>;
  onEditProposal(input: EditOrganizationProposal): Promise<void>;
  spamReviews: Record<string, SpamReview | null>;
  onGenerateSpamReview(account: MailAccountSummary): Promise<void>;
  onCompleteSpamReview(
    review: SpamReview,
    decisions: Array<{ candidateId: string; decision: SpamReviewDecision }>,
  ): Promise<void>;
  ruleInventories: Record<string, RuleInventory | null>;
  rulePlans: Record<string, RuleReconciliationPlan | null>;
  onRefreshRuleInventory(account: MailAccountSummary): Promise<void>;
  onGenerateRulePlan(
    account: MailAccountSummary,
    replaceExternalRules?: boolean,
  ): Promise<void>;
  onApproveRulePlan(
    plan: RuleReconciliationPlan,
    enabledOperationIds: string[],
  ): Promise<void>;
  onRetryRulePlan(plan: RuleReconciliationPlan): Promise<void>;
  onUndoRulePlan(plan: RuleReconciliationPlan): Promise<void>;
  onExportProtonRulePlan(
    plan: RuleReconciliationPlan,
    enabledOperationIds: string[],
  ): Promise<string>;
  onConfirmProtonRuleImport(plan: RuleReconciliationPlan): Promise<void>;
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
  onGenerateCleanup(
    containers: Record<string, string>,
    existingSetup: OrganizationTransitionMode,
  ): Promise<void>;
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
  diagnostics: DiagnosticsSummary | null;
  onCheckDiagnostics(): Promise<DiagnosticsSummary>;
  onExportDiagnostics(): Promise<DiagnosticsExportResult>;
  onCreateBackup(): Promise<BackupResult>;
  onRestoreBackup(): Promise<RestoreResult | null>;
  onRebuildIndex(): Promise<RebuildIndexResult>;
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
        "The connection test could not run. No sign-in information was saved.",
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
      setError("The saved Proton Bridge sign-in information could not be removed. Try again.");
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
        "The Proton folder scan stopped before it finished. Check that Proton Bridge is running, then try again.",
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
              PROTON BRIDGE
            </p>
            <h2 id="proton-title">
              {mode === "audit"
                ? "Scan Proton folders and messages"
                : "Connected through Proton Bridge"}
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
              {connection.security.toUpperCase()} · Ready to scan all Proton addresses
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
                ? "Reading Proton folders…"
                : discovery
                  ? "Scan folders again"
                  : "Scan folders and message addresses"}
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
                : "Disconnect Proton Bridge"}
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
                <strong>Proton folders found</strong>
                <small>
                  {new Date(discovery.discoveredAt).toLocaleString()} · no
                  email changed
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
                <span>messages counted across folders*</span>
              </div>
              <div>
                <b>{discovery.addresses.length.toLocaleString()}</b>
                <span>addresses found in message headers</span>
              </div>
            </div>
            <div className="scope-columns">
              <div>
                <h3>Addresses found in message headers</h3>
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
                    No addresses were found in the scanned message headers.
                  </p>
                )}
              </div>
              <div>
                <h3>Folders with the most messages</h3>
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
              These addresses come from message headers, not Proton's account
              settings. Forwarders, mailing lists, old aliases, To, and Cc fields
              can appear here. Sift does not treat them as addresses you own.
            </p>
            <p className="scope-footnote">
              Proton Bridge does not show filters created in Proton Mail. Sift
              can save a new Proton filter file (Sieve), but cannot list or
              delete your existing Proton Mail filters.
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
                ? "Connection works"
                : "Connection failed"}
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
          {busy === "save" ? "Connecting…" : "Connect Proton Bridge"}
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
        "The Proton scan stopped. Reopen Proton Bridge, then resume the scan. Completed folders remain saved.",
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
          <p className="eyebrow">PROTON MESSAGE SCAN</p>
          <h2 id="audit-title">Scan Proton messages</h2>
        </div>
        <span className="secured-label">
          <ShieldCheck size={14} /> Does not change email
        </span>
      </div>
      {audit ? (
        <div className="audit-progress" aria-live="polite">
          <div className="audit-progress-copy">
            <span>
              <strong>
                {finished
                  ? "Scan complete"
                  : running
                    ? `Scanning ${audit.currentFolder ?? "mailbox"}`
                    : "Scan paused"}
              </strong>
              <small>
                {audit.indexedMessages.toLocaleString()} messages scanned ·{" "}
                {audit.failureCount} folders could not be read
                {audit.extractBodies
                  ? " · limited message text included"
                  : " · message details only"}
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
                <b>
                  {{
                    pending: "WAITING",
                    running: "SCANNING",
                    succeeded: "COMPLETE",
                    failed: "FAILED",
                    skipped: "SKIPPED",
                    verification_mismatch: "NEEDS ANOTHER SCAN",
                  }[folder.state]}
                </b>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="audit-consent">
          <p>
            The scan stores message headers, dates, senders, recipients, folders,
            and message IDs on this computer. It never marks email read, moves
            messages, or downloads attachments.
          </p>
          <label>
            <input
              type="checkbox"
              checked={extractBodies}
              onChange={(event) => setExtractBodies(event.target.checked)}
            />
            <span>
              <strong>Include message text for better categories</strong>
              <small>
                Optional: read up to 32 KB of non-attachment text from each
                message. The text is processed only on this computer.
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
                ? "Scan Proton again"
                : "Start Proton scan"}
          </button>
        ) : null}
        {running ? (
          <button
            className="secondary-button"
            type="button"
            disabled={busy}
            onClick={() => void act(() => onPause(audit.job.id))}
          >
            Pause scan
          </button>
        ) : null}
        {resumable ? (
          <button
            className="primary-button"
            type="button"
            disabled={busy}
            onClick={() => void act(() => onResume(audit.job.id))}
          >
            {busy ? "Resuming…" : "Resume from saved progress"}
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
  const recommendationLabels: Record<
    MailboxAnalysisSummary["addresses"][number]["recommendation"],
    string
  > = {
    retain: "KEEP",
    migrate: "CONSIDER MOVING LINKED ACCOUNTS",
    watch: "REVIEW MANUALLY",
    consider_deactivation: "CONSIDER CLOSING",
  };
  if (!audit?.indexedMessages) return null;
  const rulePack = analysis ? buildPortableRulePack(analysis) : null;
  const analyze = async () => {
    setBusy(true);
    setError("");
    try {
      await onAnalyze();
    } catch {
      setError(
        "Sift could not sort the scanned messages into categories. The saved scan was not changed. Try again.",
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
            {provider.toUpperCase()} FOLDER SUGGESTIONS
          </p>
          <h2 id={`${provider}-analysis-title`}>
            Suggested folders and categories
          </h2>
        </div>
        <span className="secured-label">
          <LockKeyhole size={14} /> Processed on this computer
        </span>
      </div>
      {!analysis ? (
        <div className="analysis-empty">
          <p>
            Sort the scanned messages into categories by receiving address.
            This does not change any messages or folders.
          </p>
          <button
            className="primary-button compact"
            type="button"
            disabled={busy}
            onClick={() => void analyze()}
          >
            {busy ? "Sorting messages into categories…" : "Suggest folders and categories"}
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
                {analysis.uniqueMessages.toLocaleString()} messages sorted into categories
              </strong>
              <small>
                {analysis.categories.length} categories ·{" "}
                {analysis.addresses.length} possible account addresses
              </small>
            </span>
            <button
              className="secondary-button"
              type="button"
              disabled={busy}
              onClick={() => void analyze()}
            >
              {busy ? "Refreshing…" : "Refresh suggestions"}
            </button>
          </div>
          <div
            className="proposal-table"
            role="table"
            aria-label="Suggested mailbox folders"
          >
            <div className="proposal-row proposal-head" role="row">
              <span>Category</span>
              <span>Folder</span>
              <span>Messages</span>
              <span>Certainty</span>
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
              <h3>Senders with the most messages</h3>
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
              <h3>Addresses you own</h3>
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
                            .join(", ") || "No linked accounts found yet"}
                        </small>
                      </span>
                      <b className={`recommendation ${address.recommendation}`}>
                        {recommendationLabels[address.recommendation]}
                      </b>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="analysis-empty-note">
                  No address has been confirmed as yours. Sift needs to find the
                  address in the From field of a message in Proton's Sent folder.
                </p>
              )}
            </div>
          </div>
          {rulePack ? (
            <div className="rule-pack-panel">
              <div>
                <span>
                  <strong>
                    {rulePack.rules.length} suggested filters
                  </strong>
                  <small>
                      {rulePack.skippedAmbiguousStreams} senders excluded because
                    their messages do not have one clear category
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
                      Save Proton filter file
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
                                : `Saved filters as JSON to ${result.path}`,
                          ),
                        )
                        .catch(() =>
                          setExportStatus(
                            "The filter file could not be saved. Your email was not changed.",
                          ),
                        )
                    }
                  >
                    Save filters as JSON
                  </button>
                </div>
              </div>
              {exportStatus ? <p>{exportStatus}</p> : null}
              <small>
                Each filter matches a sender domain and receiving address.
                Personal, suspicious, uncertain, and mixed-category senders are
                excluded. Security alerts are never marked read.
              </small>
            </div>
          ) : null}
          <p className="analysis-disclosure">
            Sift lists an address as yours only when the email service identifies
            it as an alias or Sift finds it in the From field of a message in
            Sent. Recipients, forwarded addresses, and copied addresses are not
            treated as yours.
          </p>
        </div>
      )}
    </section>
  );
};

type OrganizationTransitionMode = "extend" | "reuse" | "replace";

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
  discovery,
  analysis,
  cleanupPlan,
  onGenerateCleanup,
  onApproveCleanup,
  onResumeCleanup,
  onRetryCleanup,
  onUndoCleanup,
  onContinue,
}: {
  audit: ProtonAuditProgress | null;
  discovery: ProtonDiscoverySummary | null;
  analysis: MailboxAnalysisSummary | null;
  cleanupPlan: CleanupPlan | null;
  onGenerateCleanup(
    containers: Record<string, string>,
    existingSetup: OrganizationTransitionMode,
  ): Promise<void>;
  onApproveCleanup(planId: string, revision: string): Promise<void>;
  onResumeCleanup(planId: string, revision: string): Promise<void>;
  onRetryCleanup(planId: string, actionIds: string[]): Promise<void>;
  onUndoCleanup(planId: string): Promise<void>;
  onContinue(): void;
}) => {
  const [reviewStarted, setReviewStarted] = useState(false);
  const [transitionMode, setTransitionMode] =
    useState<OrganizationTransitionMode>("extend");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!cleanupPlan) return;
    setReviewStarted(true);
    setTransitionMode(cleanupPlan.existingSetup);
  }, [cleanupPlan?.id, cleanupPlan?.existingSetup]);

  if (!audit?.indexedMessages || !analysis) return null;

  const containers = Object.fromEntries(
    analysis.addresses
      .filter(
        (identity) =>
          identity.containerEnabled && identity.containerName?.trim(),
      )
      .map((identity) => [identity.address, identity.containerName!.trim()]),
  );
  const customFolders =
    discovery?.mailboxes.filter((mailbox) =>
      mailbox.path.toLowerCase().startsWith(`folders${mailbox.delimiter}`),
    ) ?? [];
  const customLabels =
    discovery?.mailboxes.filter((mailbox) =>
      mailbox.path.toLowerCase().startsWith(`labels${mailbox.delimiter}`),
    ) ?? [];
  const populatedLegacyContainers = [...customFolders, ...customLabels].filter(
    (mailbox) => mailbox.messageCount > 0,
  ).length;
  const buildReview = async () => {
    setBusy(true);
    setError("");
    try {
      await onGenerateCleanup(containers, transitionMode);
      setReviewStarted(true);
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : "";
      setError(
        detail.includes("proton_audit_required")
          ? "No scanned Proton messages are saved. Return to Scan and finish the Proton scan. No folders or messages were changed."
          : "Sift could not sort the latest Proton scan into categories. Return to Scan and scan Proton again. No folders or messages were changed.",
      );
    } finally {
      setBusy(false);
    }
  };
  const chooseTransition = (mode: OrganizationTransitionMode) => {
    setTransitionMode(mode);
    if (cleanupPlan?.existingSetup !== mode) setReviewStarted(false);
  };

  return (
    <>
      <section
        className="readiness-panel organization-flow"
        aria-labelledby="organization-flow-title"
      >
        <div className="organization-flow-head">
          <div>
            <p className="eyebrow">PROTON ORGANIZATION</p>
            <h2 id="organization-flow-title">Choose new folder structure</h2>
            <p>
              {analysis.uniqueMessages.toLocaleString()} received messages ·{" "}
              {analysis.addresses.length} confirmed addresses
            </p>
          </div>
        </div>
        <div className="organization-stage">
          <div className="stage-intro">
            <span>1</span>
            <div>
              <h3>Choose one folder option</h3>
              <p>
                Sift found {customFolders.length} custom folders and {customLabels.length} labels.
                The next screen lists every folder, label, message move, and deletion before anything changes.
              </p>
            </div>
          </div>
          <div className="organization-strategy-grid three-up">
            <button
              type="button"
              className={transitionMode === "extend" ? "active" : ""}
              onClick={() => chooseTransition("extend")}
            >
              <span>OPTION 1</span>
              <strong>Create new folders</strong>
              <small>Keep your existing folders and labels. Create the new folders in this list and move matching mail into them.</small>
            </button>
            <button
              type="button"
              className={transitionMode === "reuse" ? "active" : ""}
              onClick={() => chooseTransition("reuse")}
            >
              <span>OPTION 2</span>
              <strong>Use existing folders</strong>
              <small>Move matching mail into existing folders. Create a folder only when no existing folder matches the new folder list.</small>
            </button>
            <button
              type="button"
              className={transitionMode === "replace" ? "active" : ""}
              onClick={() => chooseTransition("replace")}
            >
              <span>OPTION 3</span>
              <strong>Replace existing folders</strong>
              <small>Move matching mail into the new folders. Then remove old labels and delete old custom folders after they are empty.</small>
            </button>
          </div>
          <div className="organization-reset-plan">
            <div>
              <span>Existing folders and labels</span>
              <strong>{customFolders.length} folders · {customLabels.length} labels</strong>
              <small>{populatedLegacyContainers} contain messages. Sift never deletes Proton system folders.</small>
            </div>
            <ol>
              <li>Review every folder Sift will create or use.</li>
              <li>Review the separate folder for each split alias.</li>
              <li>Approve which existing messages will move and be marked read.</li>
              <li>{transitionMode === "replace" ? "After moving the messages, remove old labels and delete only old custom folders that are empty." : "Keep every existing folder and label."}</li>
            </ol>
          </div>
        </div>

        <div className="organization-flow-actions">
          <span>
            <strong>{Object.keys(containers).length} alias{Object.keys(containers).length === 1 ? " has" : "es have"} a separate folder</strong>
            <small>Mail sent to each selected alias will move into its own folder.</small>
          </span>
          <button
            className="primary-button compact"
            type="button"
            disabled={busy}
            onClick={() => void buildReview()}
          >
            {busy ? "Preparing folder and message changes…" : reviewStarted ? "Refresh folder and message changes" : "Review folder and message changes"}
          </button>
        </div>
        {error ? <p className="connection-error" role="alert">{error}</p> : null}
      </section>
      {reviewStarted ? (
        <CleanupPanel
          analysis={analysis}
          plan={cleanupPlan}
          onGenerate={() => onGenerateCleanup(containers, transitionMode)}
          onApprove={onApproveCleanup}
          onResume={onResumeCleanup}
          onRetry={onRetryCleanup}
          onUndo={onUndoCleanup}
        />
      ) : null}
      {reviewStarted && cleanupPlan?.state === "completed" ? (
        <div className="organization-next-step">
          <div>
            <strong>Existing messages have been filed.</strong>
            <small>The approved folders now exist. Decide which sender streams are spam before creating normal filters.</small>
          </div>
          <button className="primary-button compact" type="button" onClick={onContinue}>
            Continue to Spam
          </button>
        </div>
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
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(
        message.includes("cleanup_plan_virtual_source_rebuild_required")
          ? "This list came from an older scan that treated Proton All Mail as a folder that could be moved. Scan Proton again and review a new list. The 19 completed changes remain recorded."
          : message.includes("proton_target_rejected")
          ? "Proton rejected a folder in this list. No messages moved. Check the folder names and nesting, then review the changes again."
          : message.includes("proton_bridge_unavailable")
            ? "Sift lost its Proton Bridge connection and stopped. Reopen Bridge, then resume from the saved progress."
            : "The message changes stopped. Completed changes remain saved. Retry the failed changes.",
      );
    } finally {
      setBusy(false);
    }
  };
  const running = plan?.job?.state === "running";
  const jobTargetBlocked = plan?.job?.errorCode?.startsWith("proton_target_") ?? false;
  const resumable = plan?.job?.state === "pending" && plan.state !== "draft" && !jobTargetBlocked && !plan.requiresRebuild;
  const blockedFailures = (plan?.failedActions ?? []).filter((action) =>
    action.errorCode?.startsWith("proton_target_"),
  );
  const retryable = plan?.requiresRebuild
    ? []
    : (plan?.failedActions ?? []).filter((action) =>
        action.state === "failed" && !action.errorCode?.startsWith("proton_target_"),
      );
  const changedSourceCount = (plan?.failedActions ?? []).filter(
    (action) => action.state === "verification_mismatch",
  ).length;
  const canUndo = plan?.job?.state === "succeeded" && !plan.undoJob;
  const trash = mode === "trash";
  const impactGroups = (() => {
    if (!plan) return [];
    if (trash) {
      return [{
        key: "trash",
        eyebrow: "SELECTED OLD MESSAGES",
        title: "Proton Trash",
        detail: "The listed messages will move to Proton Trash.",
        impacts: plan.impacts,
      }];
    }
    const groups: Array<{
      key: string;
      eyebrow: string;
      title: string;
      detail: string;
      impacts: CleanupPlan["impacts"];
    }> = [];
    const shared = plan.impacts.filter((impact) => !impact.containerName);
    if (shared.length) {
      groups.push({
        key: "shared",
        eyebrow: "SHARED FOLDERS",
        title: "Folders used by unsplit aliases",
        detail: "Mail for aliases without a separate folder will move into these folders.",
        impacts: shared,
      });
    }
    const byContainer = new Map<string, CleanupPlan["impacts"]>();
    for (const impact of plan.impacts.filter((candidate) => candidate.containerName)) {
      const key = `${impact.scopeAddress ?? "unknown"}:${impact.containerName}`;
      byContainer.set(key, [...(byContainer.get(key) ?? []), impact]);
    }
    for (const [key, impacts] of byContainer) {
      groups.push({
        key,
        eyebrow: "SEPARATE ALIAS FOLDER",
        title: impacts[0]?.containerName ?? "Dedicated alias",
        detail: `Mail sent to ${impacts[0]?.scopeAddress ?? "this alias"} will move into this separate folder.`,
        impacts,
      });
    }
    return groups;
  })();
  return (
    <section
      className="readiness-panel cleanup-panel"
      aria-labelledby="cleanup-title"
    >
      <div className="panel-header">
        <div>
          <p className="eyebrow">
            {trash ? "DELETE OLD MAIL" : "EXISTING MESSAGE CHANGES"}
          </p>
          <h2 id="cleanup-title">
            {trash
              ? "Move selected old messages to Proton Trash"
              : "Create folders and file existing Proton messages"}
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
              ? "List every message that will move to Trash. Security, account, transaction, finance, personal, and suspicious messages will not be included."
              : "List every folder Sift will create or use and every existing message it will move and mark read. Nothing changes until you approve the list."}
          </p>
          <button
            className="primary-button compact"
            type="button"
            disabled={busy || !canGenerate}
            onClick={() => void act(onGenerate)}
          >
            {busy
              ? "Preparing message list…"
              : trash
                ? "Review messages to move to Trash"
                : "Review folder and message changes"}
          </button>
        </div>
      ) : (
        <div className="cleanup-review">
          <div className="cleanup-totals">
            <div>
              <b>{plan.actionCount.toLocaleString()}</b>
              <span>{trash ? "messages selected" : "messages to file"}</span>
            </div>
            <div>
              <b>
                {trash
                  ? plan.trashCount.toLocaleString()
                  : plan.spamCount.toLocaleString()}
              </b>
              <span>
                {trash ? "messages moving to Trash" : "messages moving to Spam"}
              </span>
            </div>
            <div>
              <b>{plan.skippedCount.toLocaleString()}</b>
              <span>{trash ? "not selected" : "left where they are"}</span>
            </div>
          </div>
          <div className="cleanup-impact-groups">
            {impactGroups.map((group) => {
              const messageCount = group.impacts.reduce(
                (sum, impact) => sum + impact.messageCount,
                0,
              );
              return (
                <section className="cleanup-impact-group" key={group.key}>
                  <header>
                    <div>
                      <span>{group.eyebrow}</span>
                      <strong>{group.title}</strong>
                      <small>{group.detail}</small>
                    </div>
                    <b>
                      {group.impacts.length.toLocaleString()} {group.impacts.length === 1 ? "folder" : "folders"}
                      {" · "}{messageCount.toLocaleString()} messages
                    </b>
                  </header>
                  <div
                    className="proposal-table"
                    role="table"
                    aria-label={`${group.title} message changes`}
                  >
                    <div className="cleanup-impact-row cleanup-impact-head">
                      <span>Category</span>
                      <span>Folder</span>
                      <span>What Sift will do</span>
                      <span>Messages</span>
                    </div>
                    {group.impacts.map((impact) => (
                      <div
                        className="cleanup-impact-row"
                        key={`${impact.scopeAddress}:${impact.category}:${impact.targetFolder}:${impact.action}`}
                      >
                        <strong>{mailCategoryLabels[impact.category]}</strong>
                        <span>{impact.targetFolder}</span>
                        <small>
                          {impact.action === "native_spam"
                            ? "Report / move to Spam"
                            : impact.action === "native_trash"
                              ? "Move to Trash"
                              : "Mark read · move to folder · remove from Inbox"}
                        </small>
                        <b>{impact.messageCount.toLocaleString()}</b>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
          {!trash && plan.existingSetup === "replace" ? (
            <details className="legacy-retirement-review" open={plan.legacyContainers.length <= 12}>
              <summary>
                <span>
                  <strong>Old folders and labels to remove</strong>
                  <small>Sift files the listed messages before removing anything here.</small>
                </span>
                <b>{plan.legacyContainers.length.toLocaleString()} folders or labels</b>
              </summary>
              <div>
                {plan.legacyContainers.map((container) => (
                  <div key={container.id}>
                    <span>
                      <strong>{container.providerPath}</strong>
                      <small>{container.kind} · {container.observedMessages.toLocaleString()} messages at scan time</small>
                    </span>
                    <b className={container.state === "failed" || container.state === "retained_nonempty" ? "stale" : ""}>
                      {container.state === "pending"
                        ? container.kind === "label"
                          ? "Remove label after moving messages"
                          : "Delete folder after moving messages"
                        : container.state === "retired"
                          ? "Deleted"
                          : container.state === "retained_nonempty"
                            ? "Kept — still contains mail"
                            : container.state.replaceAll("_", " ")}
                    </b>
                  </div>
                ))}
              </div>
              <p>Sift deletes a custom folder only after checking that it is empty. Removing a Proton label does not delete its messages. Proton system folders are never removed.</p>
            </details>
          ) : null}
          {plan.state === "draft" ? (
            <div className="cleanup-approval">
              <label>
                <input
                  type="checkbox"
                  checked={approved}
                  onChange={(event) => setApproved(event.target.checked)}
                />
                <span>
                  <strong>I approve the mailbox changes listed above</strong>
                  <small>
                    {trash
                      ? "Move only the listed messages to Proton Trash. Security, account, transaction, finance, personal, and suspicious messages are excluded. Nothing is permanently erased."
                      : `Create or use the folders listed above, then mark read and move only the messages shown.${plan.existingSetup === "replace" ? " After those messages are filed, remove the listed old labels and delete only the listed old folders that are empty." : ""}`}
                  </small>
                </span>
              </label>
              <button
                className="primary-button"
                type="button"
                disabled={!approved || busy || (plan.actionCount === 0 && plan.legacyContainers.length === 0)}
                onClick={() =>
                  void act(() => onApprove(plan.id, plan.revision))
                }
              >
                {busy
                  ? "Starting changes…"
                  : trash
                    ? `Move ${plan.actionCount.toLocaleString()} messages to Trash`
                    : `File ${plan.actionCount.toLocaleString()} messages${plan.legacyContainers.length ? ` and remove ${plan.legacyContainers.length} old folders or labels` : ""}`}
              </button>
            </div>
          ) : null}
          {plan.job ? (
            <div className="cleanup-execution" aria-live="polite">
              <div>
                <span>
                  <strong>
                    {plan.undoJob?.state === "succeeded"
                      ? "Original folders and read settings restored"
                      : plan.state === "completed"
                        ? "All approved changes completed"
                        : running
                          ? "Applying approved changes"
                          : plan.state === "failed"
                            ? "Some approved changes failed"
                            : "Changes paused"}
                  </strong>
                  <small>
                    {plan.undoJob
                      ? `${plan.undoJob.completedItems.toLocaleString()} / ${plan.undoJob.totalItems.toLocaleString()} changes restored`
                      : `${plan.job.completedItems.toLocaleString()} / ${plan.job.totalItems.toLocaleString()} changes completed`}
                  </small>
                </span>
                <b>{plan.undoJob?.percent ?? plan.job.percent}%</b>
              </div>
              <progress
                max={100}
                value={plan.undoJob?.percent ?? plan.job.percent}
              />
              {plan.requiresRebuild ? (
                <div className="cleanup-structural-error" role="alert">
                  <strong>Scan again before continuing</strong>
                  <small>
                    This list treated Proton’s All Mail view as a folder that
                    could be moved. Sift will not resume it. Scan Proton again
                    and review a new list. Completed changes remain recorded.
                  </small>
                  <button
                    className="primary-button compact"
                    type="button"
                    disabled={busy}
                    onClick={() => void act(onGenerate)}
                  >
                    {busy ? "Building new list…" : "Build a new change list"}
                  </button>
                </div>
              ) : null}
              {jobTargetBlocked || blockedFailures.length ? (
                <div className="cleanup-structural-error" role="alert">
                  <strong>Proton rejected the folder structure</strong>
                  <small>
                    No affected messages moved. Check the folder names and
                    nesting, then build the change list again.
                  </small>
                </div>
              ) : null}
              {changedSourceCount ? (
                <div className="cleanup-structural-error" role="status">
                  <strong>Messages changed after this list was created</strong>
                  <small>
                    {changedSourceCount.toLocaleString()} changes no longer match
                    the scanned messages. Run Scan again and build a new list
                    instead of retrying them.
                  </small>
                </div>
              ) : null}
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
                    {busy ? "Resuming…" : "Resume approved changes"}
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
                    {busy ? "Restoring…" : "Undo completed moves"}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
          <p className="cleanup-warning">
            No permanent deletion is used.{" "}
            {trash
              ? "The selected messages move to Proton Trash and remain there until Proton automatically removes them."
              : "Uncertain messages move to Review/Unsorted and are marked read. Personal and suspicious messages remain where they are. Messages already in the correct folder are not moved again."}
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
            <p className="eyebrow">OLD MESSAGES</p>
            <h2>Choose senders whose old messages can move to Trash</h2>
          </div>
          <span className="secured-label">
            <Archive size={14} /> Can be restored from Trash
          </span>
        </div>
        <div className="trash-review-copy">
          <p>
            This list includes only senders whose newest message is at least six months old.
            Security, account, transaction, finance, personal, and suspicious messages are excluded.
          </p>
          <span>
            <b>
              {candidates
                .reduce((sum, item) => sum + item.messages, 0)
                .toLocaleString()}
            </b>{" "}
            messages can move to Trash from <b>{candidates.length}</b> senders
          </span>
        </div>
        <div className="trash-candidates">
          <div className="trash-candidate-head">
            <span></span>
            <span>Sender</span>
            <span>Receiving address</span>
            <span>Newest message</span>
            <span>Excluded messages</span>
            <span>Can move to Trash</span>
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
            No sender has messages old enough to move to Trash under these rules.
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
                : "Select all listed senders"}
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
        "Unsubscribing stopped. Completed requests are saved; Sift did not contact suspected spam or excluded senders.",
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
            Unsubscribe from mailing lists
          </h2>
        </div>
        <span className="secured-label">
          <ShieldCheck size={14} /> Supported one-click links only
        </span>
      </div>
      {!dashboard ? (
        <div className="analysis-empty">
          <p>
            List mailing lists that support one-click unsubscribe.
            Spam senders and senders of security, account, transaction, or finance messages are excluded.
          </p>
          <button
            className="primary-button compact"
            type="button"
            disabled={busy}
            onClick={() => void act(onScan)}
          >
            {busy ? "Finding mailing lists…" : "Find mailing lists"}
          </button>
        </div>
      ) : (
        <div className="unsubscribe-review">
          <div className="unsubscribe-summary">
            <span>
              <b>{eligible.length}</b> available one-click unsubscribes
            </span>
            <span>
              <b>{manualCount}</b> cannot unsubscribe automatically
            </span>
            <span>
              <b>{protectedCount}</b> lists excluded by message category
            </span>
            <span>
              <b>{spamCount}</b> spam senders not contacted
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
                    ? "FREQUENT"
                    : "SUGGESTED"}
                </b>
              </label>
            ))}
            {!eligible.length ? (
              <p>No mailing lists with a supported one-click unsubscribe remain.</p>
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
                  : "Select all available unsubscribes"}
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
                    I approve sending {selected.length} one-click unsubscribe request
                    {selected.length === 1 ? "" : "s"}
                  </strong>
                  <small>
                    Sift sends only the standard one-click request. It sends no
                    cookies or account credentials and never contacts senders
                    classified as spam, suspicious, transactions, security,
                    accounts, or finance.
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
                          ? "Some unsubscribe requests failed"
                          : "Unsubscribing paused"}
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
                    Resume unsubscribing
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
                    ? `Cannot unsubscribe automatically (${manualCount})`
                    : eligibility === "protected"
                      ? `Excluded by message category (${protectedCount})`
                      : `Spam senders not contacted (${spamCount})`}
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
        "Gmail sign-in did not finish. Check that the Gmail API is enabled, the Google app type is Desktop, and this Gmail address is allowed as a test user.",
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
          <ShieldCheck size={14} /> Google secure sign-in
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
                  The Google sign-in token is encrypted for this Windows user.
                  Sift never sees or stores your Google password.
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
                  ? "Gmail scan complete"
                  : audit?.state === "scanning"
                    ? "Reading Gmail message details"
                    : audit?.state === "paused" || audit?.state === "failed"
                      ? "Scan can resume where it stopped"
                      : "Ready to scan Gmail messages"}
              </strong>
              <small>
                {(audit?.indexedMessages ?? 0).toLocaleString()} messages scanned
                {audit?.totalEstimate
                  ? ` of about ${audit.totalEstimate.toLocaleString()}`
                  : ""}{" "}
                · includes Spam and Trash when choosing categories
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
                      "The Gmail scan stopped. Check the connection, then resume where it stopped.",
                    ),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              {busy
                ? "Scanning Gmail…"
                : audit?.state === "completed"
                  ? "Scan Gmail again"
                  : audit?.indexedMessages
                    ? "Resume Gmail scan"
                    : "Start Gmail scan"}
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
            Enter the client ID from a Google Cloud <strong>Desktop app</strong>
            with the Gmail API enabled. Google handles sign-in in the browser
            and returns the result directly to Sift on this computer.
          </p>
          <label>
            <span>Google client ID</span>
            <input
              required
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              placeholder="123456789-….apps.googleusercontent.com"
              autoComplete="off"
            />
          </label>
          <details>
            <summary>Client secret (usually not needed)</summary>
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
              If Google marks the app as Testing, add each Gmail address as a
              test user in Google Cloud.
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
        "Some Gmail message changes failed. Retry the failed groups, or scan again if messages or labels changed.",
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
            {trash ? "OLD GMAIL MESSAGES" : "EXISTING GMAIL MESSAGES"}
          </p>
          <h2 id={`gmail-${mode}-title`}>
            {trash
              ? "Move the approved old mail to Gmail Trash"
              : "Apply the approved labels to existing Gmail"}
          </h2>
        </div>
        <span className="secured-label">
          <ShieldCheck size={14} /> Checks labels before and after changes
        </span>
      </div>
      {!plan ? (
        <div className="analysis-empty">
          <p>
            {trash
              ? "List the selected old messages. Sift checks each message's labels before and after moving it to Trash."
              : "List the labels and existing messages that will change. Sift checks each message's current labels before and after applying the approved change."}
          </p>
          <button
            className="primary-button compact"
            disabled={busy}
            onClick={() => void act(onGenerate)}
          >
            {busy
              ? "Building message list…"
              : trash
                ? "Review Gmail messages moving to Trash"
                : "Review Gmail label and message changes"}
          </button>
        </div>
      ) : (
        <div className="cleanup-review">
          <div className="cleanup-totals">
            <div>
              <b>{plan.impactCount}</b>
              <span>
                {trash ? "senders" : "address and category groups"}
              </span>
            </div>
            <div>
              <b>{plan.existingMessageCount.toLocaleString()}</b>
              <span>existing messages</span>
            </div>
            <div>
              <b>{plan.skippedAmbiguousStreams}</b>
              <span>messages excluded</span>
            </div>
          </div>
          <div className="proposal-table">
            <div className="cleanup-impact-row cleanup-impact-head">
              <span>Receiving address or category</span>
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
                      : `${impact.markRead ? "mark read · " : ""}${impact.archive ? "remove from Inbox" : "keep in Inbox"}`}
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
                  <strong>I approve the Gmail message changes listed above</strong>
                  <small>
                    {trash
                      ? "Only the listed messages move to Gmail Trash. Security, account, transaction, finance, personal, and suspicious messages are excluded. Original labels are recorded for Undo."
                      : "Create filters in the Rules step. This step changes only the listed existing messages and records their prior labels for Undo."}
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
                  ? "Applying and checking…"
                  : trash
                    ? "Move approved mail to Gmail Trash"
                    : "Apply approved Gmail message changes"}
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
                          ? "Gmail messages moved to Trash"
                          : "Gmail message changes completed"
                        : plan.state === "failed"
                          ? "Some message groups failed"
                          : trash
                            ? "Moving Gmail messages to Trash"
                            : "Applying Gmail message changes"}
                  </strong>
                  <small>
                    {progress?.completedItems ?? 0} /{" "}
                    {progress?.totalItems ?? plan.batchCount} message groups completed
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
                    onClick={() =>
                      void act(() => onApprove(plan.id, plan.revision))
                    }
                  >
                    Resume Gmail changes
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
                    Undo completed Gmail changes
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
            <p className="eyebrow">OLD GMAIL MESSAGES</p>
            <h2>Choose senders whose old Gmail messages can move to Trash</h2>
          </div>
          <span className="secured-label">
            <Archive size={14} /> Reversible Trash only
          </span>
        </div>
        <div className="trash-review-copy">
          <p>
            Only mail older than six months is included. Security, account,
            transaction, finance, personal, suspicious, Spam, and Trash messages
            are excluded.
          </p>
          <span>
            <b>
              {candidates
                .reduce((sum, item) => sum + item.messages, 0)
                .toLocaleString()}
            </b>{" "}
            messages can move to Trash from <b>{candidates.length}</b> senders
          </span>
        </div>
        <div className="trash-candidates">
          <div className="trash-candidate-head">
            <span></span>
            <span>Sender</span>
            <span>Receiving address</span>
            <span>Newest message</span>
            <span>Excluded messages</span>
            <span>Can move to Trash</span>
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
            No Gmail sender has messages old enough to move to Trash under these rules.
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
                : "Select all listed senders"}
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
              ? "Scan Microsoft messages"
              : "Connect through Microsoft sign-in"}
          </h2>
        </div>
        <span className="secured-label">
          <ShieldCheck size={14} /> Microsoft secure sign-in
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
                  The Microsoft sign-in token is encrypted for this Windows
                  user. Sift never receives the account password.
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
                    ? "Microsoft scan complete"
                    : audit?.state === "scanning"
                      ? "Reading Microsoft message details"
                      : "Ready to scan Microsoft messages"}
                </strong>
                <small>
                  {(audit?.indexedMessages ?? 0).toLocaleString()} messages scanned
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
                      setError("The Microsoft scan stopped. Check the connection, then resume where it stopped."),
                    )
                    .finally(() => setBusy(false));
                }}
              >
                {busy
                  ? "Scanning Microsoft mail…"
                  : audit?.indexedMessages
                    ? "Resume Microsoft scan"
                    : "Start Microsoft scan"}
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
                  "Microsoft sign-in did not finish. Check that the app type is Mobile and desktop and the redirect address is http://localhost.",
                ),
              )
              .finally(() => setBusy(false));
          }}
        >
          <p>
            Create a Microsoft <strong>Mobile and desktop application</strong>{" "}
            registration with <code>http://localhost</code> as a redirect.
            Microsoft handles sign-in in the browser. No client secret is required.
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
        "Some Microsoft message changes failed. Retry the failed changes, or scan again if the messages or folders changed.",
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
            MICROSOFT {trash ? "OLD MESSAGES" : "EXISTING MESSAGES"}
          </p>
          <h2>
            {trash
              ? "Move approved old mail to Deleted Items"
              : "File existing Outlook and Hotmail messages"}
          </h2>
        </div>
        <span className="secured-label">
          <ShieldCheck size={14} /> Checks every message before changing it
        </span>
      </div>
      {!plan ? (
        <div className="analysis-empty">
          <p>
            {trash
              ? "List the old messages that will move to Deleted Items. Security, account, transaction, finance, personal, and suspicious messages are excluded."
              : "List every folder and existing message that will change. Sift reads each message again from Microsoft before recording the approved change."}
          </p>
          <button
            className="primary-button compact"
            disabled={busy}
            onClick={() => void act(onGenerate)}
          >
            {busy
              ? "Building message list…"
              : trash
                ? "Review Microsoft messages moving to Deleted Items"
                : "Review Microsoft folder and message changes"}
          </button>
        </div>
      ) : (
        <div className="cleanup-review">
          <div className="cleanup-totals">
            <div>
              <b>{plan.impactCount}</b>
              <span>address and category groups</span>
            </div>
            <div>
              <b>{plan.existingMessageCount.toLocaleString()}</b>
              <span>existing messages</span>
            </div>
            <div>
              <b>{plan.skippedAmbiguousStreams}</b>
              <span>messages excluded</span>
            </div>
          </div>
          <div className="proposal-table">
            <div className="cleanup-impact-row cleanup-impact-head">
              <span>Receiving address or category</span>
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
                    I approve the Microsoft message changes listed above
                  </strong>
                  <small>
                    Sift records each message’s original folder and read or
                    unread setting for Undo.
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
                  ? "Applying and checking…"
                  : trash
                    ? "Move approved mail to Deleted Items"
                    : "Apply approved Microsoft message changes"}
              </button>
            </div>
          ) : (
            <div className="cleanup-execution">
              <div>
                <span>
                  <strong>
                    {plan.undoJob?.state === "succeeded"
                      ? "Original folders and read settings restored"
                      : plan.state === "completed"
                        ? "Microsoft message changes completed"
                        : "Some Microsoft message changes failed"}
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
                    Undo completed Microsoft changes
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
            <p className="eyebrow">OLD MICROSOFT MESSAGES</p>
            <h2>Choose senders whose old Microsoft messages can move to Deleted Items</h2>
          </div>
          <span className="secured-label">
            <Archive size={14} /> Can be restored from Deleted Items
          </span>
        </div>
        <div className="trash-review-copy">
          <p>
            Only mail older than six months is included. Security, account,
            transaction, finance, personal, and suspicious messages are excluded.
          </p>
          <span>
            <b>
              {candidates
                .reduce((sum, item) => sum + item.messages, 0)
                .toLocaleString()}
            </b>{" "}
            messages can move to Deleted Items from <b>{candidates.length}</b> senders
          </span>
        </div>
        <div className="trash-candidates">
          <div className="trash-candidate-head">
            <span></span>
            <span>Sender</span>
            <span>Receiving address</span>
            <span>Newest message</span>
            <span>Excluded messages</span>
            <span>Can move to Deleted Items</span>
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
                : "Select all listed senders"}
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
          <h2 id="account-workspace-title">Connected email accounts</h2>
        </div>
        <span className="secured-label">
          <LockKeyhole size={14} /> Sign-in credentials stay on this computer
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
          <span>selected accounts</span>
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
                      ? "Gmail · Google sign-in"
                      : account.provider === "outlook"
                        ? "Outlook / Hotmail · Microsoft sign-in"
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
            aria-label="What Sift can do with each account"
          >
            <div className="capability-row capability-head" role="row">
              <span>Account</span>
              <span>Folders</span>
              <span>Filters</span>
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
                  {account.provider === "gmail"
                    ? "Gmail"
                    : account.provider === "outlook"
                      ? "Outlook"
                      : "Proton"}
                </strong>
                <span>{account.capabilities.organization}</span>
                <span>
                  {account.capabilities.rules === "live"
                    ? "Created automatically"
                    : "You import a Proton filter file"}
                </span>
                <span>
                  {account.capabilities.addresses === "provider"
                    ? "Read from account settings"
                    : "Found in Sent or direct delivery"}
                </span>
                <span>Uses built-in Spam and Trash</span>
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
    parts.push("The email service lists this as the primary address");
  if (identity.evidence.includes("provider_alias"))
    parts.push("The email service lists this as a sending address");
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
  return parts.join(" · ") || "Not enough information to confirm this address";
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
        `Sift could not save the decision for ${identity.address}. No folders, messages, or filters changed.`,
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
          <h2 id={`identity-${account.id}`}>Confirm your email addresses</h2>
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
                  "Address information could not be refreshed. Existing choices are unchanged.",
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
                  ? "CONFIRM OR REJECT"
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
                  <span>Create a separate folder for this address</span>
                  {identity.containerEnabled ? (
                    <input
                      aria-label={`Folder name for ${identity.address}`}
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
            Sift has not found an address that it can confirm as yours. Scan the
            account, then scan addresses again.
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
  onGenerate(
    account: MailAccountSummary,
    replaceExternalRules?: boolean,
  ): Promise<void>;
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
  const activeItems = items.filter((item) => item.enabled);
  const activeAssignments =
    proposal?.items.filter((item) => item.enabled).length ?? 0;
  const currentScopeMessages = activeItems.reduce(
    (sum, item) => sum + item.messageCount,
    0,
  );
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
        "The folder list changed before this edit was saved. Reload it and try again. No folders or messages changed.",
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
          <h2 id={`proposal-${account.id}`}>Choose folders for each category</h2>
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
                  "Finish the mailbox scan before building the folder list.",
                ),
              )
              .finally(() => setBusyKey(""));
          }}
        >
            {busyKey === "generate" ? "Building from mailbox…" : "Build from mailbox"}
        </button>
      </div>
      {!proposal ? (
        <div className="analysis-empty">
          <p>
            Build a folder list from the scanned messages and confirmed addresses.
            You can change every category and folder before approving any message changes.
          </p>
        </div>
      ) : (
        <>
          <div className="proposal-revision">
            <span>
              <b>{items.length}</b> categories shown for this address
            </span>
            <span>
              <b>{activeItems.length}</b> included ·{" "}
              {currentScopeMessages.toLocaleString()} messages included
            </span>
            <small>
              {activeAssignments} folder assignments across {scopes.length}{" "}
              address{scopes.length === 1 ? "" : "es"}
            </small>
          </div>
          <div
            className="proposal-scope-tabs"
            role="tablist"
            aria-label={`Folder choices by address for ${account.label}`}
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
                  ? `${container} folder`
                      : scope
                        ? "Uses shared folders"
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
              <span>Category and reason</span>
              <span>Folder</span>
              <span>Messages and newest date</span>
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
                          {mailCategoryLabels[category]}
                        </option>
                      ))}
                    </select>
                    <small>
                      {item.evidence.slice(0, 3).join(" · ") ||
                        "No reason available for this category"}
                    </small>
                    {item.category === "other" ? (
                      <small>
                        Messages in this category will move to Review/Unsorted,
                        be marked read, and skip the Inbox.
                      </small>
                    ) : null}
                    {item.samples.length ? (
                      <details>
                        <summary>
                          {item.samples.length} example subject
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
                    aria-label={`Folder name for ${item.category}`}
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
                      certainty
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

const SpamReviewPanel = ({
  account,
  review,
  onGenerate,
  onComplete,
}: {
  account: MailAccountSummary;
  review: SpamReview | null;
  onGenerate(account: MailAccountSummary): Promise<void>;
  onComplete(
    review: SpamReview,
    decisions: Array<{ candidateId: string; decision: SpamReviewDecision }>,
  ): Promise<void>;
}) => {
  const [decisions, setDecisions] = useState<Record<string, SpamReviewDecision>>({});
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setDecisions(
      Object.fromEntries(
        (review?.candidates ?? []).map((candidate) => [
          candidate.id,
          candidate.decision,
        ]),
      ),
    );
    setShowAll(false);
  }, [review?.id]);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setError("");
    try {
      await action();
    } catch {
      setError(
        key === "save"
          ? "Sift could not save these spam decisions. No email or filters were changed."
          : "Sift could not build the spam review from the saved scan. Run Scan again, then retry.",
      );
    } finally {
      setBusy("");
    }
  };

  if (!review) {
    return (
      <section className="readiness-panel spam-review" aria-label={`${account.label} spam review`}>
        <div className="panel-header">
          <div>
            <p className="eyebrow">{account.provider.toUpperCase()} · {account.label}</p>
            <h2>Find possible spam senders</h2>
          </div>
        </div>
        <div className="analysis-empty">
          <p>
            Sift will group likely spam, suspicious mail, and high-volume marketing by sender and receiving address. It will not mark anything as Spam automatically.
          </p>
          <button
            className="primary-button compact"
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void run("generate", () => onGenerate(account))}
          >
            {busy === "generate" ? "Building spam review…" : "Build spam review"}
          </button>
        </div>
        {error ? <p className="connection-error" role="alert">{error}</p> : null}
      </section>
    );
  }

  const selectedSpam = Object.values(decisions).filter((value) => value === "spam").length;
  const selectedNotSpam = Object.values(decisions).filter((value) => value === "not_spam").length;
  const visible = showAll ? review.candidates : review.candidates.slice(0, 25);
  const reasonLabel = {
    likely_spam: "Likely spam",
    suspicious: "Suspicious",
    bulk_mail: "High-volume marketing",
  } as const;

  return (
    <section className="readiness-panel spam-review" aria-labelledby={`spam-${account.id}`}>
      <div className="panel-header">
        <div>
          <p className="eyebrow">{account.provider.toUpperCase()} · {account.label}</p>
          <h2 id={`spam-${account.id}`}>Review possible spam</h2>
        </div>
        <span className="secured-label">
          {review.state === "completed" ? "Decisions saved" : "No automatic changes"}
        </span>
      </div>
      <div className="spam-review-summary">
        <span><b>{review.candidates.length}</b><small>senders to review</small></span>
        <span><b>{selectedSpam}</b><small>future Spam rules</small></span>
        <span><b>{selectedNotSpam}</b><small>not spam</small></span>
      </div>
      <div className="plain-logic" role="note">
        <strong>How this list is built</strong>
        <ul>
          <li>One row represents one sender domain sending to one of your addresses.</li>
          <li>Sift includes mail classified as likely spam or suspicious, plus marketing streams with at least 25 messages.</li>
          <li>Choosing Spam rule excludes that sender from normal filing filters and adds a future Spam rule in the Rules step.</li>
          <li>Choosing Not spam prevents a Spam rule. An ordinary filing filter is proposed only if the sender separately meets the Rules thresholds. Review makes no decision.</li>
        </ul>
      </div>
      {review.candidates.length ? (
        <>
          {review.state === "draft" ? (
            <div className="spam-bulk-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() =>
                  setDecisions((current) => ({
                    ...current,
                    ...Object.fromEntries(
                      review.candidates
                        .filter((candidate) => candidate.reason === "likely_spam")
                        .map((candidate) => [candidate.id, "spam" as const]),
                    ),
                  }))
                }
              >
                Select all likely spam
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() =>
                  setDecisions(
                    Object.fromEntries(
                      review.candidates.map((candidate) => [candidate.id, "review" as const]),
                    ),
                  )
                }
              >
                Clear choices
              </button>
            </div>
          ) : null}
          <div className="spam-candidate-list">
            <div className="spam-candidate-head">
              <span>Sender and address</span>
              <span>Why it is shown</span>
              <span>History</span>
              <span>Decision</span>
            </div>
            {visible.map((candidate) => {
              const age = recency(candidate.latestAt);
              return (
                <div className="spam-candidate-row" key={candidate.id}>
                  <span>
                    <strong>{candidate.senderDomain}</strong>
                    <small>{candidate.receivingAddress}</small>
                  </span>
                  <span>
                    <strong>{reasonLabel[candidate.reason]}</strong>
                    <small>{mailCategoryLabels[candidate.category]} · {Math.round(candidate.confidence * 100)}% confidence · {Math.round(candidate.categoryShare * 100)}% of this sender’s mail</small>
                  </span>
                  <span>
                    <strong>{candidate.messageCount.toLocaleString()} messages</strong>
                    <small>{age.label}</small>
                  </span>
                  <label>
                    <span className="sr-only">Decision for {candidate.senderDomain}</span>
                    <select
                      value={decisions[candidate.id] ?? "review"}
                      disabled={review.state === "completed"}
                      onChange={(event) =>
                        setDecisions((current) => ({
                          ...current,
                          [candidate.id]: event.target.value as SpamReviewDecision,
                        }))
                      }
                    >
                      <option value="review">Review — no change</option>
                      <option value="not_spam">Not spam</option>
                      <option value="spam">Spam rule</option>
                    </select>
                  </label>
                </div>
              );
            })}
          </div>
          {review.candidates.length > 25 ? (
            <button className="sender-expand" type="button" onClick={() => setShowAll((value) => !value)}>
              {showAll ? "Show first 25 senders" : `Show all ${review.candidates.length} senders`}
            </button>
          ) : null}
        </>
      ) : (
        <div className="analysis-empty">
          <p>No likely spam, suspicious, or high-volume marketing streams were found. Save the empty review to continue.</p>
        </div>
      )}
      <div className="next-action spam-review-action">
        <span>
          <strong>
            {review.state === "completed" ? "Spam decisions are saved" : "Save these decisions before creating normal filters"}
          </strong>
          <small>
            {review.state === "completed"
              ? "Rules will use these choices. Generate a new review if the mailbox scan changes."
              : "This saves decisions only. Existing messages are not moved on this page; selected future Spam rules are created in Rules."}
          </small>
        </span>
        {review.state === "completed" ? (
          <button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={() => void run("generate", () => onGenerate(account))}>
            {busy === "generate" ? "Rebuilding…" : "Build review again"}
          </button>
        ) : (
          <button
            className="primary-button compact"
            type="button"
            disabled={Boolean(busy)}
            onClick={() =>
              void run("save", () =>
                onComplete(
                  review,
                  review.candidates.map((candidate) => ({
                    candidateId: candidate.id,
                    decision: decisions[candidate.id] ?? "review",
                  })),
                ),
              )
            }
          >
            {busy === "save" ? "Saving decisions…" : "Save spam decisions"}
          </button>
        )}
      </div>
      {error ? <p className="connection-error" role="alert">{error}</p> : null}
    </section>
  );
};

const RuleReconciliationPanel = ({
  account,
  inventory,
  plan,
  organizationReady,
  onOpenOrganize,
  onRefresh,
  onGenerate,
  onApprove,
  onRetry,
  onUndo,
  onExportProton,
  onConfirmProtonImport,
  freshSlate = false,
}: {
  account: MailAccountSummary;
  inventory: RuleInventory | null;
  plan: RuleReconciliationPlan | null;
  organizationReady: boolean;
  onOpenOrganize(): void;
  onRefresh(account: MailAccountSummary): Promise<void>;
  onGenerate(
    account: MailAccountSummary,
    replaceExternalRules?: boolean,
  ): Promise<void>;
  onApprove(
    plan: RuleReconciliationPlan,
    enabledOperationIds: string[],
  ): Promise<void>;
  onRetry(plan: RuleReconciliationPlan): Promise<void>;
  onUndo(plan: RuleReconciliationPlan): Promise<void>;
  onExportProton(
    plan: RuleReconciliationPlan,
    enabledOperationIds: string[],
  ): Promise<string>;
  onConfirmProtonImport(plan: RuleReconciliationPlan): Promise<void>;
  freshSlate?: boolean;
}) => {
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [showAllOperations, setShowAllOperations] = useState(false);
  const [existingRuleMode, setExistingRuleMode] = useState<"retain" | "replace">("retain");
  const [protonOldFiltersCleared, setProtonOldFiltersCleared] = useState(false);
  const [enabledOperationIds, setEnabledOperationIds] = useState<string[]>([]);
  useEffect(() => {
    setEnabledOperationIds(
      plan?.operations
        .filter((operation) => operation.enabled && operation.kind !== "unchanged")
        .map((operation) => operation.id) ?? [],
    );
    setConsent(false);
  }, [plan?.id]);
  const act = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setError("");
    setStatus("");
    try {
      await action();
    } catch {
      setError(
        "The filter changes stopped. Completed changes remain saved. Scan the email service's filters again before retrying.",
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
  const selectedActionable = actionable.filter((operation) =>
    enabledOperationIds.includes(operation.id),
  );
  const externalRemovals =
    plan?.operations.filter(
      (operation) =>
        enabledOperationIds.includes(operation.id) &&
        operation.kind === "remove" &&
        operation.prior?.ownership === "external",
    ).length ?? 0;
  const failed =
    plan?.operations.filter((operation) =>
      ["failed", "verification_mismatch"].includes(operation.state),
    ) ?? [];
  const completed =
    plan?.operations.filter(
      (operation) => operation.enabled && operation.state === "succeeded",
    )
      .length ?? 0;
  const protonImportPending =
    account.provider === "proton" &&
    plan?.state === "approved" &&
    Boolean(selectedActionable.length) &&
    selectedActionable.every((operation) => operation.state === "succeeded");
  const visibleOperations = showAllOperations
    ? (plan?.operations ?? [])
    : (plan?.operations.slice(0, 25) ?? []);
  const operationLabels = {
    create: "CREATE FILTER",
    replace: "REPLACE FILTER",
    remove: "DELETE FILTER",
    adopt: "USE EXISTING FILTER",
    unchanged: "KEEP FILTER",
  } as const;
  const operationStateLabels: Record<
    RuleReconciliationPlan["operations"][number]["state"],
    string
  > = {
    pending: "Waiting",
    running: "Applying",
    succeeded: "Complete",
    failed: "Failed",
    verification_mismatch: "Needs another check",
    undone: "Undone",
  };
  const operationEffect = (
    operation: RuleReconciliationPlan["operations"][number],
  ): string => {
    const desired = operation.desired ?? operation.priorManaged;
    if (operation.kind === "remove") {
      return operation.prior?.ownership === "external"
        ? "Delete this existing filter. It will no longer affect future messages."
        : "Delete this filter created by Sift. It will no longer affect future messages.";
    }
    if (!desired) return "This filter has no change to show.";
    const consequences = [
      desired.spam
        ? "send it to Spam"
        : `file it in “${desired.targetPath}”`,
      desired.markRead ? "mark it read" : null,
      desired.archive ? "remove it from the inbox" : null,
    ].filter((value): value is string => Boolean(value));
    const behavior = consequences.join(", ");
    const basis = `${desired.observedMessages.toLocaleString()} previous messages · ${Math.round((desired.categoryShare ?? 1) * 100)}% one category · ${Math.round(desired.confidence * 100)}% confidence.`;
    if (operation.kind === "adopt") {
      return `Use this existing filter without changing it. Future matches will ${behavior}. ${basis}`;
    }
    if (operation.kind === "replace") {
      return `Replace the older filter created by Sift. Future matches will ${behavior}. ${basis}`;
    }
    if (operation.kind === "unchanged") {
      return `Keep this existing filter. Future matches will ${behavior}. ${basis}`;
    }
    return account.provider === "proton"
      ? `Add this filter to the Proton filter file. Future matches will ${behavior}. ${basis}`
      : `Create this filter. Future matches will ${behavior}. ${basis}`;
  };
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
              ? "Review Gmail filters"
              : account.provider === "outlook"
                ? "Review Outlook inbox rules"
                : "Create Proton filters"}
          </h2>
        </div>
        <span className="secured-label">
          <ShieldCheck size={14} />
          {account.provider === "gmail"
            ? "Reads current Gmail filters"
            : account.provider === "outlook"
              ? "Reads current Outlook rules"
              : "Save a file, then import it in Proton"}
        </span>
      </div>
      <div className="rule-capability">
        <p>
          {account.provider === "gmail"
            ? "Sift reads your current Gmail filters. You can keep unrelated filters or review and delete filters that are not in this list."
            : account.provider === "outlook"
              ? "Sift reads your current Outlook inbox rules. You can keep unrelated rules or review and delete rules that are not in this list."
              : "Proton Bridge cannot read or delete filters in Proton Mail. Sift checks only files it previously saved. Review the new filters below, save the file, then import it in Proton Mail."}
        </p>
        <button
          className="secondary-button"
          type="button"
          disabled={Boolean(busy)}
          onClick={() => void act("inventory", () => onRefresh(account))}
        >
          {busy === "inventory"
            ? account.provider === "proton"
              ? "Checking saved files…"
              : "Reading filters…"
            : account.provider === "proton"
              ? "Check saved filter files"
              : inventory
                ? "Scan filters again"
                : "Scan existing filters"}
        </button>
      </div>
      {account.provider === "proton" && freshSlate ? (
        <div className="cleanup-structural-error proton-filter-boundary" role="note">
          <strong>Remove old Proton filters before importing the new filter</strong>
          <small>
            Proton Bridge cannot read or delete filters created in Proton Mail. Disable or remove the old filters in Proton Mail → Settings → All settings → Filters before importing Sift’s new filter file; otherwise both filters can act on the same message.
          </small>
          <label>
            <input
              type="checkbox"
              checked={protonOldFiltersCleared}
              onChange={(event) => setProtonOldFiltersCleared(event.target.checked)}
            />
            <span>I disabled the old Proton filters</span>
          </label>
        </div>
      ) : null}
      <div
        className={`rule-folder-gate ${organizationReady ? "ready" : "blocked"}`}
        role="status"
      >
        <span>
          {organizationReady ? <Check size={16} /> : <FolderTree size={16} />}
        </span>
        <div>
          <strong>
            {organizationReady
              ? "The required folders exist"
              : "Create the folders before enabling filters"}
          </strong>
          <small>
            {organizationReady
              ? "The Organize step created the folders used by these filters."
              : "You can review filter changes now, but Sift cannot apply or export them until the Organize step creates every required folder."}
          </small>
        </div>
        {!organizationReady ? (
          <button
            className="secondary-button compact"
            type="button"
            onClick={onOpenOrganize}
          >
            Open Organize
          </button>
        ) : null}
      </div>
      <div className="plain-logic rule-logic" role="note">
        <strong>How Sift proposes filing filters</strong>
        <ul>
          <li>One filter matches one sender domain sending to one of your addresses.</li>
          <li>The sender must have at least 3 matching messages, at least 90% in one category, and at least 82% classification confidence.</li>
          <li>Personal, Security, Suspicious, Spam, and Unsorted mail never become ordinary filing filters.</li>
          <li>Approved Spam decisions are carried over as Spam rules. Every other proposed filter files the message, marks it read, and removes it from Inbox when the provider supports that action.</li>
          <li>You can uncheck any change below. Unchecked changes are not created, replaced, adopted, or deleted.</li>
        </ul>
      </div>
      {inventory ? (
        <div className="rule-inventory-metrics">
          <span>
            <b>{inventory.rules.length}</b>
            <small>
              {account.provider === "gmail"
                ? "Gmail filters found"
                : account.provider === "outlook"
                  ? "Outlook inbox rules found"
                  : "filter files previously saved by Sift"}
            </small>
          </span>
          <span>
            <b>{managedCount}</b>
            <small>created by Sift</small>
          </span>
          <span>
            <b>{externalCount}</b>
            <small>created outside Sift</small>
          </span>
          <span>
            <b>{inventory.providerLimit ?? "—"}</b>
            <small>maximum filters allowed</small>
          </span>
        </div>
      ) : null}
      {!inventory ? (
        <div className="analysis-empty">
          <p>
            {account.provider === "proton"
              ? "Check for Proton filter files previously saved by Sift before creating the new filter list. Proton Bridge cannot read filters created in Proton Mail."
              : "Scan the existing filters before creating a list of changes. This prevents duplicates and shows which filters Sift will leave unchanged."}
          </p>
        </div>
      ) : !plan ? (
        <div className="analysis-empty">
          <p>
            Choose whether to keep unrelated existing filters or delete them.
            The next screen lists every filter Sift will create, keep, replace, or delete.
          </p>
          <div className="rule-strategy-grid">
            <button
              type="button"
              className={existingRuleMode === "retain" ? "active" : ""}
              onClick={() => setExistingRuleMode("retain")}
            >
              <strong>Keep unrelated existing filters</strong>
              <small>Use identical existing filters, replace outdated filters created by Sift, and leave every other filter unchanged.</small>
            </button>
            <button
              type="button"
              className={existingRuleMode === "replace" ? "active" : ""}
              disabled={account.provider === "proton"}
              onClick={() => setExistingRuleMode("replace")}
            >
              <strong>Delete unrelated existing filters</strong>
              <small>
                {account.provider === "proton"
                  ? "Unavailable through Bridge: Proton exposes filter management only in Proton Mail settings."
                  : `Delete ${externalCount} existing rule${externalCount === 1 ? "" : "s"} that are not in this list. Keep identical rules.`}
              </small>
            </button>
          </div>
          <button
            className="primary-button compact"
            type="button"
            disabled={Boolean(busy)}
            onClick={() =>
              void act("plan", () =>
                onGenerate(account, existingRuleMode === "replace"),
              )
            }
          >
            {busy === "plan"
              ? "Preparing filter changes…"
              : "Review filter changes"}
          </button>
        </div>
      ) : (
        <div className="rule-plan-review">
          <div className="proposal-revision">
            <span>
              <b>{selectedActionable.length}</b> selected filter changes
            </span>
            <span>
              <b>{actionable.length - selectedActionable.length}</b> unchecked · <b>{plan.operations.length - actionable.length}</b> already
              correct · no change
            </span>
          </div>
          <div className="rule-plan-explainer" role="note">
            <ShieldCheck size={16} />
            <span>
              <strong>Nothing changes until you approve.</strong>
              <small>
                These filters affect future messages only. They do not move or
                delete existing email. Each effect is written below.
              </small>
            </span>
          </div>
          <div className="rule-operation-list">
            <div className="rule-operation-head">
              <span>Use</span>
              <span>Change</span>
              <span>Matches future mail from / to</span>
              <span>What it does</span>
              <span>Status</span>
            </div>
            {visibleOperations.map((operation) => (
              <div
                className={`rule-operation-row ${operation.kind}`}
                key={operation.id}
              >
                <span className="rule-operation-use">
                  <input
                    type="checkbox"
                    aria-label={`${enabledOperationIds.includes(operation.id) ? "Exclude" : "Include"} filter for ${operation.desired?.senderDomain ?? operation.prior?.criteria.from ?? "existing rule"}`}
                    checked={operation.kind === "unchanged" || enabledOperationIds.includes(operation.id)}
                    disabled={operation.kind === "unchanged" || plan.state !== "draft"}
                    onChange={(event) =>
                      setEnabledOperationIds((current) =>
                        event.target.checked
                          ? [...new Set([...current, operation.id])]
                          : current.filter((id) => id !== operation.id),
                      )
                    }
                  />
                </span>
                <b>{operationLabels[operation.kind]}</b>
                <span>
                  <strong>
                    {operation.desired?.senderDomain ??
                      operation.prior?.criteria.from ??
                      "Filter being removed"}
                  </strong>
                  <small>
                    {operation.desired?.receivingAddress ??
                      operation.prior?.criteria.to ??
                      "Any receiving address"}
                  </small>
                </span>
                <span className="rule-operation-effect">
                  {operationEffect(operation)}
                </span>
                <em>{operationStateLabels[operation.state]}</em>
              </div>
            ))}
          </div>
          {plan.operations.length > 25 ? (
            <button
              className="sender-expand rule-operation-expand"
              type="button"
              onClick={() => setShowAllOperations((current) => !current)}
            >
              {showAllOperations
                ? "Show the first 25 rules"
                : `Show all ${plan.operations.length} filters`}
            </button>
          ) : null}
          {plan.state === "draft" ? (
            <div className="cleanup-approval">
              <label>
                <input
                  type="checkbox"
                  checked={consent}
                  disabled={!organizationReady || (account.provider === "proton" && freshSlate && !protonOldFiltersCleared)}
                  onChange={(event) => setConsent(event.target.checked)}
                />
                <span>
                  <strong>
                    {organizationReady
                      ? "I approve the filter changes listed above"
                      : "Approval is locked until Organize creates the folders"}
                  </strong>
                  <small>
                    {!organizationReady
                      ? "Return to Organize and create the folders, then come back to review these filters again."
                      : account.provider !== "proton"
                      ? externalRemovals
                        ? `${externalRemovals} selected existing ${account.provider === "gmail" ? "filters" : "inbox rules"} will be deleted. Identical rules are kept. Sift cannot automatically undo those deletions.`
                        : `${externalCount} unrelated existing ${account.provider === "gmail" ? "filters" : "inbox rules"} remain unchanged. Sift checks each filter after applying it.`
                      : "This saves a Proton filter file for you to review and import in Proton Mail."}
                  </small>
                </span>
              </label>
              <button
                className="primary-button"
                type="button"
                disabled={!organizationReady || !consent || Boolean(busy) || (account.provider === "proton" && freshSlate && !protonOldFiltersCleared)}
                onClick={() =>
                  void act("apply", async () => {
                    if (account.provider === "proton")
                      setStatus(await onExportProton(plan, enabledOperationIds));
                    else await onApprove(plan, enabledOperationIds);
                  })
                }
              >
                {busy === "apply"
                  ? account.provider === "proton"
                    ? "Preparing export…"
                    : "Applying and checking…"
                  : account.provider === "proton"
                    ? "Save Proton filter file"
                    : `Apply ${selectedActionable.length} filter changes`}
              </button>
            </div>
          ) : (
            <div className="rule-plan-actions">
              <span>
                <strong>
                  {plan.state === "completed"
                    ? "Filter changes completed"
                    : protonImportPending
                      ? "Proton filter file saved — not yet imported"
                    : plan.state === "undone"
                        ? "Completed filter changes undone"
                      : plan.state === "failed"
                          ? "Some filter changes failed"
                          : "Filter changes in progress"}
                </strong>
                <small>
                  {protonImportPending
                    ? "Import the saved file in Proton Mail Settings → Filters → Sieve, enable it, then confirm below."
                    : `${completed} / ${plan.operations.filter((operation) => operation.enabled && operation.kind !== "unchanged").length} filter changes completed`}
                </small>
              </span>
              <div>
                {protonImportPending ? (
                  <button
                    className="primary-button compact"
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => void act("confirm-import", () => onConfirmProtonImport(plan))}
                  >
                    {busy === "confirm-import" ? "Confirming…" : "I imported and enabled the Sieve filter"}
                  </button>
                ) : null}
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
                {account.provider !== "proton" &&
                plan.state === "completed" &&
                completed &&
                externalRemovals === 0 ? (
                  <button
                    className="secondary-button danger"
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => void act("undo", () => onUndo(plan))}
                  >
                    {busy === "undo" ? "Restoring…" : "Undo filter changes Sift can reverse"}
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

const RecoveryPanel = ({
  diagnostics,
  onCheck,
  onExport,
  onBackup,
  onRestore,
  onRebuild,
}: {
  diagnostics: DiagnosticsSummary | null;
  onCheck(): Promise<DiagnosticsSummary>;
  onExport(): Promise<DiagnosticsExportResult>;
  onBackup(): Promise<BackupResult>;
  onRestore(): Promise<RestoreResult | null>;
  onRebuild(): Promise<RebuildIndexResult>;
}) => {
  const [busy, setBusy] = useState<
    "check" | "export" | "backup" | "restore" | "rebuild" | null
  >(null);
  const [restoreConfirmation, setRestoreConfirmation] = useState("");
  const [rebuildConfirmation, setRebuildConfirmation] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const run = async (action: typeof busy, task: () => Promise<string>) => {
    if (!action) return;
    setBusy(action);
    setError("");
    try {
      setNotice(await task());
    } catch (cause) {
      setNotice("");
      setError(cause instanceof Error ? cause.message : "The action failed.");
    } finally {
      setBusy(null);
    }
  };
  const indexedTotal = diagnostics
    ? Object.values(diagnostics.indexedMessages).reduce(
        (sum, count) => sum + count,
        0,
      )
    : 0;

  return (
    <>
      <section
        className="readiness-panel recovery-panel"
        aria-labelledby="health-title"
      >
        <div className="panel-header">
          <div>
            <p className="eyebrow">LOCAL DATA</p>
            <h2 id="health-title">Check local data for errors</h2>
          </div>
          <span className="secured-label">
            <LockKeyhole size={14} /> Counts only—no mail content
          </span>
        </div>
        {diagnostics ? (
          <div className="recovery-metrics">
            <div>
              <b>{diagnostics.integrity === "ok" ? "NO ERRORS" : "ERROR FOUND"}</b>
              <span>saved Sift data</span>
            </div>
            <div>
              <b>{diagnostics.foreignKeyViolations}</b>
              <span>relationship errors</span>
            </div>
            <div>
              <b>{indexedTotal.toLocaleString()}</b>
              <span>messages in saved scans</span>
            </div>
            <div>
              <b>v{diagnostics.appVersion}</b>
              <span>Sift version</span>
            </div>
          </div>
        ) : (
          <p className="recovery-copy">
            Check the local database before changing many messages. The exported
            report contains the app version, platform, counts, and error results.
            It does not contain email addresses, subjects, senders, folder paths, or credentials.
          </p>
        )}
        <div className="panel-action connection-actions">
          <button
            className="primary-button compact"
            type="button"
            disabled={busy !== null}
            onClick={() =>
              void run("check", async () => {
                const result = await onCheck();
                return result.integrity === "ok"
                  ? "The local database has no errors."
                  : "The local database has an error. Create a backup before continuing.";
              })
            }
          >
            {busy === "check" ? "Checking…" : "Check local data"}
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={busy !== null}
            onClick={() =>
              void run("export", async () => {
                const result = await onExport();
                return result.canceled
                  ? "Report export canceled."
                  : "Report saved without email content.";
              })
            }
          >
            {busy === "export" ? "Exporting…" : "Export report without email content"}
          </button>
        </div>
      </section>

      <section
        className="readiness-panel recovery-panel"
        aria-labelledby="backup-title"
      >
        <div className="panel-header">
          <div>
            <p className="eyebrow">ENCRYPTED BACKUP</p>
            <h2 id="backup-title">
              Back up this local profile
            </h2>
          </div>
          <span className="secured-label">
            <ShieldCheck size={14} /> Encrypted for this Windows user
          </span>
        </div>
        <p className="recovery-copy">
          A backup includes saved scans, decisions, account connections, and
          encrypted sign-in credentials. Windows protects the backup key, so
          restore it with the same Windows user on this device. The messages
          themselves remain with Proton, Google, or Microsoft.
        </p>
        <div className="panel-action connection-actions">
          <button
            className="primary-button compact"
            type="button"
            disabled={busy !== null}
            onClick={() =>
              void run("backup", async () => {
                const result = await onBackup();
                return result.canceled
                  ? "Backup canceled."
                  : `Encrypted backup created (${Math.ceil(result.bytes / 1024).toLocaleString()} KB).`;
              })
            }
          >
            {busy === "backup" ? "Encrypting…" : "Create encrypted backup"}
          </button>
        </div>
        <div className="recovery-confirmation">
          <label>
            <span>Restore confirmation</span>
            <input
              value={restoreConfirmation}
              onChange={(event) => setRestoreConfirmation(event.target.value)}
              placeholder="Type RESTORE LOCAL PROFILE"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <button
            className="secondary-button danger"
            type="button"
            disabled={
              busy !== null || restoreConfirmation !== "RESTORE LOCAL PROFILE"
            }
            onClick={() =>
              void run("restore", async () => {
                const result = await onRestore();
                setRestoreConfirmation("");
                return result
                  ? `Profile restored with ${result.secretFiles} saved account credential${result.secretFiles === 1 ? "" : "s"}.`
                  : "Restore canceled.";
              })
            }
          >
            {busy === "restore" ? "Restoring…" : "Choose backup and restore"}
          </button>
        </div>
      </section>

      <section
        className="readiness-panel recovery-panel"
        aria-labelledby="rebuild-title"
      >
        <div className="panel-header">
          <div>
            <p className="eyebrow">DELETE SAVED SCAN</p>
            <h2 id="rebuild-title">
              Delete the local scan and start again
            </h2>
          </div>
        </div>
        <p className="recovery-copy">
          This deletes saved message information, categories, folder lists, and
          unfinished changes. It keeps email connections, encrypted credentials,
          records of filters created by Sift, completed unsubscribe requests, and
          all email held by Proton, Google, or Microsoft. You will need to scan again.
        </p>
        <div className="recovery-confirmation">
          <label>
            <span>Delete confirmation</span>
            <input
              value={rebuildConfirmation}
              onChange={(event) => setRebuildConfirmation(event.target.value)}
              placeholder="Type DELETE SAVED SCAN"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <button
            className="secondary-button danger"
            type="button"
            disabled={
              busy !== null || rebuildConfirmation !== "DELETE SAVED SCAN"
            }
            onClick={() =>
              void run("rebuild", async () => {
                const result = await onRebuild();
                setRebuildConfirmation("");
                return `Deleted saved information for ${result.clearedMessages.toLocaleString()} messages. Kept ${result.preservedConnections} connections and records for ${result.preservedManagedRules} filters created by Sift.`;
              })
            }
          >
            {busy === "rebuild" ? "Deleting saved scan…" : "Delete saved scan"}
          </button>
        </div>
      </section>

      <section
        className="recovery-guidance"
        aria-label="Update and removal guidance"
      >
        <div>
          <strong>Updates and older versions</strong>
          <p>
            Automatic downloads are controlled in Settings. Choosing Later keeps
            Sift open; an already-downloaded update applies the next time Sift
            starts. If an update causes a problem, create a backup and reinstall
            an earlier version from the Releases page. Some older versions may
            not be able to open data saved by a newer version.
          </p>
        </div>
        <div>
          <strong>Before uninstalling on a shared computer</strong>
          <p>
            Disconnect email accounts first. Removing Sift may leave encrypted
            profile files in Windows application storage, so uninstalling alone
            may not remove all local data.
          </p>
        </div>
      </section>
      {notice ? (
        <p className="recovery-notice" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="connection-error" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
};

const AppShell = ({
  profileName,
  onSwitchProfile,
  settings,
  onUpdateSettings,
  onCheckForUpdates,
  accounts,
  identities,
  onSelectAccount,
  onRefreshIdentities,
  onUpdateIdentity,
  proposals,
  onGenerateProposal,
  onEditProposal,
  spamReviews,
  onGenerateSpamReview,
  onCompleteSpamReview,
  ruleInventories,
  rulePlans,
  onRefreshRuleInventory,
  onGenerateRulePlan,
  onApproveRulePlan,
  onRetryRulePlan,
  onUndoRulePlan,
  onExportProtonRulePlan,
  onConfirmProtonRuleImport,
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
  diagnostics,
  onCheckDiagnostics,
  onExportDiagnostics,
  onCreateBackup,
  onRestoreBackup,
  onRebuildIndex,
}: AppShellProps) => {
  const [activePage, setActivePage] = useState<PageId>("overview");
  const [scanInventoryBusy, setScanInventoryBusy] = useState(false);
  const [scanInventoryError, setScanInventoryError] = useState("");
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
  const accountIsScanned = (account: MailAccountSummary): boolean =>
    account.provider === "proton"
      ? Boolean(protonAudit?.indexedMessages)
      : account.provider === "gmail"
        ? Boolean(gmailAudit?.indexedMessages)
        : Boolean(outlookAudit?.indexedMessages);
  const scannedAccounts = selectedAccounts.filter(accountIsScanned);
  const scanInventoryReady =
    selectedAccounts.length > 0 &&
    selectedAccounts.every(
      (account) => accountIsScanned(account) && Boolean(ruleInventories[account.id]),
    );
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
  const foldersReadyFor = (account: MailAccountSummary): boolean => {
    const proposal = proposals[account.id];
    if (!proposal) return false;
    if (account.provider === "proton") {
      const completedPlanMatches = Boolean(
        cleanupPlan?.kind === "organize" &&
          cleanupPlan.state === "completed" &&
          cleanupPlan.proposalId === proposal.id &&
          cleanupPlan.proposalRevision === proposal.revision,
      );
      if (completedPlanMatches) return true;
      const requiredTargets = proposal.items
        .filter(
          (item) =>
            item.enabled &&
            !["personal", "suspicious", "spam"].includes(item.category),
        )
        .map((item) => item.targetPath);
      const discoveredContainers =
        protonDiscovery?.connectionId === account.id
          ? protonDiscovery.mailboxes.map((mailbox) => ({
              path: mailbox.path,
              delimiter: mailbox.delimiter,
            }))
          : [];
      const inventoriedContainers = (
        ruleInventories[account.id]?.containers ?? []
      ).map((path) => ({ path }));
      return providerHasDestinations("proton", requiredTargets, [
        ...discoveredContainers,
        ...inventoriedContainers,
      ]);
    }
    const historyPlan =
      account.provider === "gmail"
        ? gmailOrganization
        : outlookOrganization;
    return Boolean(
      historyPlan?.kind === "organize" &&
        historyPlan.state === "completed" &&
        historyPlan.proposalId === proposal.id &&
        historyPlan.proposalRevision === proposal.revision,
    );
  };
  const spamReadyFor = (account: MailAccountSummary): boolean =>
    foldersReadyFor(account) && spamReviews[account.id]?.state === "completed";
  const rulesReadyFor = (account: MailAccountSummary): boolean =>
    spamReadyFor(account) && rulePlans[account.id]?.state === "completed";
  const subscriptionDashboardFor = (
    account: MailAccountSummary,
  ): SubscriptionDashboard | null =>
    account.provider === "proton"
      ? subscriptions
      : account.provider === "gmail"
        ? gmailSubscriptions
        : outlookSubscriptions;
  const unsubscribeReadyFor = (account: MailAccountSummary): boolean => {
    const dashboard = subscriptionDashboardFor(account);
    if (!dashboard) return false;
    return dashboard.candidates.every(
      (candidate) =>
        candidate.eligibility !== "eligible" ||
        candidate.status === "unsubscribed" ||
        candidate.status === "manual",
    );
  };
  const organizationReady =
    selectedAccounts.length > 0 && selectedAccounts.every(foldersReadyFor);
  const spamReady =
    selectedAccounts.length > 0 && selectedAccounts.every(spamReadyFor);
  const rulesReady =
    selectedAccounts.length > 0 && selectedAccounts.every(rulesReadyFor);
  const unsubscribeReady =
    selectedAccounts.length > 0 && selectedAccounts.every(unsubscribeReadyFor);
  const completeScanInventory = async () => {
    setScanInventoryBusy(true);
    setScanInventoryError("");
    try {
      await Promise.all(scannedAccounts.map((account) => onRefreshRuleInventory(account)));
    } catch {
      setScanInventoryError(
        "Sift could not scan every selected account's folders and filters. The message scans remain saved.",
      );
    } finally {
      setScanInventoryBusy(false);
    }
  };

  const taskIntro = (
    title: string,
    goal: string,
    method: readonly string[] = [],
  ) => (
    <div className="page-heading task-heading">
      <h1>{title}</h1>
      <p><strong>Goal:</strong> {goal}</p>
      {method.length ? (
        <div className="page-method" role="note">
          <strong>How this page works</strong>
          <ul>{method.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
      ) : null}
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
            <ShieldCheck size={14} /> Stored on this computer
          </div>
        </header>
        <main className="overview">
          {activePage === "overview" ? (
            <>
              <section className="product-hero">
                <div>
                  <p className="eyebrow">EMAIL ORGANIZATION</p>
                  <h1>Scan, organize, block spam, filter, unsubscribe, and delete.</h1>
                  <p>
                    Each step shows the messages, folders, filters, or
                    subscriptions it will change before you approve anything.
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
                          ? "Continue setup"
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
                  aria-label="Setup progress"
                >
                  <div>
                    <b>{connectedCount}</b>
                    <span>accounts connected</span>
                  </div>
                  <div>
                    <b>{scannedCount}</b>
                    <span>accounts scanned</span>
                  </div>
                  <div>
                    <b>{organizedCount}</b>
                    <span>folder lists ready</span>
                  </div>
                </div>
              </section>
              <section
                className="workflow-section"
                aria-labelledby="workflow-title"
              >
                <div className="section-heading">
                  <h2 id="workflow-title">
                    Complete these steps in order
                  </h2>
                  <p>
                    Each page has one job. Later steps remain locked until the
                    required folders and filters from earlier steps exist.
                  </p>
                </div>
                <ol className="workflow-steps">
                  <li>
                    <span>1</span>
                    <div>
                      <strong>Scan</strong>
                      <p>Read messages, aliases, folders, labels, and existing filters without changing them.</p>
                    </div>
                  </li>
                  <li>
                    <span>2</span>
                    <div>
                      <strong>Organize</strong>
                      <p>Confirm aliases, create or use folders, then move and mark existing messages read.</p>
                    </div>
                  </li>
                  <li>
                    <span>3</span>
                    <div>
                      <strong>Spam</strong>
                      <p>Decide which suspicious or high-volume senders should be treated as Spam before normal filters are proposed.</p>
                    </div>
                  </li>
                  <li>
                    <span>4</span>
                    <div>
                      <strong>Rules</strong>
                      <p>Create or keep filters for recurring, non-spam mail that move messages into folders and mark them read.</p>
                    </div>
                  </li>
                  <li>
                    <span>5</span>
                    <div>
                      <strong>Unsubscribe</strong>
                      <p>Unsubscribe from legitimate mailing lists with supported one-click links. Suspected spam is never contacted.</p>
                    </div>
                  </li>
                  <li>
                    <span>6</span>
                    <div>
                      <strong>Delete</strong>
                      <p>Move approved old messages to Trash or Deleted Items. Security, account, transaction, finance, personal, and suspicious messages are excluded.</p>
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
                        ? "Scan the connected accounts"
                        : addressReviewCount
                          ? "Confirm addresses and choose separate folders"
                          : "Review folders for the scanned messages"}
                  </strong>
                  <small>
                    {emptyAccounts
                      ? "Connect Proton, Gmail, Outlook, or Hotmail."
                      : scannedCount < connectedCount
                        ? "Scan messages, addresses, folders, labels, and existing filters first."
                        : addressReviewCount
                          ? `${addressReviewCount} address${addressReviewCount === 1 ? " needs" : "es need"} confirmation in Organize.`
                          : "Open Organize to review suggested folders and existing-message changes."}
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
                          : "organize",
                    )
                  }
                >
                  {emptyAccounts
                    ? "Open accounts"
                    : scannedCount < connectedCount
                      ? "Open scan"
                      : addressReviewCount
                        ? "Open organize"
                        : "Open organize"}
                </button>
              </section>
            </>
          ) : null}

          {activePage === "accounts" ? (
            <>
              {taskIntro(
                "Connect email accounts",
                "Add accounts and choose which account Sift should work on.",
                [
                  "Proton connects locally through Proton Bridge.",
                  "Gmail and Microsoft accounts connect through the provider’s browser sign-in.",
                  "Connecting an account saves an encrypted credential on this computer. It does not scan or change email.",
                ],
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
                "Scan messages and account settings",
                "Create a local inventory before any mailbox changes are proposed.",
                [
                  "Sift reads message senders, recipients, dates, headers, folders, labels, aliases, and filter inventory when the provider exposes it.",
                  "It classifies messages from their content and headers, then groups repeated sender patterns by receiving address.",
                  "The scan is read-only, stays on this computer, and can resume after interruption.",
                ],
              )}
              {emptyAccounts ? (
                prerequisite(
                  "Connect an account first",
                  "Connect an email account before starting a scan.",
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
                  {scannedAccounts.length ? (
                    <section className="readiness-panel scan-inventory-panel">
                      <div className="panel-header">
                        <div>
                          <p className="eyebrow">STEP 1 · SCAN</p>
                          <h2>Scan folders, aliases, and existing filters</h2>
                        </div>
                        <span className="secured-label">
                          <ShieldCheck size={14} /> Does not change email
                        </span>
                      </div>
                      <div className="scan-inventory-list">
                        {selectedAccounts.map((account) => {
                          const accountIdentities = identities[account.id] ?? [];
                          const inventory = ruleInventories[account.id] ?? null;
                          const messageCount = account.provider === "proton"
                            ? (protonAudit?.indexedMessages ?? 0)
                            : account.provider === "gmail"
                              ? (gmailAudit?.indexedMessages ?? 0)
                              : (outlookAudit?.indexedMessages ?? 0);
                          return (
                            <div key={account.id}>
                              <span>
                                <strong>{account.label}</strong>
                                <small>{account.provider.toUpperCase()}</small>
                              </span>
                              <b>{messageCount.toLocaleString()} messages</b>
                              <b>{accountIdentities.length.toLocaleString()} addresses to confirm</b>
                              <b>
                                {inventory
                                  ? `${inventory.containers.length.toLocaleString()} folders / labels`
                                  : account.provider === "proton"
                                    ? `${protonDiscovery?.mailboxes.length ?? 0} folders / labels found`
                                    : "Folders and labels not scanned"}
                              </b>
                              <b>
                                {inventory
                                  ? inventory.capability === "managed_export"
                                    ? `${inventory.rules.length} Proton filter files created by Sift · existing Proton filters cannot be read through Bridge`
                                    : `${inventory.rules.length} existing filters`
                                  : "Filters not scanned"}
                              </b>
                            </div>
                          );
                        })}
                      </div>
                      <div className="scan-inventory-actions">
                        <span>
                          <strong>{scanInventoryReady ? "Scan complete." : "Folders and filters still need to be scanned."}</strong>
                          <small>Nothing is created, moved, marked read, filtered, or deleted during Scan.</small>
                        </span>
                        {scanInventoryReady ? (
                          <button className="primary-button compact" type="button" onClick={() => setActivePage("organize")}>
                            Continue to Organize
                          </button>
                        ) : (
                          <button className="primary-button compact" type="button" disabled={scanInventoryBusy || scannedAccounts.length !== selectedAccounts.length} onClick={() => void completeScanInventory()}>
                            {scanInventoryBusy ? "Reading folders and filters…" : "Scan folders and filters"}
                          </button>
                        )}
                      </div>
                      {scanInventoryError ? <p className="connection-error" role="alert">{scanInventoryError}</p> : null}
                    </section>
                  ) : null}
                </>
              )}
            </>
          ) : null}

          {activePage === "organize" ? (
            <>
              {taskIntro(
                "Choose folders and file existing messages",
                "Create the folder structure and apply it to existing non-spam messages.",
                [
                  "Confirm which addresses are yours and which need separate folder trees.",
                  "Choose whether to add folders, use matching folders, or replace custom folders.",
                  "Sift groups existing messages by your chosen categories, shows the exact moves, then waits for approval.",
                  "Likely spam and suspicious mail are left for the Spam step.",
                ],
              )}
              {!scanInventoryReady ? (
                prerequisite(
                  "Finish the scan",
                  "Organize requires scanned messages, confirmed addresses, folders, labels, and existing filters.",
                  emptyAccounts ? "accounts" : "audit",
                  emptyAccounts ? "Connect an account" : "Finish scan",
                )
              ) : addressReviewCount ? (
                <>
                  <section className="workflow-inline-intro">
                    <span>1</span>
                    <div>
                      <strong>Confirm aliases and choose separate folders</strong>
                      <small>
                        Choose which confirmed addresses need their own folder. Recipients and copied addresses are not treated as aliases you own.
                      </small>
                    </div>
                  </section>
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
                    discovery={protonDiscovery}
                    analysis={analysis}
                    cleanupPlan={cleanupPlan}
                    onGenerateCleanup={onGenerateCleanup}
                    onApproveCleanup={onApproveCleanup}
                    onResumeCleanup={onResumeCleanup}
                    onRetryCleanup={onRetryCleanup}
                    onUndoCleanup={onUndoCleanup}
                    onContinue={() => setActivePage("spam")}
                  />
                </>
              )}
            </>
          ) : null}

          {activePage === "spam" ? (
            <>
              {taskIntro(
                "Decide what should be treated as spam",
                "Remove spam candidates from the normal-mail pool before Sift proposes filing filters.",
                [
                  "Sift groups mail by sender domain and the address that received it.",
                  "It shows likely spam, suspicious mail, and marketing streams with at least 25 messages.",
                  "Nothing is marked as Spam automatically. You choose Spam, Not spam, or Review for each sender.",
                  "Spam choices become future Spam rules. Not spam prevents a Spam rule; ordinary Rules still require their own evidence.",
                ],
              )}
              {!organizationReady ? (
                prerequisite(
                  "Finish Organize first",
                  "Spam review starts after the folder structure exists and existing non-spam mail has been filed.",
                  scannedCount ? "organize" : "audit",
                  scannedCount ? "Open organize" : "Open scan",
                )
              ) : (
                <>
                  {selectedAccounts.map((account) => (
                    <SpamReviewPanel
                      key={account.id}
                      account={account}
                      review={spamReviews[account.id] ?? null}
                      onGenerate={onGenerateSpamReview}
                      onComplete={onCompleteSpamReview}
                    />
                  ))}
                  <section className="next-action">
                    <span>
                      <strong>{spamReady ? "Create normal filing filters" : "Save a spam review for every selected account"}</strong>
                      <small>
                        {spamReady
                          ? "Rules will exclude Spam, Suspicious, Personal, Security, and Unsorted mail from ordinary filing proposals."
                          : "A saved review is required even when no spam candidates were found."}
                      </small>
                    </span>
                    <button className="primary-button compact" type="button" disabled={!spamReady} onClick={() => setActivePage("rules")}>
                      {spamReady ? "Continue to Rules" : "Finish spam review"}
                    </button>
                  </section>
                </>
              )}
            </>
          ) : null}

          {activePage === "rules" ? (
            <>
              {taskIntro(
                "Create filters for future non-spam mail",
                "Keep recurring low-priority mail out of Inbox while leaving personal, security, suspicious, and unclear mail alone.",
                [
                  "One proposal matches one sender domain sending to one of your addresses.",
                  "Sift requires at least 3 messages, 90% of the sender’s history in one category, and 82% classification confidence.",
                  "Every selected ordinary filter files future mail, marks it read, and removes it from Inbox when supported.",
                  "Spam decisions from the previous step are included as separate Spam rules. You can uncheck any proposed change.",
                ],
              )}
              {spamReady ? (
                <>
                  {selectedAccounts.map((account) => (
                    <RuleReconciliationPanel
                      key={account.id}
                      account={account}
                      inventory={ruleInventories[account.id] ?? null}
                      plan={rulePlans[account.id] ?? null}
                      organizationReady={foldersReadyFor(account)}
                      onOpenOrganize={() => setActivePage("organize")}
                      onRefresh={onRefreshRuleInventory}
                      onGenerate={onGenerateRulePlan}
                      onApprove={onApproveRulePlan}
                      onRetry={onRetryRulePlan}
                      onUndo={onUndoRulePlan}
                      onExportProton={onExportProtonRulePlan}
                      onConfirmProtonImport={onConfirmProtonRuleImport}
                      freshSlate={account.provider === "proton" && cleanupPlan?.existingSetup === "replace"}
                    />
                  ))}
                </>
              ) : (
                prerequisite(
                  organizationReady ? "Finish Spam review first" : "Create the folders first",
                  organizationReady
                    ? "Rules are built only after spam decisions are saved, so spam cannot be mistaken for ordinary recurring mail."
                    : "Filters cannot use folders that do not exist. Finish Organize first.",
                  organizationReady ? "spam" : scannedCount ? "organize" : "audit",
                  organizationReady ? "Open spam review" : scannedCount ? "Open organize" : "Open scan",
                )
              )}
            </>
          ) : null}

          {activePage === "unsubscribe" ? (
            <>
              {taskIntro(
                "Unsubscribe from legitimate mailing lists",
                "Stop supported newsletters and marketing mail at the source without contacting suspected spam senders.",
                [
                  "Sift looks for standard one-click unsubscribe headers in legitimate subscription and promotion mail.",
                  "It never opens links in message bodies and never contacts senders marked Spam or Suspicious.",
                  "You approve each unsubscribe request. Unsupported lists are marked for manual review.",
                ],
              )}
              {!rulesReady ? (
                prerequisite(
                  "Create filters first",
                  "Finish Spam and Rules first so unwanted senders and ordinary filing rules are handled separately.",
                  spamReady ? "rules" : organizationReady ? "spam" : scannedCount ? "organize" : "audit",
                  spamReady ? "Open rules" : organizationReady ? "Open spam review" : scannedCount ? "Open organize" : "Open scan",
                )
              ) : (
                <>
                  <section className="workflow-inline-intro spam-protection-status">
                    <span><ShieldCheck size={16} /></span>
                    <div>
                      <strong>
                        {selectedAccounts.reduce((sum, account) =>
                          sum + (rulePlans[account.id]?.operations.filter((operation) => operation.desired?.spam).length ?? 0), 0,
                        ).toLocaleString()} spam filters
                      </strong>
                      <small>
                        Suspected spam is sent to Spam without an unsubscribe request, so Sift never confirms your address to an unsafe sender. Mailing lists with supported one-click links are shown below.
                      </small>
                    </div>
                  </section>
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
                      <strong>{unsubscribeReady ? "Review old messages for deletion" : "Unsubscribe from or skip every listed mailing list"}</strong>
                      <small>
                        {unsubscribeReady
                          ? "The Delete step lists old messages that can move to Trash or Deleted Items. Security, account, transaction, finance, personal, and suspicious messages are excluded."
                          : "Unsubscribe from or skip every listed mailing list before Delete unlocks. Suspected spam senders are not contacted."}
                      </small>
                    </span>
                    <button
                      className="primary-button compact"
                      type="button"
                      disabled={!unsubscribeReady}
                      onClick={() => setActivePage("delete")}
                    >
                      {unsubscribeReady ? "Continue to Delete" : "Finish unsubscribe choices"}
                    </button>
                  </section>
                </>
              )}
            </>
          ) : null}

          {activePage === "delete" ? (
            <>
              {taskIntro(
                "Move selected old messages to Trash",
                "Remove old mail that was not handled by folders, spam decisions, filters, or unsubscribe.",
                [
                  "Sift ranks senders by message count and the date of their newest message.",
                  "Security, account, transaction, finance, personal, and suspicious mail is excluded.",
                  "Approved messages move to the provider’s Trash or Deleted Items folder; Sift does not permanently delete them.",
                ],
              )}
              {!unsubscribeReady ? (
                prerequisite(
                  "Finish Unsubscribe first",
                  "Complete Scan, Organize, Spam, Rules, and Unsubscribe before selecting old messages to move to Trash or Deleted Items.",
                  rulesReady ? "unsubscribe" : spamReady ? "rules" : organizationReady ? "spam" : scannedCount ? "organize" : "audit",
                  rulesReady ? "Open unsubscribe" : spamReady ? "Open rules" : organizationReady ? "Open spam review" : scannedCount ? "Open organize" : "Open scan",
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

          {activePage === "recovery" ? (
            <>
              {taskIntro(
                "Back up or repair local Sift data",
                "Check, back up, restore, or rebuild the local information Sift uses.",
                [
                  "Diagnostics check the local database and omit email content from exported reports.",
                  "Backups are encrypted before they are written to disk.",
                  "Deleting a saved scan keeps account connections and filters already created by Sift, but requires a new scan before planning more changes.",
                ],
              )}
              <RecoveryPanel
                diagnostics={diagnostics}
                onCheck={onCheckDiagnostics}
                onExport={onExportDiagnostics}
                onBackup={onCreateBackup}
                onRestore={onRestoreBackup}
                onRebuild={onRebuildIndex}
              />
            </>
          ) : null}

          {activePage === "settings" ? (
            <SettingsPanel
              settings={settings}
              onUpdate={onUpdateSettings}
              onCheck={onCheckForUpdates}
              onOpenAccounts={() => setActivePage("accounts")}
              onOpenRecovery={() => setActivePage("recovery")}
            />
          ) : null}
        </main>
      </div>
    </div>
  );
};

export const App = () => {
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
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
  const [spamReviews, setSpamReviews] = useState<
    Record<string, SpamReview | null>
  >({});
  const [ruleInventories, setRuleInventories] = useState<
    Record<string, RuleInventory | null>
  >({});
  const [rulePlans, setRulePlans] = useState<
    Record<string, RuleReconciliationPlan | null>
  >({});
  const [diagnostics, setDiagnostics] = useState<DiagnosticsSummary | null>(
    null,
  );

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
      currentDiagnostics,
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
      window.emailOrganizer.getDiagnostics(),
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
    setDiagnostics(currentDiagnostics);
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
    const spamReviewEntries = await Promise.all(
      currentAccounts.map(
        async (account) =>
          [
            account.id,
            await window.emailOrganizer.getSpamReview({
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
    setSpamReviews(Object.fromEntries(spamReviewEntries));
    setRuleInventories(Object.fromEntries(ruleInventoryEntries));
    setRulePlans(Object.fromEntries(rulePlanEntries));
  };

  useEffect(() => {
    void Promise.allSettled([
      window.emailOrganizer.listProfiles(),
      window.emailOrganizer.getAppSettings(),
    ]).then(([profileResult, settingsResult]) => {
      const errors: string[] = [];
      if (profileResult.status === "fulfilled") {
        setProfiles(profileResult.value);
      } else {
        errors.push("Sift couldn't load local profiles.");
      }
      if (settingsResult.status === "fulfilled") {
        setAppSettings(settingsResult.value);
      } else {
        errors.push("Sift couldn't load app settings; automatic updates remain off.");
        setAppSettings({
          autoUpdateEnabled: false,
          automaticUpdatesActive: false,
          updatesSupported: false,
          appVersion: "unknown",
        });
      }
      setLoadError(
        errors.length > 0 ? `${errors.join(" ")} Try reopening the app.` : "",
      );
      setLoading(false);
    });
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
    if (protonConnection)
      setSpamReviews((current) => ({ ...current, [protonConnection.id]: null }));
  };

  const generateCleanup = async (
    containers: Record<string, string>,
    existingSetup: OrganizationTransitionMode,
  ) =>
    setCleanupPlan(
      await window.emailOrganizer.generateCleanupPlan({
        kind: "organize",
        existingSetup,
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
        existingSetup: "extend",
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
    setSpamReviews((current) => ({ ...current, [account.id]: null }));
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
  const analyzeOutlook = async () => {
    setOutlookAnalysis(await window.emailOrganizer.analyzeOutlook());
    if (outlookConnection)
      setSpamReviews((current) => ({ ...current, [outlookConnection.id]: null }));
  };
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
  const checkDiagnostics = async () => {
    const result = await window.emailOrganizer.getDiagnostics();
    setDiagnostics(result);
    return result;
  };
  const exportDiagnostics = () => window.emailOrganizer.exportDiagnostics();
  const createBackup = () => window.emailOrganizer.createEncryptedBackup();
  const restoreBackup = async () => {
    const result = await window.emailOrganizer.restoreEncryptedBackup({
      confirmation: "RESTORE LOCAL PROFILE",
    });
    if (result) await loadWorkspace();
    return result;
  };
  const rebuildIndex = async () => {
    const result = await window.emailOrganizer.rebuildLocalIndex({
      confirmation: "DELETE SAVED SCAN",
    });
    await loadWorkspace();
    return result;
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
    setSpamReviews((current) => ({ ...current, [input.connectionId]: null }));
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
    setSpamReviews((current) => ({ ...current, [account.id]: null }));
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
  const generateSpamReview = async (account: MailAccountSummary) => {
    const review = await window.emailOrganizer.generateSpamReview({
      provider: account.provider,
      connectionId: account.id,
    });
    setSpamReviews((current) => ({ ...current, [account.id]: review }));
    setRulePlans((current) => ({ ...current, [account.id]: null }));
  };
  const completeSpamReview = async (
    review: SpamReview,
    decisions: Array<{ candidateId: string; decision: SpamReviewDecision }>,
  ) => {
    const completed = await window.emailOrganizer.completeSpamReview({
      reviewId: review.id,
      revision: review.revision,
      decisions,
    });
    setSpamReviews((current) => ({
      ...current,
      [completed.connectionId]: completed,
    }));
    setRulePlans((current) => ({
      ...current,
      [completed.connectionId]: null,
    }));
  };
  const refreshRuleInventory = async (account: MailAccountSummary) => {
    const inventory = await window.emailOrganizer.refreshRuleInventory({
      provider: account.provider,
      connectionId: account.id,
    });
    setRuleInventories((current) => ({ ...current, [account.id]: inventory }));
    setRulePlans((current) => ({ ...current, [account.id]: null }));
  };
  const generateRulePlan = async (
    account: MailAccountSummary,
    replaceExternalRules = false,
  ) => {
    const plan = await window.emailOrganizer.generateRulePlan({
      provider: account.provider,
      connectionId: account.id,
      replaceExternalRules,
    });
    setRulePlans((current) => ({ ...current, [account.id]: plan }));
  };
  const approveRulePlan = async (
    plan: RuleReconciliationPlan,
    enabledOperationIds: string[],
  ) => {
    const updated = await window.emailOrganizer.approveRulePlan({
      planId: plan.id,
      revision: plan.revision,
      enabledOperationIds,
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
  const exportProtonRulePlan = async (
    plan: RuleReconciliationPlan,
    enabledOperationIds: string[],
  ) => {
    const result = await window.emailOrganizer.exportProtonRulePlan({
      planId: plan.id,
      revision: plan.revision,
      enabledOperationIds,
    });
    setRulePlans((current) => ({
      ...current,
      [result.plan.connectionId]: result.plan,
    }));
    return result.canceled
      ? ""
      : `Saved a Proton filter file with ${result.ruleCount} filters.`;
  };
  const confirmProtonRuleImport = async (plan: RuleReconciliationPlan) => {
    const updated = await window.emailOrganizer.confirmProtonRuleImport({
      planId: plan.id,
      revision: plan.revision,
    });
    setRulePlans((current) => ({
      ...current,
      [updated.connectionId]: updated,
    }));
  };
  const startGmailAudit = async () =>
    setGmailAudit(await window.emailOrganizer.startGmailAudit());
  const analyzeGmail = async () => {
    setGmailAnalysis(await window.emailOrganizer.analyzeGmail());
    if (gmailConnection)
      setSpamReviews((current) => ({ ...current, [gmailConnection.id]: null }));
  };
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

  const updateAppSettings = async (input: UpdateAppSettingsInput) => {
    setAppSettings(await window.emailOrganizer.updateAppSettings(input));
  };
  const checkForUpdatesNow = () =>
    window.emailOrganizer.checkForUpdatesNow();

  if (loading || !appSettings) {
    return (
      <main className="loading-screen" aria-live="polite">
        <BrandMark />
        <span>Loading profile…</span>
      </main>
    );
  }

  return activeProfile ? (
    <AppShell
      profileName={activeProfile.displayName}
      onSwitchProfile={() => setActiveProfile(null)}
      settings={appSettings}
      onUpdateSettings={updateAppSettings}
      onCheckForUpdates={checkForUpdatesNow}
      accounts={accounts}
      identities={identities}
      onSelectAccount={selectAccount}
      onRefreshIdentities={refreshIdentities}
      onUpdateIdentity={updateIdentity}
      proposals={proposals}
      onGenerateProposal={generateProposal}
      onEditProposal={editProposal}
      spamReviews={spamReviews}
      onGenerateSpamReview={generateSpamReview}
      onCompleteSpamReview={completeSpamReview}
      ruleInventories={ruleInventories}
      rulePlans={rulePlans}
      onRefreshRuleInventory={refreshRuleInventory}
      onGenerateRulePlan={generateRulePlan}
      onApproveRulePlan={approveRulePlan}
      onRetryRulePlan={retryRulePlan}
      onUndoRulePlan={undoRulePlan}
      onExportProtonRulePlan={exportProtonRulePlan}
      onConfirmProtonRuleImport={confirmProtonRuleImport}
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
      diagnostics={diagnostics}
      onCheckDiagnostics={checkDiagnostics}
      onExportDiagnostics={exportDiagnostics}
      onCreateBackup={createBackup}
      onRestoreBackup={restoreBackup}
      onRebuildIndex={rebuildIndex}
    />
  ) : (
    <ProfilePicker
      profiles={profiles}
      loadError={loadError}
      settings={appSettings}
      onUpdateSettings={updateAppSettings}
      onCheckForUpdates={checkForUpdatesNow}
      onCreate={createProfile}
      onOpen={openProfile}
    />
  );
};
