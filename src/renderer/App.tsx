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
  UpdateAppSettingsInput,
} from "../shared/contracts/settings";

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
  onOpenAccounts,
  onOpenRecovery,
}: {
  settings: AppSettings;
  onUpdate(input: UpdateAppSettingsInput): Promise<void>;
  onOpenAccounts?: () => void;
  onOpenRecovery?: () => void;
}) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const setAutomaticUpdates = async (enabled: boolean) => {
    setBusy(true);
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
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-heading task-heading settings-heading">
        <h1>Control what Sift keeps and when it updates.</h1>
        <p>
          Update behavior is app-wide. Mail data remains isolated inside each
          local profile.
        </p>
      </div>

      <section
        className="readiness-panel settings-update-panel"
        aria-labelledby="software-update-title"
      >
        <div className="panel-header">
          <div>
            <p className="eyebrow">SOFTWARE UPDATES</p>
            <h2 id="software-update-title">Choose when Sift downloads</h2>
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
              release feed hourly and download newer releases in the
              background.
            </small>
          </span>
          <label className="settings-switch">
            <input
              type="checkbox"
              role="switch"
              aria-label="Download updates automatically"
              checked={settings.autoUpdateEnabled}
              disabled={busy}
              onChange={(event) =>
                void setAutomaticUpdates(event.target.checked)
              }
            />
            <span aria-hidden="true" />
            <b>{settings.autoUpdateEnabled ? "On" : "Off"}</b>
          </label>
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
                  ? "Automatic updates run only in the installed Windows version, not this development or unpacked build."
                  : "You can install a release manually whenever you choose. A request already in progress may finish after this switch is turned off."}
            </p>
          </div>
          <div>
            <strong>Choose when to leave the current session</strong>
            <p>
              Sift defaults its update prompt to Later and never forces the
              current session to restart. Once an update has downloaded,
              Electron applies it the next time Sift starts even if you chose
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
            <h2 id="privacy-policy-title">Your mailbox stays yours</h2>
          </div>
          <span className="secured-label">
            <LockKeyhole size={14} /> Local-first
          </span>
        </div>
        <p className="privacy-lead">
          Sift has no hosted mailbox database, advertising system, analytics,
          or telemetry service. Its working data is stored on this computer;
          provider requests go directly to Proton Bridge, Google, or Microsoft.
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
              <strong>Local mail index</strong>
            </span>
            <p role="cell">
              Sender and recipient addresses, dates, subjects, selected
              headers, message identifiers, and folder or label state. Proton
              body text is stored only when optional body extraction is
              enabled; Gmail and Outlook scans remain metadata-only.
            </p>
            <p role="cell">
              Disconnect that account to remove its provider-scoped index, or
              use Recovery → Rebuild local index to clear the profile’s
              downloaded metadata and derived analysis.
            </p>
          </div>
          <div role="row">
            <span className="retention-label" role="cell">
              <KeyRound size={16} />
              <strong>Connection secrets</strong>
            </span>
            <p role="cell">
              OAuth refresh tokens and Proton Bridge credentials are encrypted
              with the current Windows user’s operating-system protection and
              are kept outside the renderer.
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
              <strong>Plans and receipts</strong>
            </span>
            <p role="cell">
              Address decisions, proposals, managed-rule ownership,
              unsubscribe history, job checkpoints, and verified Undo receipts
              remain in that local profile so later operations can be safe and
              resumable.
            </p>
            <p role="cell">
              Rebuild clears proposals and incomplete jobs but preserves
              managed-rule ownership and unsubscribe history. Removing the
              local profile files removes the remaining local records.
            </p>
          </div>
          <div role="row">
            <span className="retention-label" role="cell">
              <CloudOff size={16} />
              <strong>Provider mail</strong>
            </span>
            <p role="cell">
              Messages remain with the mail provider. Sift does not operate a
              cloud copy and does not permanently delete provider mail.
            </p>
            <p role="cell">
              Provider Spam, Trash, and Deleted Items retention is controlled
              by Proton, Google, or Microsoft. Undo is available only where the
              reviewed Sift plan supports it.
            </p>
          </div>
        </div>
        <div className="privacy-network-boundary">
          <strong>Network boundary</strong>
          <p>
            Sift contacts connected mail providers, local Proton Bridge, OAuth
            endpoints, approved one-click unsubscribe endpoints, and—only when
            automatic updates are enabled—the public Sift update service. It
            does not send the local mailbox index, credentials, subjects, or
            addresses to the update service.
          </p>
        </div>
        <div className="privacy-removal-note">
          <strong>Uninstall is not secure erasure.</strong>
          <p>
            Disconnect accounts first on a shared computer. Windows may leave
            encrypted local profile files after the app is removed; delete the
            Sift application-data folder separately if permanent local removal
            is required.
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
  onCreate(profileName: string): Promise<void>;
  onOpen(profile: ProfileSummary): Promise<void>;
}

const ProfilePicker = ({
  profiles,
  loadError,
  settings,
  onUpdateSettings,
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
          <SettingsPanel settings={settings} onUpdate={onUpdateSettings} />
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
  onGenerateRulePlan(
    account: MailAccountSummary,
    replaceExternalRules?: boolean,
  ): Promise<void>;
  onApproveRulePlan(plan: RuleReconciliationPlan): Promise<void>;
  onRetryRulePlan(plan: RuleReconciliationPlan): Promise<void>;
  onUndoRulePlan(plan: RuleReconciliationPlan): Promise<void>;
  onExportProtonRulePlan(plan: RuleReconciliationPlan): Promise<string>;
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
          ? "The local message index is empty. Return to Scan and finish the Proton mailbox scan; no folders or messages were changed."
          : "Sift could not refresh the local classification snapshot for this review. Return to Scan and retry the Proton scan; no folders or messages were changed.",
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
            <h2 id="organization-flow-title">Choose how the new structure takes over</h2>
            <p>
              {analysis.uniqueMessages.toLocaleString()} inbound messages ·{" "}
              {analysis.addresses.length} proven aliases ·{" "}
              {analysis.classifierVersion}
            </p>
          </div>
        </div>
        <div className="organization-stage">
          <div className="stage-intro">
            <span>1</span>
            <div>
              <h3>Decide what happens to the existing setup</h3>
              <p>
                Sift found {customFolders.length} custom folders and {customLabels.length} labels.
                Pick one transition; the next screen shows the complete resulting structure before anything changes.
              </p>
            </div>
          </div>
          <div className="organization-strategy-grid three-up">
            <button
              type="button"
              className={transitionMode === "extend" ? "active" : ""}
              onClick={() => chooseTransition("extend")}
            >
              <span>Add new folders</span>
              <strong>Keep everything already there</strong>
              <small>Preserve every existing folder and label. Create the approved Sift destinations beside them.</small>
            </button>
            <button
              type="button"
              className={transitionMode === "reuse" ? "active" : ""}
              onClick={() => chooseTransition("reuse")}
            >
              <span>Use existing folders</span>
              <strong>Reuse exact destination matches</strong>
              <small>Keep the existing setup, route into matching approved paths, and create only the missing destinations.</small>
            </button>
            <button
              type="button"
              className={transitionMode === "replace" ? "active" : ""}
              onClick={() => chooseTransition("replace")}
            >
              <span>Fresh clean slate</span>
              <strong>Replace the old folder structure</strong>
              <small>Migrate approved history first, then have Sift retire obsolete custom folders and labels it verifies are empty.</small>
            </button>
          </div>
          <div className="organization-reset-plan">
            <div>
              <span>Current structure inventory</span>
              <strong>{customFolders.length} folders · {customLabels.length} labels</strong>
              <small>{populatedLegacyContainers} contain messages. Proton system folders are always protected.</small>
            </div>
            <ol>
              <li>Review the shared tree and every intentionally split alias container.</li>
              <li>Approve the exact historical moves; uncertain history goes to Review/Unsorted while personal and suspicious mail stays protected.</li>
              <li>{transitionMode === "replace" ? "Retire verified-empty obsolete custom containers." : "Create or reuse only the approved destinations."}</li>
              <li>Continue to Rules only after the destination structure exists.</li>
            </ol>
          </div>
          <div className="review-only-note" role="note">
            <ShieldCheck size={16} />
            <span>
              <strong>No giant sender report in this flow.</strong>
              <small>Old low-value history is handled by the approved filing plan. Future sender filtering is the next Rules step.</small>
            </span>
          </div>
        </div>

        <div className="organization-flow-actions">
          <span>
            <strong>{Object.keys(containers).length} split alias container{Object.keys(containers).length === 1 ? "" : "s"}</strong>
            <small>The final review separates these from the shared filing tree.</small>
          </span>
          <button
            className="primary-button compact"
            type="button"
            disabled={busy}
            onClick={() => void buildReview()}
          >
            {busy ? "Building exact review…" : reviewStarted ? "Rebuild final structure review" : "Review final structure"}
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
            <strong>Historical filing is complete.</strong>
            <small>The approved folders now exist. Build future-mail filters against them next.</small>
          </div>
          <button className="primary-button compact" type="button" onClick={onContinue}>
            Continue to Rules
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
          ? "This plan came from an older scan that treated Proton All Mail as movable. Rebuild the mailbox analysis and cleanup preview; the 19 completed actions remain recorded."
          : message.includes("proton_target_rejected")
          ? "Proton rejected a required folder. No messages moved. Rebuild this plan after checking the proposed folder hierarchy."
          : message.includes("proton_bridge_unavailable")
            ? "Proton Bridge became unavailable. No unverified work will continue; reopen Bridge, then resume from the checkpoint."
            : "Cleanup stopped safely. Completed actions remain recorded; failed actions can be retried from their checkpoint.",
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
        eyebrow: "Selected stale history",
        title: "Proton Trash",
        detail: "One reversible provider action set.",
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
        eyebrow: "Action set 1 · Shared mailbox structure",
        title: "Shared filing destinations",
        detail: "All aliases that are not split into a dedicated container use these shared destinations.",
        impacts: shared,
      });
    }
    const byContainer = new Map<string, CleanupPlan["impacts"]>();
    for (const impact of plan.impacts.filter((candidate) => candidate.containerName)) {
      const key = `${impact.scopeAddress ?? "unknown"}:${impact.containerName}`;
      byContainer.set(key, [...(byContainer.get(key) ?? []), impact]);
    }
    let setNumber = groups.length + 1;
    for (const [key, impacts] of byContainer) {
      groups.push({
        key,
        eyebrow: `Action set ${setNumber} · Alias container`,
        title: impacts[0]?.containerName ?? "Dedicated alias",
        detail: `${impacts[0]?.scopeAddress ?? "Selected alias"} is filed beneath this dedicated container. These are additional moves, separate from the shared filing set.`,
        impacts,
      });
      setNumber += 1;
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
              : "Generate an immutable action list from this proposal. Routine and uncertain history leaves Inbox; personal and suspicious messages remain protected."}
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
              <span>{trash ? "not selected" : "protected / already filed"}</span>
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
                      {group.impacts.length.toLocaleString()} {group.impacts.length === 1 ? "destination" : "destinations"}
                      {" · "}{messageCount.toLocaleString()} messages
                    </b>
                  </header>
                  <div
                    className="proposal-table"
                    role="table"
                    aria-label={`${group.title} cleanup impact`}
                  >
                    <div className="cleanup-impact-row cleanup-impact-head">
                      <span>Category</span>
                      <span>Destination</span>
                      <span>Exact action</span>
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
                              ? "Move to provider Trash"
                              : "Mark read · move · archive"}
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
                  <strong>Fresh-slate retirement</strong>
                  <small>Runs only after the approved historical moves finish.</small>
                </span>
                <b>{plan.legacyContainers.length.toLocaleString()} obsolete containers</b>
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
                          ? "Remove label after filing"
                          : "Delete after verified filing"
                        : container.state === "retired"
                          ? "Deleted and verified"
                          : container.state === "retained_nonempty"
                            ? "Kept — still contains mail"
                            : container.state.replaceAll("_", " ")}
                    </b>
                  </div>
                ))}
              </div>
              <p>Custom folders are deleted only after they are obsolete and verified empty. Proton labels are tags, so removing an obsolete label does not delete the messages carrying it. System containers are always retained.</p>
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
                  <strong>I approve these exact mailbox changes</strong>
                  <small>
                    {trash
                      ? "Move only the listed non-critical messages into Proton’s native Trash folder. Nothing is permanently erased."
                      : `Apply ${impactGroups.length} independent filing ${impactGroups.length === 1 ? "set" : "sets"}: create or reuse the listed destinations, then mark read, move, and archive only the messages shown.${plan.existingSetup === "replace" ? " After filing is verified, Sift will delete only the obsolete custom containers listed above that are empty." : ""}`}
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
                  ? "Starting cleanup…"
                  : trash
                    ? `Move ${plan.actionCount.toLocaleString()} messages to Trash`
                    : `Apply ${plan.actionCount.toLocaleString()} filing actions${plan.legacyContainers.length ? ` + ${plan.legacyContainers.length} retirements` : ""}`}
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
              {plan.requiresRebuild ? (
                <div className="cleanup-structural-error" role="alert">
                  <strong>Rebuild this older cleanup plan</strong>
                  <small>
                    Its scan selected Proton’s virtual All Mail view as a move
                    source. Sift will not resume it. Rebuild the mailbox analysis
                    and preview; already verified actions remain recorded.
                  </small>
                  <button
                    className="primary-button compact"
                    type="button"
                    disabled={busy}
                    onClick={() => void act(onGenerate)}
                  >
                    {busy ? "Rebuilding…" : "Build safe replacement preview"}
                  </button>
                </div>
              ) : null}
              {jobTargetBlocked || blockedFailures.length ? (
                <div className="cleanup-structural-error" role="alert">
                  <strong>Proton rejected the destination structure</strong>
                  <small>
                    No affected messages moved. Sift stopped before continuing;
                    rebuild the plan after correcting its folder hierarchy.
                  </small>
                </div>
              ) : null}
              {changedSourceCount ? (
                <div className="cleanup-structural-error" role="status">
                  <strong>Mailbox state changed after this plan was built</strong>
                  <small>
                    {changedSourceCount.toLocaleString()} actions no longer match
                    their scanned source message. Run Scan again and rebuild the
                    cleanup plan instead of retrying them.
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
              : "Uncertain history is preserved in Review/Unsorted and marked read. Personal and suspicious messages remain where they are; messages already in an approved destination are not moved again."}
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
              <b>{spamCount}</b> spam streams never contacted
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
                      : `Spam streams handled without contact (${spamCount})`}
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
                    onClick={() =>
                      void act(() => onApprove(plan.id, plan.revision))
                    }
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
                      : account.provider === "outlook"
                        ? "Outlook / Hotmail · OAuth connection"
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
                  {account.provider === "gmail"
                    ? "Gmail"
                    : account.provider === "outlook"
                      ? "Outlook"
                      : "Proton"}
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
            {busyKey === "generate" ? "Building from mailbox…" : "Build from mailbox"}
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
              <b>{items.length}</b> categories shown for this address
            </span>
            <span>
              <b>{activeItems.length}</b> enabled ·{" "}
              {currentScopeMessages.toLocaleString()} affected messages
            </span>
            <small>
              {activeAssignments} total assignments across {scopes.length}{" "}
              address scope{scopes.length === 1 ? "" : "s"} · Draft revision{" "}
              {proposal.revision.slice(0, 10)}
            </small>
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
                          {mailCategoryLabels[category]}
                        </option>
                      ))}
                    </select>
                    <small>
                      {item.evidence.slice(0, 3).join(" · ") ||
                        "Classifier evidence unavailable"}
                    </small>
                    {item.category === "other" ? (
                      <small>
                        Quiet-inbox catch-all: preserve this history in
                        Review/Unsorted, mark it read, and keep it out of Inbox.
                      </small>
                    ) : null}
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
  onApprove(plan: RuleReconciliationPlan): Promise<void>;
  onRetry(plan: RuleReconciliationPlan): Promise<void>;
  onUndo(plan: RuleReconciliationPlan): Promise<void>;
  onExportProton(plan: RuleReconciliationPlan): Promise<string>;
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
  const externalRemovals =
    plan?.operations.filter(
      (operation) =>
        operation.kind === "remove" && operation.prior?.ownership === "external",
    ).length ?? 0;
  const failed =
    plan?.operations.filter((operation) =>
      ["failed", "verification_mismatch"].includes(operation.state),
    ) ?? [];
  const completed =
    plan?.operations.filter((operation) => operation.state === "succeeded")
      .length ?? 0;
  const protonImportPending =
    account.provider === "proton" &&
    plan?.state === "approved" &&
    Boolean(plan.operations.length) &&
    plan.operations.every((operation) => operation.state === "succeeded");
  const visibleOperations = showAllOperations
    ? (plan?.operations ?? [])
    : (plan?.operations.slice(0, 25) ?? []);
  const operationEffect = (
    operation: RuleReconciliationPlan["operations"][number],
  ): string => {
    const desired = operation.desired ?? operation.priorManaged;
    if (operation.kind === "remove") {
      return operation.prior?.ownership === "external"
        ? "Delete this unmatched existing provider rule; its prior future-mail behavior stops."
        : "Remove this Sift-managed rule; matching future mail will stop being filed by it.";
    }
    if (!desired) return "No provider behavior change is available to preview.";
    const consequences = [
      desired.spam
        ? "send it to Spam"
        : `file it in “${desired.targetPath}”`,
      desired.markRead ? "mark it read" : null,
      desired.archive ? "remove it from the inbox" : null,
    ].filter((value): value is string => Boolean(value));
    const behavior = consequences.join(", ");
    if (operation.kind === "adopt") {
      return `Take ownership of an identical existing rule. Its behavior stays the same: ${behavior}.`;
    }
    if (operation.kind === "replace") {
      return `Replace Sift’s prior managed rule so future matches ${behavior}.`;
    }
    if (operation.kind === "unchanged") {
      return `Keep the verified existing rule: future matches ${behavior}.`;
    }
    return account.provider === "proton"
      ? `Add this instruction to the exported Sieve file: future matches ${behavior}.`
      : `Create a provider rule so future matches ${behavior}.`;
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
              ? "Reconcile Gmail filters"
              : account.provider === "outlook"
                ? "Reconcile Outlook inbox rules"
                : "Build the managed Proton Sieve export"}
          </h2>
        </div>
        <span className="secured-label">
          <ShieldCheck size={14} />
          {account.provider === "gmail"
            ? "Verified provider state"
            : account.provider === "outlook"
              ? "Verified provider state"
              : "Manual Proton import"}
        </span>
      </div>
      <div className="rule-capability">
        <p>
          {account.provider === "gmail"
            ? "Sift inventories live Gmail filters, retains unrelated rules by default, and can explicitly replace the full custom-filter set after showing every deletion."
            : account.provider === "outlook"
              ? "Sift inventories live Outlook inbox rules, retains unrelated rules by default, and can explicitly replace the full inbox-rule set after showing every deletion."
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
      {account.provider === "proton" && freshSlate ? (
        <div className="cleanup-structural-error proton-filter-boundary" role="note">
          <strong>Fresh slate requires one Proton Mail settings action</strong>
          <small>
            Bridge cannot read or delete Proton’s server-side filters. Disable or remove the old filters in Proton Mail → Settings → All settings → Filters before importing Sift’s replacement Sieve file; otherwise both systems can act on the same message.
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
              ? "Destination folders are ready"
              : "Create the approved folders before enabling rules"}
          </strong>
          <small>
            {organizationReady
              ? "The completed Organize run created the destinations used below. You can now review and approve future-mail automation."
              : "You may inventory and preview the plan now, but Sift will not apply or export it. Run the approved historical filing plan in Organize first so every destination exists."}
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
      {inventory ? (
        <div className="rule-inventory-metrics">
          <span>
            <b>{inventory.rules.length}</b>
            <small>
              {account.provider === "gmail"
                ? "provider filters found"
                : account.provider === "outlook"
                  ? "provider inbox rules found"
                  : "managed exports tracked"}
            </small>
          </span>
          <span>
            <b>{managedCount}</b>
            <small>Sift managed</small>
          </span>
          <span>
            <b>{externalCount}</b>
            <small>existing external</small>
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
          <div className="rule-strategy-grid">
            <button
              type="button"
              className={existingRuleMode === "retain" ? "active" : ""}
              onClick={() => setExistingRuleMode("retain")}
            >
              <strong>Retain matching rules</strong>
              <small>Adopt exact matches, replace outdated Sift rules, and leave unrelated provider rules untouched.</small>
            </button>
            <button
              type="button"
              className={existingRuleMode === "replace" ? "active" : ""}
              disabled={account.provider === "proton"}
              onClick={() => setExistingRuleMode("replace")}
            >
              <strong>Replace existing rules</strong>
              <small>
                {account.provider === "proton"
                  ? "Unavailable through Bridge: Proton exposes filter management only in Proton Mail settings."
                  : `Delete ${externalCount} unmatched existing rule${externalCount === 1 ? "" : "s"} after preserving exact matches.`}
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
              ? "Reconciling…"
              : "Build rule reconciliation plan"}
          </button>
        </div>
      ) : (
        <div className="rule-plan-review">
          <div className="proposal-revision">
            <span>
              <b>{actionable.length}</b> future-mail rule changes
            </span>
            <span>
              <b>{plan.operations.length - actionable.length}</b> already
              correct · no change
            </span>
            <small>Plan revision {plan.revision.slice(0, 10)}</small>
          </div>
          <div className="rule-plan-explainer" role="note">
            <ShieldCheck size={16} />
            <span>
              <strong>Review only until you explicitly approve.</strong>
              <small>
                These rules affect future messages only. They do not move or
                delete existing mail; the exact effect of every proposed rule
                is written below.
              </small>
            </span>
          </div>
          <div className="rule-operation-list">
            <div className="rule-operation-head">
              <span>Operation</span>
              <span>Matches future mail from / to</span>
              <span>Exact effect</span>
              <span>Status</span>
            </div>
            {visibleOperations.map((operation) => (
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
                <span className="rule-operation-effect">
                  {operationEffect(operation)}
                </span>
                <em>{operation.state.replace("_", " ")}</em>
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
                : `Show all ${plan.operations.length} exact rules`}
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
                      ? "I approve these exact future-mail rule changes"
                      : "Approval is locked until Organize creates the folders"}
                  </strong>
                  <small>
                    {!organizationReady
                      ? "Return to Organize, apply the historical filing plan, then come back to review this plan again."
                      : account.provider !== "proton"
                      ? externalRemovals
                        ? `${externalRemovals} unmatched existing ${account.provider === "gmail" ? "filters" : "inbox rules"} will be deleted and verified; exact matches are retained. External deletions are not automatically undoable.`
                        : `${externalCount} unrelated existing ${account.provider === "gmail" ? "filters" : "inbox rules"} remain untouched. Each Sift operation is re-read and verified before success.`
                      : "This saves a checksum-tracked Sieve file for manual review and import in Proton Mail."}
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
                    : protonImportPending
                      ? "Sieve export saved — Proton import not yet confirmed"
                    : plan.state === "undone"
                      ? "Supported changes undone"
                      : plan.state === "failed"
                        ? "Some operations need attention"
                        : "Rule job in progress"}
                </strong>
                <small>
                  {protonImportPending
                    ? "Import the saved file in Proton Mail Settings → Filters → Sieve, enable it, then confirm below."
                    : `${completed} / ${plan.operations.length} operations verified`}
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
            <p className="eyebrow">LOCAL HEALTH</p>
            <h2 id="health-title">Know the workspace is sound</h2>
          </div>
          <span className="secured-label">
            <LockKeyhole size={14} /> Counts only—no mail content
          </span>
        </div>
        {diagnostics ? (
          <div className="recovery-metrics">
            <div>
              <b>{diagnostics.integrity === "ok" ? "PASS" : "FAIL"}</b>
              <span>database integrity</span>
            </div>
            <div>
              <b>{diagnostics.foreignKeyViolations}</b>
              <span>relationship errors</span>
            </div>
            <div>
              <b>{indexedTotal.toLocaleString()}</b>
              <span>indexed messages</span>
            </div>
            <div>
              <b>v{diagnostics.appVersion}</b>
              <span>Sift version</span>
            </div>
          </div>
        ) : (
          <p className="recovery-copy">
            Run a local integrity check before a major cleanup or update. The
            shareable report contains version, platform, counts, and health
            results—never addresses, subjects, senders, paths, or credentials.
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
                  ? "Local database integrity passed."
                  : "The integrity check found a problem. Create a backup before continuing.";
              })
            }
          >
            {busy === "check" ? "Checking…" : "Check local health"}
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={busy !== null}
            onClick={() =>
              void run("export", async () => {
                const result = await onExport();
                return result.canceled
                  ? "Diagnostic export canceled."
                  : "Content-free diagnostic report saved.";
              })
            }
          >
            {busy === "export" ? "Exporting…" : "Export safe diagnostics"}
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
              Protect the local profile before big changes
            </h2>
          </div>
          <span className="secured-label">
            <ShieldCheck size={14} /> Windows-protected key
          </span>
        </div>
        <p className="recovery-copy">
          A backup includes the local index, decisions, connection records, and
          already-encrypted provider secrets. Its encryption key is protected by
          Windows, so restore it with the same Windows user on this device.
          Provider mail itself remains with the provider.
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
                  ? `Profile restored and verified with ${result.secretFiles} encrypted secret file${result.secretFiles === 1 ? "" : "s"}.`
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
            <p className="eyebrow">LOCAL INDEX REBUILD</p>
            <h2 id="rebuild-title">
              Start the analysis over without touching mail
            </h2>
          </div>
        </div>
        <p className="recovery-copy">
          Rebuild clears downloaded metadata, classifications, proposals, and
          incomplete cleanup jobs. It preserves provider connections, encrypted
          credentials, Sift-managed rule ownership, unsubscribe history, and all
          mail held by Proton, Google, or Microsoft. You will need to scan
          again.
        </p>
        <div className="recovery-confirmation">
          <label>
            <span>Rebuild confirmation</span>
            <input
              value={rebuildConfirmation}
              onChange={(event) => setRebuildConfirmation(event.target.value)}
              placeholder="Type REBUILD LOCAL INDEX"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <button
            className="secondary-button danger"
            type="button"
            disabled={
              busy !== null || rebuildConfirmation !== "REBUILD LOCAL INDEX"
            }
            onClick={() =>
              void run("rebuild", async () => {
                const result = await onRebuild();
                setRebuildConfirmation("");
                return `Cleared ${result.clearedMessages.toLocaleString()} indexed messages; ${result.preservedConnections} connections and ${result.preservedManagedRules} managed rules preserved.`;
              })
            }
          >
            {busy === "rebuild" ? "Rebuilding…" : "Rebuild local index"}
          </button>
        </div>
      </section>

      <section
        className="recovery-guidance"
        aria-label="Update and removal guidance"
      >
        <div>
          <strong>Updates and rollback</strong>
          <p>
            Automatic downloads are controlled in Settings. Choosing Later
            keeps the current session open; an already-downloaded update applies
            the next time Sift starts. If a release causes a problem, create a
            backup and reinstall an earlier version from the Releases page; the
            profile schema refuses incompatible restores.
          </p>
        </div>
        <div>
          <strong>Before uninstalling on a shared computer</strong>
          <p>
            Disconnect provider accounts first. Removing Sift may leave its
            encrypted local profile data in Windows application storage, so do
            not treat uninstall alone as secure data erasure.
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
      return Boolean(
        cleanupPlan?.kind === "organize" &&
          cleanupPlan.state === "completed" &&
          cleanupPlan.proposalId === proposal.id &&
          cleanupPlan.proposalRevision === proposal.revision,
      );
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
  const rulesReadyFor = (account: MailAccountSummary): boolean =>
    foldersReadyFor(account) && rulePlans[account.id]?.state === "completed";
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
        "Sift could not finish the folder and rule inventory for every selected account. The message scans remain saved.",
      );
    } finally {
      setScanInventoryBusy(false);
    }
  };

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
                      <strong>Scan</strong>
                      <p>Inventory mail, aliases, folders, labels, and existing rules.</p>
                    </div>
                  </li>
                  <li>
                    <span>2</span>
                    <div>
                      <strong>Organize</strong>
                      <p>Confirm alias splits, build folders, and file existing mail.</p>
                    </div>
                  </li>
                  <li>
                    <span>3</span>
                    <div>
                      <strong>Rules</strong>
                      <p>Keep matching rules, replace conflicts, and bypass Inbox noise.</p>
                    </div>
                  </li>
                  <li>
                    <span>4</span>
                    <div>
                      <strong>Unsubscribe</strong>
                      <p>Stop authenticated junk and block future spam streams.</p>
                    </div>
                  </li>
                  <li>
                    <span>5</span>
                    <div>
                      <strong>Delete</strong>
                      <p>Remove stale leftovers only after the wider sieve finishes.</p>
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
                          ? "Confirm and split your real aliases"
                          : "Your mailbox map is ready to shape"}
                  </strong>
                  <small>
                    {emptyAccounts
                      ? "Connect Proton, Gmail, Outlook, or Hotmail."
                      : scannedCount < connectedCount
                        ? "Build a complete inventory before designing labels and rules."
                        : addressReviewCount
                          ? `${addressReviewCount} evidence-backed address decision${addressReviewCount === 1 ? "" : "s"} will be handled inside Organize.`
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
                          : "organize",
                    )
                  }
                >
                  {emptyAccounts
                    ? "Open accounts"
                    : scannedCount < connectedCount
                      ? "Open scan"
                      : addressReviewCount
                        ? "Open alias setup"
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
                  {scannedAccounts.length ? (
                    <section className="readiness-panel scan-inventory-panel">
                      <div className="panel-header">
                        <div>
                          <p className="eyebrow">STEP 1 · COMPLETE INVENTORY</p>
                          <h2>Include folders, aliases, and existing rules</h2>
                        </div>
                        <span className="secured-label">
                          <ShieldCheck size={14} /> Read only
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
                              <b>{accountIdentities.length.toLocaleString()} address candidates</b>
                              <b>
                                {inventory
                                  ? `${inventory.containers.length.toLocaleString()} folders / labels`
                                  : account.provider === "proton"
                                    ? `${protonDiscovery?.mailboxes.length ?? 0} folders / labels found`
                                    : "Folders / labels pending"}
                              </b>
                              <b>
                                {inventory
                                  ? inventory.capability === "managed_export"
                                    ? `${inventory.rules.length} Sift exports · Proton filters unavailable to Bridge`
                                    : `${inventory.rules.length} existing rules`
                                  : "Rules pending"}
                              </b>
                            </div>
                          );
                        })}
                      </div>
                      <div className="scan-inventory-actions">
                        <span>
                          <strong>{scanInventoryReady ? "The complete read-only inventory is ready." : "Finish the non-message inventory."}</strong>
                          <small>Nothing is created, moved, marked read, filtered, or deleted during Scan.</small>
                        </span>
                        {scanInventoryReady ? (
                          <button className="primary-button compact" type="button" onClick={() => setActivePage("organize")}>
                            Continue to Organize
                          </button>
                        ) : (
                          <button className="primary-button compact" type="button" disabled={scanInventoryBusy || scannedAccounts.length !== selectedAccounts.length} onClick={() => void completeScanInventory()}>
                            {scanInventoryBusy ? "Reading structure…" : "Inventory folders and rules"}
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
                "Turn mailbox history into a durable system.",
                "Correct the address-scoped filing proposal, preview exact historical impact, and apply only the approved folders or labels. Future automation remains a separate Rules action.",
              )}
              {!scanInventoryReady ? (
                prerequisite(
                  "Finish the complete mailbox inventory",
                  "Organize starts only after Scan has inventoried messages, owned-address evidence, folders or labels, and the provider rule surface for every selected account.",
                  emptyAccounts ? "accounts" : "audit",
                  emptyAccounts ? "Connect an account" : "Finish scan",
                )
              ) : addressReviewCount ? (
                <>
                  <section className="workflow-inline-intro">
                    <span>1</span>
                    <div>
                      <strong>Confirm and split owned aliases</strong>
                      <small>
                        These address decisions determine which mail gets its own container. Recipients and copied correspondents can never become owned aliases.
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
                    onContinue={() => setActivePage("rules")}
                  />
                </>
              )}
            </>
          ) : null}

          {activePage === "rules" ? (
            <>
              {taskIntro(
                "Make routine mail miss the Inbox automatically.",
                "Retain exact existing filters, replace conflicts, and install alias-aware rules that file routine mail immediately, mark it read, and keep only protected mail in the Inbox.",
              )}
              {organizationReady ? (
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
                  "Apply the folder plan first",
                  "Rules cannot target folders that do not exist. Finish the exact historical filing run in Organize, then Sift can reconcile future-mail filters.",
                  scannedCount ? "organize" : "audit",
                  scannedCount ? "Open organize" : "Open scan",
                )
              )}
            </>
          ) : null}

          {activePage === "unsubscribe" ? (
            <>
              {taskIntro(
                "Stop junk at the source, then block what remains.",
                "Unsubscribe from authenticated bulk mail, protect receipts and account notices, and turn unsafe or recurring junk streams into future Spam rules without confirming your address to suspected senders.",
              )}
              {!rulesReady ? (
                prerequisite(
                  "Install the future-mail rules first",
                  "Unsubscribe is the fourth sieve pass. Finish Rules so routine mail already bypasses Inbox before Sift removes mailing-list sources.",
                  organizationReady ? "rules" : scannedCount ? "organize" : "audit",
                  organizationReady ? "Open rules" : scannedCount ? "Open organize" : "Open scan",
                )
              ) : (
                <>
                  <section className="workflow-inline-intro spam-protection-status">
                    <span><ShieldCheck size={16} /></span>
                    <div>
                      <strong>
                        {selectedAccounts.reduce((sum, account) =>
                          sum + (rulePlans[account.id]?.operations.filter((operation) => operation.desired?.spam).length ?? 0), 0,
                        ).toLocaleString()} verified future spam stream rules
                      </strong>
                      <small>
                        Suspected spam is sent to the provider Spam folder without an unsubscribe request, so Sift never confirms your address to an unsafe sender. Authenticated lists are handled below.
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
                      <strong>{unsubscribeReady ? "Finish with stale history" : "Complete every safe unsubscribe decision"}</strong>
                      <small>
                        {unsubscribeReady
                          ? "Unsubscribing stops future mail. The last pass identifies old, non-critical sender history that can move to recoverable Trash."
                          : "Run or mark every eligible subscription before deletion unlocks. Spam streams are never contacted; Rules already handles their future delivery."}
                      </small>
                    </span>
                    <button
                      className="primary-button compact"
                      type="button"
                      disabled={!unsubscribeReady}
                      onClick={() => setActivePage("delete")}
                    >
                      {unsubscribeReady ? "Continue to Delete" : "Unsubscribe pass incomplete"}
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
              {!unsubscribeReady ? (
                prerequisite(
                  "Finish the unsubscribe pass first",
                  "Deletion is the narrowest and least reversible pass. Complete Scan, Organize, Rules, and Unsubscribe before reviewing stale leftovers.",
                  rulesReady ? "unsubscribe" : organizationReady ? "rules" : scannedCount ? "organize" : "audit",
                  rulesReady ? "Open unsubscribe" : organizationReady ? "Open rules" : scannedCount ? "Open organize" : "Open scan",
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
                "Keep the pruning workspace recoverable.",
                "Check local health, export a content-free support report, create an encrypted profile backup, restore safely, or rebuild only the local index when analysis needs a clean start.",
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
      confirmation: "REBUILD LOCAL INDEX",
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

  const updateAppSettings = async (input: UpdateAppSettingsInput) => {
    setAppSettings(await window.emailOrganizer.updateAppSettings(input));
  };

  if (loading || !appSettings) {
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
      settings={appSettings}
      onUpdateSettings={updateAppSettings}
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
      onCreate={createProfile}
      onOpen={openProfile}
    />
  );
};
