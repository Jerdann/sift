import * as Dialog from '@radix-ui/react-dialog';
import {
  Archive,
  Check,
  ChevronRight,
  CircleDot,
  FolderTree,
  Inbox,
  LockKeyhole,
  MailPlus,
  Search,
  ShieldCheck,
  Tags,
  UserRound,
  X,
} from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import type { ProfileSummary } from '../shared/contracts/profiles';
import type {
  BridgeConnectResult,
  BridgeCredentials,
  BridgeDiagnostic,
  ProtonConnectionSummary,
  ProtonDiscoverySummary,
} from '../shared/contracts/proton';
import type { ProtonAuditProgress } from '../shared/contracts/proton-audit';
import type { MailboxAnalysisSummary } from '../shared/contracts/analysis';
import type { CleanupPlan, CleanupProgress } from '../shared/contracts/cleanup';
import type { SubscriptionDashboard, UnsubscribeProgress } from '../shared/contracts/unsubscribe';
import { buildPortableRulePack } from '../core/rules/rule-pack';
import type { GmailAuditSummary, GmailConnectionSummary } from '../shared/contracts/gmail';
import type { GmailOrganizationPlan } from '../shared/contracts/gmail-organize';

type PageId = 'overview' | 'accounts' | 'audit' | 'organize' | 'unsubscribe' | 'delete';
const navItems: ReadonlyArray<{ id: PageId; label: string; icon: typeof Inbox }> = [
  { id: 'overview', label: 'Overview', icon: Inbox },
  { id: 'accounts', label: 'Accounts', icon: MailPlus },
  { id: 'audit', label: 'Scan', icon: Search },
  { id: 'organize', label: 'Organize', icon: FolderTree },
  { id: 'unsubscribe', label: 'Unsubscribe', icon: Tags },
  { id: 'delete', label: 'Trash review', icon: Archive },
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

const ProfilePicker = ({ profiles, loadError, onCreate, onOpen }: ProfilePickerProps) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = profileName.trim();
    if (value.length < 2) {
      setError('Enter at least 2 characters.');
      return;
    }
    setBusy(true);
    try {
      await onCreate(value);
      setDialogOpen(false);
    } catch {
      setError("Sift couldn't create this local profile. Try a different name.");
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
          <span><LockKeyhole size={16} /> Encrypted locally</span>
          <span><ShieldCheck size={16} /> Approval required</span>
        </div>

        <div className="picker-divider" />

        <div className="picker-heading">
          <div>
            <h2>Local profiles</h2>
            <p>Profiles keep each person's accounts and plans separate.</p>
          </div>
          <span className="count-label">{profiles.length} {profiles.length === 1 ? 'PROFILE' : 'PROFILES'}</span>
        </div>

        {loadError ? <p className="workspace-error" role="alert">{loadError}</p> : null}
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
                <span className="profile-avatar">{profile.displayName.slice(0, 1).toUpperCase()}</span>
                <span className="profile-row-copy">
                  <strong>{profile.displayName}</strong>
                  <small>{profile.providerCount} connected providers · {profile.lastOpenedAt ? 'Used on this computer' : 'Never opened'}</small>
                </span>
                <button className="secondary-button" type="button" onClick={() => void onOpen(profile)}>Open</button>
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
            <Dialog.Content className="dialog-content" aria-describedby="profile-help">
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
                    setError('');
                  }}
                  aria-invalid={Boolean(error)}
                  aria-describedby="profile-helper profile-error"
                />
                <p id="profile-helper" className="field-helper">
                  Stored only on this computer. You can add email accounts after opening it.
                </p>
                <p id="profile-error" className="field-error" role="alert">{error}</p>
                <div className="dialog-actions">
                  <Dialog.Close asChild>
                    <button className="secondary-button" type="button">Cancel</button>
                  </Dialog.Close>
                  <button className="primary-button compact" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create profile'}</button>
                </div>
              </form>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        <p className="picker-footnote">
          A local profile is not an email account. You'll connect Proton Mail or Gmail later.
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
  deletionPlan: CleanupPlan | null;
  onGenerateDeletion(senderDomains: string[]): Promise<void>;
  onApproveDeletion(planId: string, revision: string): Promise<void>;
  onResumeDeletion(planId: string, revision: string): Promise<void>;
  subscriptions: SubscriptionDashboard | null;
  onScanSubscriptions(): Promise<void>;
  onStartUnsubscribe(candidateIds: string[]): Promise<void>;
  onResumeUnsubscribe(jobId: string): Promise<void>;
  gmailConnection: GmailConnectionSummary | null;
  onConnectGmail(clientId: string, clientSecret?: string): Promise<void>;
  onDisconnectGmail(connectionId: string): Promise<void>;
  gmailAudit: GmailAuditSummary | null;
  onStartGmailAudit(): Promise<void>;
  gmailAnalysis: MailboxAnalysisSummary | null;
  onAnalyzeGmail(): Promise<void>;
  gmailOrganization: GmailOrganizationPlan | null;
  onGenerateGmailOrganization(): Promise<void>;
  onApproveGmailOrganization(planId:string,revision:string):Promise<void>;
  gmailSubscriptions:SubscriptionDashboard|null;
  onScanGmailSubscriptions():Promise<void>;
  onStartGmailUnsubscribe(candidateIds:string[]):Promise<void>;
}

interface ProtonConnectionPanelProps {
  connection: ProtonConnectionSummary | null;
  discovery: ProtonDiscoverySummary | null;
  onDiagnose(credentials: BridgeCredentials): Promise<BridgeDiagnostic>;
  onConnect(credentials: BridgeCredentials): Promise<BridgeConnectResult>;
  onDisconnect(connectionId: string): Promise<void>;
  onDiscover(): Promise<ProtonDiscoverySummary>;
}

const ProtonConnectionPanel = ({
  connection,
  discovery,
  onDiagnose,
  onConnect,
  onDisconnect,
  onDiscover,
}: ProtonConnectionPanelProps) => {
  const [credentials, setCredentials] = useState<BridgeCredentials>({
    host: '127.0.0.1',
    port: 1143,
    username: '',
    password: '',
    security: 'starttls',
  });
  const [diagnostic, setDiagnostic] = useState<BridgeDiagnostic | null>(null);
  const [busy, setBusy] = useState<'test' | 'save' | 'disconnect' | 'discover' | null>(null);
  const [error, setError] = useState('');

  const update = <Key extends keyof BridgeCredentials>(
    key: Key,
    value: BridgeCredentials[Key],
  ) => {
    setCredentials((current) => ({ ...current, [key]: value }));
    setDiagnostic(null);
    setError('');
  };

  const testConnection = async () => {
    setBusy('test');
    setError('');
    try {
      setDiagnostic(await onDiagnose(credentials));
    } catch {
      setError('Connection diagnostics could not run. No credentials were saved.');
    } finally {
      setBusy(null);
    }
  };

  const saveConnection = async () => {
    setBusy('save');
    setError('');
    try {
      const result = await onConnect(credentials);
      setDiagnostic(result.diagnostic);
      if (result.connection) {
        setCredentials((current) => ({ ...current, password: '' }));
      }
    } catch {
      setError('Sift could not encrypt and save this Bridge connection.');
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    if (!connection) return;
    setBusy('disconnect');
    setError('');
    try {
      await onDisconnect(connection.id);
      setDiagnostic(null);
    } catch {
      setError('The local Bridge credential could not be removed. Try again.');
    } finally {
      setBusy(null);
    }
  };

  const discover = async () => {
    setBusy('discover');
    setError('');
    try {
      await onDiscover();
    } catch {
      setError('The read-only discovery stopped before it finished. Check that Proton Bridge is running, then try again.');
    } finally {
      setBusy(null);
    }
  };

  if (connection) {
    return (
      <section className="readiness-panel proton-panel" aria-labelledby="proton-title">
        <div className="panel-header">
          <div>
            <p className="eyebrow">PROTON BRIDGE</p>
            <h2 id="proton-title">Connected locally</h2>
          </div>
          <span className="secured-label"><ShieldCheck size={14} /> Credentials encrypted</span>
        </div>
        <div className="connection-summary">
          <span className="state-icon safe"><Check size={15} /></span>
          <span>
            <strong>{connection.username}</strong>
            <small>{connection.host}:{connection.port} · {connection.security.toUpperCase()} · Combined-address audit ready</small>
          </span>
          <b>{connection.state === 'connected' ? 'READY' : 'ATTENTION'}</b>
        </div>
        <div className="panel-action connection-actions">
          <button className="primary-button" type="button" disabled={Boolean(busy)} onClick={() => void discover()}>
            {busy === 'discover' ? 'Mapping mailbox…' : discovery ? 'Refresh mailbox map' : 'Map folders and delivery addresses'}
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void disconnect()}
          >
            {busy === 'disconnect' ? 'Disconnecting…' : 'Remove local credential'}
          </button>
          {error ? <p className="field-error" role="alert">{error}</p> : null}
        </div>
        {discovery ? (
          <div className="discovery-scope" aria-live="polite">
            <div className="scope-heading">
              <span><Search size={16} /></span>
              <div>
                <strong>Read-only scope discovered</strong>
                <small>{new Date(discovery.discoveredAt).toLocaleString()} · zero mailbox changes</small>
              </div>
            </div>
            <div className="scope-metrics">
              <div><b>{discovery.mailboxes.length.toLocaleString()}</b><span>folders</span></div>
              <div><b>{discovery.totalMessageEstimate.toLocaleString()}</b><span>folder messages*</span></div>
              <div><b>{discovery.addresses.length.toLocaleString()}</b><span>observed delivery addresses</span></div>
            </div>
            <div className="scope-columns">
              <div>
                <h3>Observed delivery addresses</h3>
                {discovery.addresses.length ? (
                  <ul>{discovery.addresses.slice(0, 8).map((item) => <li key={item.address}><span>{item.address}</span><b>{item.occurrenceCount}</b></li>)}</ul>
                ) : <p>No delivery addresses found in the bounded header sample.</p>}
              </div>
              <div>
                <h3>Largest folders</h3>
                <ul>{[...discovery.mailboxes].sort((a, b) => b.messageCount - a.messageCount).slice(0, 8).map((item) => <li key={item.id}><span>{item.name}</span><b>{item.messageCount.toLocaleString()}</b></li>)}</ul>
              </div>
            </div>
            <p className="scope-footnote">*Folder totals may overlap when Proton exposes All Mail alongside Inbox and Archive.</p>
            <p className="scope-footnote">Delivery addresses come from message headers, not Proton's identity settings. Forwarders, mailing lists, old aliases, To, and Cc fields can appear here; confirm ownership before migrating or retiring one.</p>
            <p className="scope-footnote">Bridge exposes folders and messages over IMAP, but not Proton's existing server-side filters. Sift can propose new rules and export Sieve, but cannot inventory filters Bridge does not expose.</p>
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
    <section className="readiness-panel proton-panel" aria-labelledby="proton-title">
      <div className="panel-header">
        <div>
          <p className="eyebrow">ACCOUNT CONNECTION</p>
          <h2 id="proton-title">Connect Proton Bridge</h2>
        </div>
        <span className="secured-label"><LockKeyhole size={14} /> Bridge credentials only</span>
      </div>
      <div className="bridge-notice">
        <ShieldCheck size={18} />
        <p><strong>Do not enter your Proton account password.</strong> Open Proton Mail Bridge and copy the IMAP username, password, port, and connection security shown there.</p>
      </div>
      <form className="bridge-form" onSubmit={(event) => event.preventDefault()}>
        <label>
          <span>Local host</span>
          <input value={credentials.host} disabled aria-label="Bridge local host" />
        </label>
        <label>
          <span>IMAP port</span>
          <input
            type="number"
            min={1}
            max={65535}
            value={credentials.port}
            onChange={(event) => update('port', Number(event.target.value))}
          />
        </label>
        <label className="field-wide">
          <span>Bridge IMAP username</span>
          <input
            autoComplete="off"
            value={credentials.username}
            onChange={(event) => update('username', event.target.value)}
          />
        </label>
        <label className="field-wide">
          <span>Bridge IMAP password</span>
          <input
            type="password"
            autoComplete="new-password"
            value={credentials.password}
            onChange={(event) => update('password', event.target.value)}
          />
        </label>
        <label className="field-wide">
          <span>Connection security</span>
          <select
            value={credentials.security}
            onChange={(event) =>
              update('security', event.target.value as BridgeCredentials['security'])
            }
          >
            <option value="starttls">STARTTLS (Bridge default)</option>
            <option value="tls">TLS</option>
            <option value="plain">None — loopback only</option>
          </select>
        </label>
      </form>
      {diagnostic ? (
        <div className={diagnostic.ok ? 'diagnostic-result success' : 'diagnostic-result failure'} role="status">
          {diagnostic.ok ? <Check size={16} /> : <CircleDot size={16} />}
          <span><strong>{diagnostic.ok ? 'Bridge connection verified' : 'Connection needs attention'}</strong><small>{diagnostic.message}</small></span>
        </div>
      ) : null}
      {error ? <p className="connection-error" role="alert">{error}</p> : null}
      <div className="panel-action connection-actions">
        <button
          className="secondary-button"
          type="button"
          disabled={!formReady || Boolean(busy)}
          onClick={() => void testConnection()}
        >
          {busy === 'test' ? 'Testing…' : 'Test connection'}
        </button>
        <button
          className="primary-button"
          type="button"
          disabled={!diagnostic?.ok || Boolean(busy)}
          onClick={() => void saveConnection()}
        >
          {busy === 'save' ? 'Encrypting…' : 'Save encrypted connection'}
        </button>
        <p>Testing and saving do not change any message, folder, label, or read state.</p>
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

const ProtonAuditPanel = ({ discovery, audit, onStart, onPause, onResume }: ProtonAuditPanelProps) => {
  const [extractBodies, setExtractBodies] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!discovery) return null;

  const running = audit?.job.state === 'running';
  const resumable = audit?.job.state === 'pending';
  const finished = audit && ['succeeded', 'failed', 'verification_mismatch'].includes(audit.job.state);
  const act = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try { await action(); }
    catch { setError('The audit could not continue. Proton Bridge may need attention; completed folders are still saved.'); }
    finally { setBusy(false); }
  };

  return (
    <section className="readiness-panel audit-panel" aria-labelledby="audit-title">
      <div className="panel-header">
        <div><p className="eyebrow">READ-ONLY INDEX</p><h2 id="audit-title">Audit the mailbox</h2></div>
        <span className="secured-label"><ShieldCheck size={14} /> No IMAP mutations</span>
      </div>
      {audit ? (
        <div className="audit-progress" aria-live="polite">
          <div className="audit-progress-copy">
            <span><strong>{finished ? 'Audit pass complete' : running ? `Scanning ${audit.currentFolder ?? 'mailbox'}` : 'Audit paused safely'}</strong><small>{audit.indexedMessages.toLocaleString()} indexed · {audit.failureCount} recoverable failures{audit.extractBodies ? ' · bounded text enabled' : ' · metadata only'}</small></span>
            <b>{audit.job.percent}%</b>
          </div>
          <progress max={100} value={audit.job.percent} />
          <div className="audit-range"><span>Earliest <b>{audit.earliestAt ? new Date(audit.earliestAt).toLocaleDateString() : '—'}</b></span><span>Latest <b>{audit.latestAt ? new Date(audit.latestAt).toLocaleDateString() : '—'}</b></span><span>Folders <b>{audit.job.completedItems}/{audit.job.totalItems}</b></span></div>
          <div className="folder-progress-list">
            {audit.folders.map((folder) => (
              <div key={folder.path}><span>{folder.path}</span><small>{folder.indexedCount.toLocaleString()} / ~{folder.messageEstimate.toLocaleString()}</small><b>{folder.state.toUpperCase()}</b></div>
            ))}
          </div>
        </div>
      ) : (
        <div className="audit-consent">
          <p>The audit stores headers, dates, senders, recipients, folder state, and UIDs locally. It never marks mail read, moves messages, or downloads attachments.</p>
          <label><input type="checkbox" checked={extractBodies} onChange={(event) => setExtractBodies(event.target.checked)} /><span><strong>Allow bounded plain-text evidence</strong><small>Optional: up to 32 KB from a non-attachment text part per message, processed only on this computer.</small></span></label>
        </div>
      )}
      <div className="panel-action connection-actions">
        {!audit || finished ? <button className="primary-button" type="button" disabled={busy} onClick={() => void act(() => onStart(extractBodies))}>{busy ? 'Starting…' : finished ? 'Run a fresh audit' : 'Start read-only audit'}</button> : null}
        {running ? <button className="secondary-button" type="button" disabled={busy} onClick={() => void act(() => onPause(audit.job.id))}>Pause after this batch</button> : null}
        {resumable ? <button className="primary-button" type="button" disabled={busy} onClick={() => void act(() => onResume(audit.job.id))}>{busy ? 'Resuming…' : 'Resume from checkpoint'}</button> : null}
        {error ? <p className="field-error" role="alert">{error}</p> : null}
      </div>
    </section>
  );
};

const AnalysisPanel = ({
  audit,
  analysis,
  onAnalyze,
  provider = 'proton',
}: {
  audit: { indexedMessages: number } | null;
  analysis: MailboxAnalysisSummary | null;
  onAnalyze(): Promise<void>;
  provider?: 'proton' | 'gmail';
}) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [exportStatus, setExportStatus] = useState('');
  if (!audit?.indexedMessages) return null;
  const rulePack = analysis ? buildPortableRulePack(analysis) : null;
  const analyze = async () => {
    setBusy(true);
    setError('');
    try { await onAnalyze(); }
    catch { setError('Analysis could not finish. Your saved audit is unchanged; try again.'); }
    finally { setBusy(false); }
  };
  return (
    <section className="readiness-panel analysis-panel" aria-labelledby={`${provider}-analysis-title`}>
      <div className="panel-header">
        <div><p className="eyebrow">{provider.toUpperCase()} ORGANIZATION PROPOSAL</p><h2 id={`${provider}-analysis-title`}>What this mailbox is actually used for</h2></div>
        <span className="secured-label"><LockKeyhole size={14} /> Classified locally</span>
      </div>
      {!analysis ? (
        <div className="analysis-empty">
          <p>Turn the saved audit into proposed folders, sender streams, and an evidence-based map of which services use each receiving address.</p>
          <button className="primary-button compact" type="button" disabled={busy} onClick={() => void analyze()}>{busy ? 'Analyzing locally…' : 'Build organization proposal'}</button>
          {error ? <p className="field-error" role="alert">{error}</p> : null}
        </div>
      ) : (
        <div className="analysis-results">
          <div className="analysis-summary-line"><span><strong>{analysis.uniqueMessages.toLocaleString()} unique messages analyzed</strong><small>{analysis.categories.length} categories · {analysis.addresses.length} observed delivery addresses · {analysis.classifierVersion}</small></span><button className="secondary-button" type="button" disabled={busy} onClick={() => void analyze()}>{busy ? 'Refreshing…' : 'Refresh proposal'}</button></div>
          <div className="proposal-table" role="table" aria-label="Proposed mailbox folders">
            <div className="proposal-row proposal-head" role="row"><span>Category</span><span>Proposed folder</span><span>Messages</span><span>Confidence</span></div>
            {analysis.categories.map((category) => (
              <div className="proposal-row" role="row" key={category.category}><strong>{category.label}</strong><span>{category.proposedFolder}</span><b>{category.messageCount.toLocaleString()}</b><small>{Math.round(category.averageConfidence * 100)}%</small></div>
            ))}
          </div>
          <div className="analysis-columns">
            <div>
              <h3>Largest sender streams</h3>
              <ul>{analysis.topStreams.slice(0, 12).map((stream) => <li key={`${stream.senderDomain}:${stream.category}:${stream.receivingAddress}`}><span><strong>{stream.senderDomain}</strong><small>{stream.category} → {stream.receivingAddress}</small></span><b>{stream.messageCount.toLocaleString()}</b></li>)}</ul>
            </div>
            <div>
              <h3>Verified sending identities</h3>
              {analysis.addresses.length ? <ul>{analysis.addresses.slice(0, 15).map((address) => <li key={address.address}><span><strong>{address.address}</strong><small>{address.services.slice(0, 3).map((service) => service.domain).join(', ') || 'No linked service evidence yet'}</small></span><b className={`recommendation ${address.recommendation}`}>{address.recommendation === 'consider_deactivation' ? 'review retirement' : address.recommendation.replace('_', ' ')}</b></li>)}</ul> : <p className="analysis-empty-note">No owned identity is proven yet. Sift needs an address in the From field of a message stored in Proton's Sent folder.</p>}
            </div>
          </div>
          {rulePack ? (
            <div className="rule-pack-panel">
              <div>
                <span><strong>{rulePack.rules.length} conservative future rules ready</strong><small>{rulePack.skippedAmbiguousStreams} ambiguous sender streams omitted automatically</small></span>
                <div>
                  {provider === 'proton' ? <button className="secondary-button" type="button" onClick={() => void window.emailOrganizer.exportRulePack({ format: 'proton-sieve', source: provider }).then((result) => setExportStatus(result.canceled ? '' : `Saved ${result.ruleCount} Proton rules to ${result.path}`)).catch(() => setExportStatus('Rule export failed; your mailbox was not changed.'))}>Save Proton Sieve</button> : null}
                  <button className="secondary-button" type="button" onClick={() => void window.emailOrganizer.exportRulePack({ format: 'portable-json', source: provider }).then((result) => setExportStatus(result.canceled ? '' : `Saved portable rule pack to ${result.path}`)).catch(() => setExportStatus('Rule export failed; your mailbox was not changed.'))}>Save portable pack</button>
                </div>
              </div>
              {exportStatus ? <p>{exportStatus}</p> : null}
              <small>Rules use observed sender domain + receiving address. Personal, suspicious, uncertain, and mixed-use streams are excluded; security alerts are never marked read.</small>
            </div>
          ) : null}
          <p className="analysis-disclosure">Sending identities require two pieces of evidence: the message is stored in Proton's Sent folder and the address appears in its From field. Recipient, forwarding, and delivery headers can never create a retirement recommendation.</p>
        </div>
      )}
    </section>
  );
};

type OrganizationStage = 'identities' | 'containers' | 'categories' | 'senders' | 'filters';

const organizationStages: ReadonlyArray<{ id: OrganizationStage; label: string }> = [
  { id: 'identities', label: 'Aliases' },
  { id: 'containers', label: 'Containers' },
  { id: 'categories', label: 'Categories' },
  { id: 'senders', label: 'Sender cleanup' },
  { id: 'filters', label: 'Filters & apply' },
];

const recency = (latestAt: string | null): { label: string; days: number } => {
  if (!latestAt) return { label: 'No recent date', days: Number.POSITIVE_INFINITY };
  const days = Math.max(0, Math.floor((Date.now() - Date.parse(latestAt)) / 86_400_000));
  if (days < 2) return { label: 'Today', days };
  if (days < 30) return { label: `${days} days ago`, days };
  if (days < 365) return { label: `${Math.floor(days / 30)} months ago`, days };
  return { label: `${Math.floor(days / 365)} years ago`, days };
};

const suggestedContainerName = (address: string): string => {
  const local = address.split('@')[0] ?? address;
  return local.replace(/[._-]+/g, ' ').replace(/\b\w/g, (value) => value.toUpperCase()).slice(0, 64);
};

const ProtonOrganizationFlow = ({
  audit,
  analysis,
  cleanupPlan,
  onAnalyze,
  onGenerateCleanup,
  onApproveCleanup,
  onResumeCleanup,
  onContinue,
}: {
  audit: ProtonAuditProgress | null;
  analysis: MailboxAnalysisSummary | null;
  cleanupPlan: CleanupPlan | null;
  onAnalyze(): Promise<void>;
  onGenerateCleanup(containers: Record<string, string>): Promise<void>;
  onApproveCleanup(planId: string, revision: string): Promise<void>;
  onResumeCleanup(planId: string, revision: string): Promise<void>;
  onContinue(): void;
}) => {
  const [stage, setStage] = useState<OrganizationStage>('identities');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selectedAddress, setSelectedAddress] = useState('');
  const [containerized, setContainerized] = useState<Record<string, boolean>>({});
  const [containerNames, setContainerNames] = useState<Record<string, string>>({});
  const [exportStatus, setExportStatus] = useState('');
  const [senderLimit, setSenderLimit] = useState(25);

  useEffect(() => {
    if (!analysis?.addresses.length) return;
    setSelectedAddress((current) => current || analysis.addresses[0]!.address);
    setContainerNames((current) => Object.fromEntries(analysis.addresses.map((identity) => [
      identity.address,
      current[identity.address] ?? suggestedContainerName(identity.address),
    ])));
  }, [analysis]);

  if (!audit?.indexedMessages) return null;
  const analyze = async () => {
    setBusy(true); setError('');
    try { await onAnalyze(); setStage('identities'); }
    catch { setError('Sift could not rebuild the proposal. The saved scan is still available; try again.'); }
    finally { setBusy(false); }
  };
  if (!analysis) {
    return <section className="readiness-panel organization-flow"><div className="panel-header"><div><p className="eyebrow">PROTON ORGANIZE</p><h2>Start with the aliases inside this mailbox</h2></div><span className="secured-label"><LockKeyhole size={14} /> Local analysis</span></div><div className="analysis-empty"><p>Sift will prove owned aliases first, then build separate category and cleanup proposals for each address.</p><button className="primary-button compact" type="button" disabled={busy} onClick={() => void analyze()}>{busy ? 'Building alias map…' : 'Build address-first proposal'}</button>{error ? <p className="field-error">{error}</p> : null}</div></section>;
  }

  const stageIndex = organizationStages.findIndex((item) => item.id === stage);
  const currentAddress = selectedAddress || analysis.addresses[0]?.address || '';
  const streamsForAddress = analysis.topStreams.filter((stream) => stream.receivingAddress === currentAddress);
  const categoryRows = [...new Set(streamsForAddress.map((stream) => stream.category))].map((category) => {
    const streams = streamsForAddress.filter((stream) => stream.category === category);
    const standard = analysis.categories.find((item) => item.category === category);
    return {
      category,
      label: standard?.label ?? category,
      folder: standard?.proposedFolder ?? category,
      messages: streams.reduce((sum, stream) => sum + stream.messageCount, 0),
    };
  }).sort((left, right) => right.messages - left.messages);
  const senders = [...new Set(analysis.topStreams.map((stream) => stream.senderDomain))].map((domain) => {
    const streams = analysis.topStreams.filter((stream) => stream.senderDomain === domain);
    const latestAt = streams.map((stream) => stream.latestAt).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
    return {
      domain,
      messages: streams.reduce((sum, stream) => sum + stream.messageCount, 0),
      latestAt,
      addresses: [...new Set(streams.map((stream) => stream.receivingAddress))],
    };
  }).sort((left, right) => right.messages - left.messages);
  const containers = Object.fromEntries(analysis.addresses
    .filter((identity) => containerized[identity.address] && containerNames[identity.address]?.trim())
    .map((identity) => [identity.address, containerNames[identity.address]!.trim()]));
  const rulePack = buildPortableRulePack(analysis);

  return <>
    <section className="readiness-panel organization-flow" aria-labelledby="organization-flow-title">
      <div className="organization-flow-head"><div><p className="eyebrow">PROTON ORGANIZATION</p><h2 id="organization-flow-title">Shape one address at a time</h2><p>{analysis.uniqueMessages.toLocaleString()} inbound messages · {analysis.addresses.length} proven aliases · {analysis.classifierVersion}</p></div><button className="secondary-button" type="button" disabled={busy} onClick={() => void analyze()}>{busy ? 'Refreshing…' : 'Rebuild proposal'}</button></div>
      <nav className="organization-stages" aria-label="Organization proposal stages">{organizationStages.map((item, index) => <button key={item.id} type="button" className={stage === item.id ? 'active' : index < stageIndex ? 'complete' : ''} onClick={() => setStage(item.id)}><span>{index < stageIndex ? <Check size={13} /> : index + 1}</span>{item.label}</button>)}</nav>

      {stage === 'identities' ? <div className="organization-stage"><div className="stage-intro"><span>1</span><div><h3>Confirm the aliases that belong to this mailbox</h3><p>Only Sent-folder From evidence and strong Delivered-To evidence qualify. To, Cc, Bcc, and unrelated senders are excluded.</p></div></div><div className="identity-list">{analysis.addresses.map((identity) => <div key={identity.address}><span className="state-icon safe"><Check size={15} /></span><span><strong>{identity.address}</strong><small>{identity.ownershipEvidence === 'sent_and_received' ? 'Sent from and received here' : identity.ownershipEvidence === 'sent' ? 'Proven from Sent mail' : identity.ownershipEvidence === 'provider_account' ? 'Provider account identity' : 'Proven from delivery headers'} · {identity.messageCount.toLocaleString()} mapped messages</small></span><b>{identity.canRetire ? 'SENT + RECEIVED' : 'RECEIVED ONLY'}</b></div>)}</div></div> : null}

      {stage === 'containers' ? <div className="organization-stage"><div className="stage-intro"><span>2</span><div><h3>Choose which aliases deserve their own container</h3><p>A container becomes the top-level folder for that address. Leave an alias off to use the shared category structure.</p></div></div><div className="container-list">{analysis.addresses.map((identity) => <label key={identity.address} className={containerized[identity.address] ? 'selected' : ''}><input type="checkbox" checked={Boolean(containerized[identity.address])} onChange={(event) => setContainerized((current) => ({ ...current, [identity.address]: event.target.checked }))} /><span><strong>{identity.address}</strong><small>{identity.services.slice(0, 3).map((service) => service.domain).join(' · ') || 'No services mapped yet'}</small></span><input aria-label={`Container name for ${identity.address}`} disabled={!containerized[identity.address]} value={containerNames[identity.address] ?? ''} onChange={(event) => setContainerNames((current) => ({ ...current, [identity.address]: event.target.value.replace(/[\\/]/g, '').slice(0, 64) }))} /></label>)}</div></div> : null}

      {stage === 'categories' ? <div className="organization-stage"><div className="stage-intro"><span>3</span><div><h3>Review standard categories inside each address</h3><p>Switch aliases to see the proposal change. Containerized addresses receive paths such as Home & Joint/Money/Receipts.</p></div></div><div className="address-switcher" role="tablist" aria-label="Alias category proposal">{analysis.addresses.map((identity) => <button role="tab" aria-selected={currentAddress === identity.address} className={currentAddress === identity.address ? 'active' : ''} key={identity.address} onClick={() => setSelectedAddress(identity.address)}>{identity.address}<small>{identity.messageCount.toLocaleString()} messages</small></button>)}</div>{categoryRows.length ? <div className="category-by-address"><div className="category-address-head"><strong>{currentAddress}</strong><span>{containerized[currentAddress] ? `${containerNames[currentAddress]} / …` : 'Shared category structure'}</span></div>{categoryRows.map((row) => <div key={row.category}><strong>{row.label}</strong><span>{containerized[currentAddress] ? `${containerNames[currentAddress]}/${row.folder}` : row.folder}</span><b>{row.messages.toLocaleString()}</b></div>)}</div> : <p className="analysis-empty-note">No confident category streams were found for this alias.</p>}</div> : null}

      {stage === 'senders' ? <div className="organization-stage"><div className="stage-intro"><span>4</span><div><h3>Catch the largest and stalest sender streams</h3><p>Volume shows the widest net. Last activity separates ongoing noise from abandoned history that is safer to remove in one batch.</p></div></div><div className="sender-review"><div className="sender-review-head"><span>Sender</span><span>Aliases</span><span>Last message</span><span>Suggested next move</span><span>Messages</span></div>{senders.slice(0, senderLimit).map((sender) => { const age = recency(sender.latestAt); const suggestion = age.days > 365 ? 'Delete old history' : age.days > 180 ? 'Review for deletion' : sender.messages > 100 ? 'Filter future mail' : 'Keep categorized'; return <div key={sender.domain}><strong>{sender.domain}</strong><span>{sender.addresses.length === 1 ? sender.addresses[0] : `${sender.addresses.length} aliases`}</span><small>{age.label}</small><b className={age.days > 180 ? 'stale' : ''}>{suggestion}</b><em>{sender.messages.toLocaleString()}</em></div>; })}</div>{senderLimit < Math.min(senders.length, 100) ? <button className="sender-expand" type="button" onClick={() => setSenderLimit((current) => Math.min(current + 25, 100))}>Show the next {Math.min(25, Math.min(senders.length, 100) - senderLimit)} senders</button> : null}</div> : null}

      {stage === 'filters' ? <div className="organization-stage"><div className="stage-intro"><span>5</span><div><h3>Turn the approved structure into folders and future rules</h3><p>{Object.keys(containers).length} alias containers selected. The cleanup preview below uses those paths; future-rule exports stay conservative and omit ambiguous streams.</p></div></div><div className="filter-summary"><span><b>{rulePack.rules.length}</b><small>high-confidence future rules</small></span><span><b>{rulePack.skippedAmbiguousStreams}</b><small>ambiguous streams withheld</small></span><div><button className="secondary-button" type="button" onClick={() => void window.emailOrganizer.exportRulePack({ format: 'proton-sieve', source: 'proton' }).then((result) => setExportStatus(result.canceled ? '' : `Saved ${result.ruleCount} rules to ${result.path}`)).catch(() => setExportStatus('Rule export failed.'))}>Save Proton Sieve</button><button className="secondary-button" type="button" onClick={() => void window.emailOrganizer.exportRulePack({ format: 'portable-json', source: 'proton' }).then((result) => setExportStatus(result.canceled ? '' : `Saved rule pack to ${result.path}`)).catch(() => setExportStatus('Rule export failed.'))}>Save portable pack</button></div></div>{exportStatus ? <p className="export-status">{exportStatus}</p> : null}</div> : null}

      <div className="organization-flow-actions"><button className="secondary-button" type="button" disabled={stageIndex === 0} onClick={() => setStage(organizationStages[stageIndex - 1]!.id)}>Back</button>{stageIndex < organizationStages.length - 1 ? <button className="primary-button compact" type="button" onClick={() => setStage(organizationStages[stageIndex + 1]!.id)}>Continue to {organizationStages[stageIndex + 1]!.label.toLowerCase()}</button> : <button className="primary-button compact" type="button" onClick={onContinue}>Continue to unsubscribe</button>}</div>
    </section>
    {stage === 'filters' ? <CleanupPanel analysis={analysis} plan={cleanupPlan} onGenerate={() => onGenerateCleanup(containers)} onApprove={onApproveCleanup} onResume={onResumeCleanup} /> : null}
  </>;
};

const CleanupPanel = ({
  analysis,
  plan,
  onGenerate,
  onApprove,
  onResume,
  mode = 'organize',
  canGenerate = true,
}: {
  analysis: MailboxAnalysisSummary | null;
  plan: CleanupPlan | null;
  onGenerate(): Promise<void>;
  onApprove(planId: string, revision: string): Promise<void>;
  onResume(planId: string, revision: string): Promise<void>;
  mode?: 'organize' | 'trash';
  canGenerate?: boolean;
}) => {
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!analysis) return null;
  const act = async (action: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await action(); }
    catch { setError('Cleanup stopped safely. Completed actions remain recorded; failed actions can be retried from their checkpoint.'); }
    finally { setBusy(false); }
  };
  const running = plan?.job?.state === 'running';
  const resumable = plan?.job?.state === 'pending' && plan.state !== 'draft';
  const trash = mode === 'trash';
  return (
    <section className="readiness-panel cleanup-panel" aria-labelledby="cleanup-title">
      <div className="panel-header">
        <div><p className="eyebrow">{trash ? 'FINAL PRUNING PASS' : 'REVIEW & APPLY'}</p><h2 id="cleanup-title">{trash ? 'Move selected stale history to Proton Trash' : 'Clean the Proton inbox'}</h2></div>
        <span className="secured-label"><ShieldCheck size={14} /> Explicit approval required</span>
      </div>
      {!plan ? (
        <div className="analysis-empty"><p>{trash ? 'Generate an exact reversible action list for the sender domains selected above. Security, accounts, transactions, finance, personal, and suspicious mail remain protected.' : 'Generate an immutable action list from this proposal. Uncertain, personal, and low-confidence messages stay untouched.'}</p><button className="primary-button compact" type="button" disabled={busy || !canGenerate} onClick={() => void act(onGenerate)}>{busy ? 'Calculating impact…' : trash ? 'Build exact Trash plan' : 'Preview exact cleanup impact'}</button></div>
      ) : (
        <div className="cleanup-review">
          <div className="cleanup-totals"><div><b>{plan.actionCount.toLocaleString()}</b><span>{trash ? 'messages selected' : 'approved candidates'}</span></div><div><b>{trash ? plan.trashCount.toLocaleString() : plan.spamCount.toLocaleString()}</b><span>{trash ? 'native Trash actions' : 'native Spam actions'}</span></div><div><b>{plan.skippedCount.toLocaleString()}</b><span>left untouched</span></div></div>
          <div className="proposal-table" role="table" aria-label="Cleanup impact">
            <div className="cleanup-impact-row cleanup-impact-head"><span>Category</span><span>Destination</span><span>Action</span><span>Messages</span></div>
            {plan.impacts.map((impact) => <div className="cleanup-impact-row" key={`${impact.category}:${impact.targetFolder}`}><strong>{impact.category}</strong><span>{impact.targetFolder}</span><small>{impact.action === 'native_spam' ? 'Report / move to Spam' : impact.action === 'native_trash' ? 'Move to provider Trash' : 'Mark read · move · archive'}</small><b>{impact.messageCount.toLocaleString()}</b></div>)}
          </div>
          {plan.state === 'draft' ? (
            <div className="cleanup-approval">
              <label><input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} /><span><strong>I approve these exact mailbox changes</strong><small>{trash ? 'Move only the listed non-critical messages into Proton’s native Trash folder. Nothing is permanently erased.' : 'Create the listed folders, mark selected messages read, move/archive them, and route only the listed high-confidence junk through Proton Spam.'}</small></span></label>
              <button className="primary-button" type="button" disabled={!approved || busy || plan.actionCount === 0} onClick={() => void act(() => onApprove(plan.id, plan.revision))}>{busy ? 'Starting cleanup…' : trash ? `Move ${plan.actionCount.toLocaleString()} messages to Trash` : `Apply ${plan.actionCount.toLocaleString()} approved actions`}</button>
            </div>
          ) : null}
          {plan.job ? (
            <div className="cleanup-execution" aria-live="polite"><div><span><strong>{plan.state === 'completed' ? 'Cleanup completed and recorded' : running ? 'Applying approved cleanup' : plan.state === 'failed' ? 'Cleanup finished with recoverable failures' : 'Cleanup paused at a checkpoint'}</strong><small>{plan.job.completedItems.toLocaleString()} / {plan.job.totalItems.toLocaleString()} actions processed</small></span><b>{plan.job.percent}%</b></div><progress max={100} value={plan.job.percent} />{resumable ? <button className="primary-button compact" type="button" disabled={busy} onClick={() => void act(() => onResume(plan.id, plan.revision))}>{busy ? 'Resuming…' : 'Resume cleanup'}</button> : null}</div>
          ) : null}
          <p className="cleanup-warning">No permanent deletion is used. {trash ? 'The selected history moves to Proton’s native Trash and remains recoverable under the provider’s retention policy.' : 'Messages excluded as personal, suspicious, low-confidence, or uncategorized remain where they are.'}</p>
        </div>
      )}
      {error ? <p className="connection-error" role="alert">{error}</p> : null}
    </section>
  );
};

const TrashReviewPanel = ({
  analysis,
  plan,
  onGenerate,
  onApprove,
  onResume,
}: {
  analysis: MailboxAnalysisSummary | null;
  plan: CleanupPlan | null;
  onGenerate(senderDomains: string[]): Promise<void>;
  onApprove(planId: string, revision: string): Promise<void>;
  onResume(planId: string, revision: string): Promise<void>;
}) => {
  const [selected, setSelected] = useState<string[]>([]);
  if (!analysis) return null;
  const protectedCategories = new Set(['personal', 'security', 'accounts', 'transactions', 'finance', 'suspicious']);
  const candidates = [...new Set(analysis.topStreams.map((stream) => stream.senderDomain))].map((domain) => {
    const streams = analysis.topStreams.filter((stream) => stream.senderDomain === domain);
    const latestAt = streams.map((stream) => stream.latestAt).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
    const age = recency(latestAt);
    return {
      domain,
      age,
      messages: streams.filter((stream) => !protectedCategories.has(stream.category)).reduce((sum, stream) => sum + stream.messageCount, 0),
      protected: streams.filter((stream) => protectedCategories.has(stream.category)).reduce((sum, stream) => sum + stream.messageCount, 0),
      addresses: [...new Set(streams.map((stream) => stream.receivingAddress))],
    };
  }).filter((candidate) => candidate.messages > 0 && candidate.age.days > 180)
    .sort((left, right) => right.messages - left.messages);
  return <>
    <section className="readiness-panel trash-review-panel">
      <div className="panel-header"><div><p className="eyebrow">STALE HISTORY</p><h2>Choose old sender streams to remove</h2></div><span className="secured-label"><Archive size={14} /> Reversible Trash only</span></div>
      <div className="trash-review-copy"><p>Sift shows senders whose newest message is at least six months old. Selecting a sender never includes security, account, transaction, finance, personal, or suspicious classifications.</p><span><b>{candidates.reduce((sum, item) => sum + item.messages, 0).toLocaleString()}</b> removable messages across <b>{candidates.length}</b> stale senders</span></div>
      <div className="trash-candidates"><div className="trash-candidate-head"><span></span><span>Sender</span><span>Alias scope</span><span>Newest message</span><span>Protected</span><span>Removable</span></div>{candidates.slice(0, 200).map((candidate) => <label key={candidate.domain}><input type="checkbox" checked={selected.includes(candidate.domain)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, candidate.domain] : current.filter((domain) => domain !== candidate.domain))} /><strong>{candidate.domain}</strong><span>{candidate.addresses.length === 1 ? candidate.addresses[0] : `${candidate.addresses.length} aliases`}</span><small>{candidate.age.label}</small><b>{candidate.protected.toLocaleString()}</b><em>{candidate.messages.toLocaleString()}</em></label>)}</div>
      {!candidates.length ? <p className="analysis-empty-note">No non-critical sender stream is old enough for the stale-history pass.</p> : null}
      {candidates.length ? <div className="trash-selection"><button className="secondary-button" type="button" onClick={() => setSelected(selected.length === candidates.length ? [] : candidates.map((candidate) => candidate.domain))}>{selected.length === candidates.length ? 'Clear selection' : 'Select all stale senders'}</button><span>{selected.length} sender{selected.length === 1 ? '' : 's'} selected</span></div> : null}
    </section>
    <CleanupPanel analysis={analysis} plan={plan} onGenerate={() => onGenerate(selected)} onApprove={onApprove} onResume={onResume} mode="trash" canGenerate={selected.length > 0} />
  </>;
};

const UnsubscribePanel = ({
  analysis,
  dashboard,
  onScan,
  onStart,
  onResume,
  provider = 'proton',
}: {
  analysis: MailboxAnalysisSummary | null;
  dashboard: SubscriptionDashboard | null;
  onScan(): Promise<void>;
  onStart(candidateIds: string[]): Promise<void>;
  onResume(jobId: string): Promise<void>;
  provider?: 'proton'|'gmail';
}) => {
  const [selected, setSelected] = useState<string[]>([]);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!analysis) return null;
  const act = async (action: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await action(); }
    catch { setError('Bulk unsubscribe stopped. Completed requests are recorded; no spam or protected sender was contacted.'); }
    finally { setBusy(false); }
  };
  const eligible = dashboard?.candidates.filter((candidate) => candidate.eligibility === 'eligible' && candidate.status === 'pending') ?? [];
  const protectedCount = dashboard?.candidates.filter((candidate) => candidate.eligibility === 'protected').length ?? 0;
  const spamCount = dashboard?.candidates.filter((candidate) => candidate.eligibility === 'spam_skipped').length ?? 0;
  const runActive = dashboard?.job?.state === 'pending' || dashboard?.job?.state === 'running';
  return (
    <section className="readiness-panel unsubscribe-panel" aria-labelledby={`${provider}-unsubscribe-title`}>
      <div className="panel-header"><div><p className="eyebrow">{provider.toUpperCase()} BULK UNSUBSCRIBE</p><h2 id={`${provider}-unsubscribe-title`}>Stop legitimate junk without confirming spam</h2></div><span className="secured-label"><ShieldCheck size={14} /> Authenticated one-click only</span></div>
      {!dashboard ? (
        <div className="analysis-empty"><p>Find authenticated mailing lists, separate protected transactional mail, and quarantine likely spam from all automated unsubscribe requests.</p><button className="primary-button compact" type="button" disabled={busy} onClick={() => void act(onScan)}>{busy ? 'Finding lists…' : 'Build unsubscribe dashboard'}</button></div>
      ) : (
        <div className="unsubscribe-review">
          <div className="unsubscribe-summary"><span><b>{eligible.length}</b> safe one-click candidates</span><span><b>{protectedCount}</b> protected lists</span><span><b>{spamCount}</b> spam contacts blocked</span><button className="secondary-button" type="button" disabled={busy || runActive} onClick={() => void act(async () => { await onScan(); setSelected([]); setConsent(false); })}>Refresh</button></div>
          <div className="unsubscribe-list">
            {eligible.map((candidate) => (
              <label key={candidate.id}><input type="checkbox" checked={selected.includes(candidate.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, candidate.id] : current.filter((id) => id !== candidate.id))} /><span><strong>{candidate.senderDomain}</strong><small>{candidate.messageCount.toLocaleString()} messages → {candidate.receivingAddress} · {candidate.sampleSubjects[0] ?? candidate.listId}</small></span><b>SAFE</b></label>
            ))}
            {!eligible.length ? <p>No pending authenticated one-click subscriptions remain.</p> : null}
          </div>
          {eligible.length ? <div className="unsubscribe-select"><button className="secondary-button" type="button" onClick={() => setSelected(selected.length === eligible.length ? [] : eligible.map((candidate) => candidate.id))}>{selected.length === eligible.length ? 'Clear selection' : 'Select all safe candidates'}</button><span>{selected.length} selected</span></div> : null}
          {selected.length ? <div className="unsubscribe-consent"><label><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span><strong>I authorize {selected.length} one-click unsubscribe request{selected.length === 1 ? '' : 's'}</strong><small>HTTPS POST only, no cookies or account credentials, public hosts only, and no requests to anything classified as spam, suspicious, transactional, security, account, or finance mail.</small></span></label><button className="primary-button" type="button" disabled={!consent || busy} onClick={() => void act(() => onStart(selected))}>{busy ? 'Sending approved requests…' : `Unsubscribe from ${selected.length} selected list${selected.length === 1 ? '' : 's'}`}</button></div> : null}
          {dashboard.job ? <div className="cleanup-execution"><div><span><strong>{dashboard.job.state === 'succeeded' ? 'Bulk unsubscribe complete' : dashboard.job.state === 'running' ? 'Sending approved one-click requests' : dashboard.job.state === 'failed' ? 'Finished with retryable failures' : 'Unsubscribe run paused'}</strong><small>{dashboard.job.completedItems} / {dashboard.job.totalItems} requests processed</small></span><b>{dashboard.job.percent}%</b></div><progress max={100} value={dashboard.job.percent} />{dashboard.job.state === 'pending' ? <button className="primary-button compact" type="button" disabled={busy} onClick={() => void act(() => onResume(dashboard.job!.id))}>Resume unsubscribe run</button> : null}</div> : null}
          <details className="unsubscribe-exclusions"><summary>Review protected, manual, and spam-skipped senders</summary><ul>{dashboard.candidates.filter((candidate) => candidate.eligibility !== 'eligible').slice(0, 100).map((candidate) => <li key={candidate.id}><span><strong>{candidate.senderDomain}</strong><small>{candidate.reason}</small></span><b>{candidate.eligibility.replace('_', ' ')}</b></li>)}</ul></details>
        </div>
      )}
      {error ? <p className="connection-error" role="alert">{error}</p> : null}
    </section>
  );
};

const GmailConnectionPanel = ({ connection, audit, onConnect, onDisconnect, onAudit }: { connection: GmailConnectionSummary | null; audit: GmailAuditSummary | null; onConnect(clientId: string, clientSecret?: string): Promise<void>; onDisconnect(connectionId: string): Promise<void>; onAudit(): Promise<void> }) => {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const connect = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try { await onConnect(clientId, clientSecret || undefined); }
    catch { setError('Gmail sign-in did not finish. Verify the Desktop OAuth client, Gmail API, consent-screen scopes, and test-user access.'); }
    finally { setBusy(false); }
  };
  return (
    <section className="readiness-panel gmail-panel" aria-labelledby="gmail-title">
      <div className="panel-header"><div><p className="eyebrow">GMAIL</p><h2 id="gmail-title">Connect through Google’s consent screen</h2></div><span className="secured-label"><ShieldCheck size={14} /> OAuth + PKCE</span></div>
      {connection ? (
        <div className="gmail-connected-wrap"><div className="gmail-connected"><div><span className="state-icon safe"><Check size={15} /></span><span><strong>{connection.email}</strong><small>Refresh access is encrypted in this Windows profile. Your Google password is never seen or stored.</small></span><b>CONNECTED</b></div><button className="secondary-button" type="button" disabled={busy || audit?.state === 'scanning'} onClick={() => void onDisconnect(connection.id)}>{busy ? 'Disconnecting…' : 'Disconnect Gmail'}</button></div><div className="gmail-audit"><span><strong>{audit?.state === 'completed' ? 'Gmail history inventoried' : audit?.state === 'scanning' ? 'Reading Gmail metadata' : audit?.state === 'paused' || audit?.state === 'failed' ? 'Audit can resume from its saved page' : 'Ready for a read-only history audit'}</strong><small>{(audit?.indexedMessages ?? 0).toLocaleString()} indexed{audit?.totalEstimate ? ` of about ${audit.totalEstimate.toLocaleString()}` : ''} · includes Spam and Trash for accurate classification</small></span><button className="primary-button compact" type="button" disabled={busy || audit?.state === 'scanning'} onClick={() => { setBusy(true); setError(''); void onAudit().catch(() => setError('Gmail audit paused at its last saved page. Check the connection and resume.')).finally(() => setBusy(false)); }}>{busy ? 'Scanning Gmail…' : audit?.state === 'completed' ? 'Run fresh Gmail audit' : audit?.indexedMessages ? 'Resume Gmail audit' : 'Start Gmail audit'}</button></div>{audit?.state === 'scanning' ? <progress max={Math.max(audit.totalEstimate, 1)} value={audit.indexedMessages} /> : null}</div>
      ) : (
        <form className="gmail-connect-form" onSubmit={(event) => void connect(event)}>
          <p>Use a Google Cloud <strong>Desktop app</strong> OAuth client with the Gmail API enabled. The browser handles sign-in; Sift listens only on a random <code>127.0.0.1</code> callback port.</p>
          <label><span>OAuth client ID</span><input required value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder="123456789-….apps.googleusercontent.com" autoComplete="off" /></label>
          <details><summary>Client secret (optional for PKCE)</summary><label><span>OAuth client secret</span><input type="password" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} autoComplete="off" /></label></details>
          <div className="connection-actions"><button className="primary-button" type="submit" disabled={busy || !clientId}>{busy ? 'Waiting for Google…' : 'Open Google sign-in'}</button><small>For an unverified testing project, add both Gmail addresses as test users.</small></div>
        </form>
      )}
      {error ? <p className="connection-error" role="alert">{error}</p> : null}
    </section>
  );
};

const GmailOrganizationPanel=({analysis,plan,onGenerate,onApprove}:{analysis:MailboxAnalysisSummary|null;plan:GmailOrganizationPlan|null;onGenerate():Promise<void>;onApprove(id:string,revision:string):Promise<void>})=>{const[consent,setConsent]=useState(false);const[busy,setBusy]=useState(false);const[error,setError]=useState('');if(!analysis)return null;const act=async(action:()=>Promise<void>)=>{setBusy(true);setError('');try{await action();}catch{setError('Gmail organization stopped safely. Reopen the plan to retry rules that did not finish.');}finally{setBusy(false);}};return <section className="readiness-panel gmail-organize-panel" aria-labelledby="gmail-organize-title"><div className="panel-header"><div><p className="eyebrow">GMAIL LABELS + FILTERS</p><h2 id="gmail-organize-title">Apply the learned system to Gmail</h2></div><span className="secured-label"><ShieldCheck size={14}/> Approval required</span></div>{!plan?<div className="analysis-empty"><p>Build an exact plan that creates labels, installs future sender filters, and batch-labels the matching history. Security mail stays in Inbox and unread; uncertain streams remain untouched.</p><button className="primary-button compact" disabled={busy} onClick={()=>void act(onGenerate)}>{busy?'Building plan…':'Build Gmail action plan'}</button></div>:<div className="cleanup-review"><div className="cleanup-totals"><div><b>{plan.ruleCount}</b><span>future filters</span></div><div><b>{plan.existingMessageCount.toLocaleString()}</b><span>existing messages</span></div><div><b>{plan.skippedAmbiguousStreams}</b><span>ambiguous streams skipped</span></div></div><div className="proposal-table"><div className="cleanup-impact-row cleanup-impact-head"><span>Sender</span><span>Label</span><span>Action</span><span>Messages</span></div>{plan.rules.slice(0,100).map(rule=><div className="cleanup-impact-row" key={rule.id}><strong>{rule.senderDomain}</strong><span>{rule.targetLabel}</span><small>{rule.spam?'Spam':`${rule.markRead?'read · ':''}${rule.archive?'archive':'keep in inbox'}`}</small><b>{rule.existingMessages}</b></div>)}</div>{plan.state==='draft'?<div className="cleanup-approval"><label><input type="checkbox" checked={consent} onChange={event=>setConsent(event.target.checked)}/><span><strong>I approve these Gmail labels, filters, and history changes</strong><small>No deletion. Only the exact high-confidence sender streams listed above are changed.</small></span></label><button className="primary-button" disabled={!consent||busy||!plan.ruleCount} onClick={()=>void act(()=>onApprove(plan.id,plan.revision))}>{busy?'Applying Gmail plan…':'Apply approved Gmail plan'}</button></div>:<div className="cleanup-execution"><div><span><strong>{plan.state==='completed'?'Gmail organization complete':plan.state==='failed'?'Some rules can be retried':'Applying Gmail plan'}</strong><small>{plan.rules.filter(rule=>rule.state==='succeeded').length} / {plan.ruleCount} rules finished</small></span><b>{Math.round(plan.rules.filter(rule=>rule.state==='succeeded').length/Math.max(plan.ruleCount,1)*100)}%</b></div><progress max={plan.ruleCount||1} value={plan.rules.filter(rule=>rule.state==='succeeded').length}/></div>}</div>}{error?<p className="connection-error">{error}</p>:null}</section>;};

const AppShell = ({
  profileName,
  onSwitchProfile,
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
  deletionPlan,
  onGenerateDeletion,
  onApproveDeletion,
  onResumeDeletion,
  subscriptions,
  onScanSubscriptions,
  onStartUnsubscribe,
  onResumeUnsubscribe,
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
  gmailSubscriptions,
  onScanGmailSubscriptions,
  onStartGmailUnsubscribe,
}: AppShellProps) => {
  const [activePage, setActivePage] = useState<PageId>('overview');
  const connectedCount = Number(Boolean(protonConnection)) + Number(Boolean(gmailConnection));
  const scannedCount = Number(Boolean(protonAudit?.indexedMessages)) + Number(Boolean(gmailAudit?.indexedMessages));
  const organizedCount = Number(Boolean(cleanupPlan)) + Number(Boolean(gmailOrganization));
  const pageLabel = navItems.find((item) => item.id === activePage)?.label ?? 'Overview';
  const emptyAccounts = !protonConnection && !gmailConnection;

  const taskIntro = (title: string, copy: string) => (
    <div className="page-heading task-heading"><h1>{title}</h1><p>{copy}</p></div>
  );
  const prerequisite = (title: string, copy: string, target: PageId, action: string) => (
    <section className="task-empty"><FolderTree size={24} /><div><h2>{title}</h2><p>{copy}</p></div><button className="primary-button compact" type="button" onClick={() => setActivePage(target)}>{action}</button></section>
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="sidebar-brand" type="button" onClick={() => setActivePage('overview')}><BrandMark /><span>Sift</span></button>
        <nav aria-label="Primary navigation">
          {navItems.map(({ id, label, icon: Icon }) => <button key={id} className={activePage === id ? 'nav-item active' : 'nav-item'} type="button" onClick={() => setActivePage(id)}><Icon size={18} /><span>{label}</span></button>)}
        </nav>
        <div className="sidebar-footer">
          <div className="local-status"><CircleDot size={12} /> Local only</div>
          <button className="profile-switcher" type="button" onClick={onSwitchProfile}><span className="profile-avatar">{profileName.slice(0, 1).toUpperCase()}</span><span><strong>{profileName}</strong><small>Switch profile</small></span><ChevronRight size={15} /></button>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar"><div><span>Sift</span><ChevronRight size={14} /><strong>{pageLabel}</strong></div><div className="read-only-badge"><ShieldCheck size={14} /> Local-first</div></header>
        <main className="overview">
          {activePage === 'overview' ? <>
            <section className="product-hero">
              <div><p className="eyebrow">INBOX PRUNING, WITH A PLAN</p><h1>Keep the mail that matters. Clear out the rest.</h1><p>Sift turns years of accumulated email into a map of accounts, purchases, subscriptions, promotions, and noise—then lets you shape the rules before anything moves.</p><div className="hero-actions"><button className="primary-button compact" type="button" onClick={() => setActivePage(emptyAccounts ? 'accounts' : 'audit')}>{emptyAccounts ? 'Connect your first account' : scannedCount ? 'Continue pruning' : 'Scan connected accounts'}</button><button className="secondary-button" type="button" onClick={() => setActivePage('accounts')}>Add another account</button></div></div>
              <div className="workspace-pulse" aria-label="Workspace progress"><div><b>{connectedCount}</b><span>accounts connected</span></div><div><b>{scannedCount}</b><span>mailboxes scanned</span></div><div><b>{organizedCount}</b><span>plans prepared</span></div></div>
            </section>
            <section className="workflow-section" aria-labelledby="workflow-title"><div className="section-heading"><h2 id="workflow-title">From crowded mailbox to a system that holds</h2><p>Each stage produces something concrete. Review the result, adjust the plan, then move forward.</p></div><ol className="workflow-steps"><li><span>1</span><div><strong>Connect an account</strong><p>Add Proton or Gmail to this private profile. Add more accounts whenever you need them.</p></div></li><li><span>2</span><div><strong>Map the history</strong><p>Inventory folders, delivery addresses, senders, and years of messages without changing mail.</p></div></li><li><span>3</span><div><strong>Shape the system</strong><p>Review categories, labels, account relationships, future rules, and every excluded edge case.</p></div></li><li><span>4</span><div><strong>Prune with approval</strong><p>Apply the exact moves you accept, route spam, and stop legitimate bulk mail at the source.</p></div></li></ol></section>
            <section className="next-action"><span><strong>{emptyAccounts ? 'Start with an account' : scannedCount < connectedCount ? 'Your next best action: scan' : 'Your mailbox map is ready to shape'}</strong><small>{emptyAccounts ? 'Connect Proton, Gmail, or both.' : scannedCount < connectedCount ? 'Build a complete inventory before designing labels and rules.' : 'Open Organize to review categories and prepare cleanup.'}</small></span><button className="primary-button compact" type="button" onClick={() => setActivePage(emptyAccounts ? 'accounts' : scannedCount < connectedCount ? 'audit' : 'organize')}>{emptyAccounts ? 'Open accounts' : scannedCount < connectedCount ? 'Open scan' : 'Open organize'}</button></section>
          </> : null}

          {activePage === 'accounts' ? <>{taskIntro('Bring every inbox into one pruning workspace.', 'Connect an account, confirm what Sift can see, and add another whenever your email life expands. Proton uses Bridge; Gmail uses Google OAuth. Outlook and Hotmail are planned next.')}<GmailConnectionPanel connection={gmailConnection} audit={gmailAudit} onConnect={onConnectGmail} onDisconnect={onDisconnectGmail} onAudit={onStartGmailAudit}/><ProtonConnectionPanel connection={protonConnection} discovery={protonDiscovery} onDiagnose={onDiagnoseProton} onConnect={onConnectProton} onDisconnect={onDisconnectProton} onDiscover={onDiscoverProton}/></> : null}

          {activePage === 'audit' ? <>{taskIntro('Map the mailbox before you prune it.', 'Scan message history into a private inventory of senders, dates, folders, and bounded text evidence. A scan changes nothing in the mailbox and can resume after interruption.')}{emptyAccounts ? prerequisite('Connect an account first', 'Sift needs a mailbox connection before it can build an inventory.', 'accounts', 'Open accounts') : <><GmailConnectionPanel connection={gmailConnection} audit={gmailAudit} onConnect={onConnectGmail} onDisconnect={onDisconnectGmail} onAudit={onStartGmailAudit}/><ProtonAuditPanel discovery={protonDiscovery} audit={protonAudit} onStart={onStartProtonAudit} onPause={onPauseProtonAudit} onResume={onResumeProtonAudit}/></>}</> : null}

          {activePage === 'organize' ? <>{taskIntro('Turn mailbox history into a durable system.', 'Start with the aliases that belong to you, decide which purposes stay separate, then narrow the proposal through categories, stale senders, filters, and exact provider actions.')}{!protonAudit?.indexedMessages && !gmailAudit?.indexedMessages ? prerequisite('Scan at least one mailbox', 'Organization proposals are learned from the message inventory, not from a generic template.', emptyAccounts ? 'accounts' : 'audit', emptyAccounts ? 'Connect an account' : 'Open scan') : <><AnalysisPanel provider="gmail" audit={gmailAudit} analysis={gmailAnalysis} onAnalyze={onAnalyzeGmail}/><GmailOrganizationPanel analysis={gmailAnalysis} plan={gmailOrganization} onGenerate={onGenerateGmailOrganization} onApprove={onApproveGmailOrganization}/><ProtonOrganizationFlow audit={protonAudit} analysis={analysis} cleanupPlan={cleanupPlan} onAnalyze={onAnalyzeMailbox} onGenerateCleanup={onGenerateCleanup} onApproveCleanup={onApproveCleanup} onResumeCleanup={onResumeCleanup} onContinue={() => setActivePage('unsubscribe')} /></>}</> : null}

          {activePage === 'unsubscribe' ? <>{taskIntro('Stop the mail you never wanted to keep.', 'Find authenticated mailing lists, protect receipts and account notices, and send approved one-click unsubscribe requests without confirming your address to suspected spam.')}{!analysis && !gmailAnalysis ? prerequisite('Build an organization proposal first', 'Sift needs classified sender streams to separate safe subscriptions from protected and suspicious mail.', emptyAccounts ? 'accounts' : scannedCount ? 'organize' : 'audit', emptyAccounts ? 'Connect an account' : scannedCount ? 'Open organize' : 'Open scan') : <><UnsubscribePanel provider="gmail" analysis={gmailAnalysis} dashboard={gmailSubscriptions} onScan={onScanGmailSubscriptions} onStart={onStartGmailUnsubscribe} onResume={async()=>undefined}/><UnsubscribePanel analysis={analysis} dashboard={subscriptions} onScan={onScanSubscriptions} onStart={onStartUnsubscribe} onResume={onResumeUnsubscribe}/>{analysis ? <section className="next-action"><span><strong>Finish with stale history</strong><small>Unsubscribing stops future mail. The last pass identifies old, non-critical sender history that can move to recoverable Trash.</small></span><button className="primary-button compact" type="button" onClick={() => setActivePage('delete')}>Continue to Trash review</button></section> : null}</>}</> : null}

          {activePage === 'delete' ? <>{taskIntro('Delete last, when the broad cleanup work is already done.', 'Review stale sender history by volume and last activity, protect critical classifications, then move only the exact approved messages into the provider’s recoverable Trash.')}{!analysis ? prerequisite('Build the Proton organization proposal first', 'The final deletion pass depends on proven aliases and classified sender history.', protonAudit?.indexedMessages ? 'organize' : 'audit', protonAudit?.indexedMessages ? 'Open organize' : 'Open scan') : <TrashReviewPanel analysis={analysis} plan={deletionPlan} onGenerate={onGenerateDeletion} onApprove={onApproveDeletion} onResume={onResumeDeletion} />}</> : null}
        </main>
      </div>
    </div>
  );
};

export const App = () => {
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [activeProfile, setActiveProfile] = useState<ProfileSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [protonConnection, setProtonConnection] = useState<ProtonConnectionSummary | null>(null);
  const [protonDiscovery, setProtonDiscovery] = useState<ProtonDiscoverySummary | null>(null);
  const [protonAudit, setProtonAudit] = useState<ProtonAuditProgress | null>(null);
  const [analysis, setAnalysis] = useState<MailboxAnalysisSummary | null>(null);
  const [cleanupPlan, setCleanupPlan] = useState<CleanupPlan | null>(null);
  const [deletionPlan, setDeletionPlan] = useState<CleanupPlan | null>(null);
  const [subscriptions, setSubscriptions] = useState<SubscriptionDashboard | null>(null);
  const [gmailConnection, setGmailConnection] = useState<GmailConnectionSummary | null>(null);
  const [gmailAudit, setGmailAudit] = useState<GmailAuditSummary | null>(null);
  const [gmailAnalysis, setGmailAnalysis] = useState<MailboxAnalysisSummary | null>(null);
  const [gmailOrganization,setGmailOrganization]=useState<GmailOrganizationPlan|null>(null);
  const [gmailSubscriptions,setGmailSubscriptions]=useState<SubscriptionDashboard|null>(null);

  useEffect(() => {
    void window.emailOrganizer
      .listProfiles()
      .then(setProfiles)
      .catch(() => setLoadError("Sift couldn't load local profiles. Try reopening the app."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => window.emailOrganizer.onProtonAuditProgress((progress) => {
    if (progress.profileId === activeProfile?.id) setProtonAudit(progress);
  }), [activeProfile?.id]);
  useEffect(() => window.emailOrganizer.onCleanupProgress((progress: CleanupProgress) => {
    if (progress.profileId !== activeProfile?.id) return;
    if (progress.plan.kind === 'trash') setDeletionPlan(progress.plan);
    else setCleanupPlan(progress.plan);
  }), [activeProfile?.id]);
  useEffect(() => window.emailOrganizer.onUnsubscribeProgress((progress: UnsubscribeProgress) => {
    if (progress.profileId === activeProfile?.id) setSubscriptions(progress.dashboard);
  }), [activeProfile?.id]);
  useEffect(() => window.emailOrganizer.onGmailAuditProgress((progress) => {
    if (progress.profileId === activeProfile?.id) setGmailAudit(progress.summary);
  }), [activeProfile?.id]);

  const createProfile = async (displayName: string) => {
    const profile = await window.emailOrganizer.createProfile({ displayName });
    setProfiles((existing) => [...existing, profile]);
    setActiveProfile(profile);
    setProtonConnection(await window.emailOrganizer.getProtonConnection());
    setProtonDiscovery(await window.emailOrganizer.getProtonDiscovery());
    setProtonAudit(await window.emailOrganizer.getCurrentProtonAudit());
    setAnalysis(await window.emailOrganizer.getMailboxAnalysis());
    setCleanupPlan(await window.emailOrganizer.getCleanupPlan({ kind: 'organize' }));
    setDeletionPlan(await window.emailOrganizer.getCleanupPlan({ kind: 'trash' }));
    setSubscriptions(await window.emailOrganizer.getSubscriptionDashboard());
    setGmailConnection(await window.emailOrganizer.getGmailConnection());
    setGmailAudit(await window.emailOrganizer.getGmailAudit());
    setGmailAnalysis(await window.emailOrganizer.getGmailAnalysis());
    setGmailOrganization(await window.emailOrganizer.getGmailOrganizationPlan());
    setGmailSubscriptions(await window.emailOrganizer.getGmailSubscriptionDashboard());
  };

  const openProfile = async (profile: ProfileSummary) => {
    const selected = await window.emailOrganizer.selectProfile({ profileId: profile.id });
    setProfiles((existing) => existing.map((item) => item.id === selected.id ? selected : item));
    setActiveProfile(selected);
    const [connection, discovery, audit, mailboxAnalysis, currentCleanupPlan, currentDeletionPlan, currentSubscriptions, currentGmail, currentGmailAudit, currentGmailAnalysis,currentGmailOrganization,currentGmailSubscriptions] = await Promise.all([
      window.emailOrganizer.getProtonConnection(),
      window.emailOrganizer.getProtonDiscovery(),
      window.emailOrganizer.getCurrentProtonAudit(),
      window.emailOrganizer.getMailboxAnalysis(),
      window.emailOrganizer.getCleanupPlan({ kind: 'organize' }),
      window.emailOrganizer.getCleanupPlan({ kind: 'trash' }),
      window.emailOrganizer.getSubscriptionDashboard(),
      window.emailOrganizer.getGmailConnection(),
      window.emailOrganizer.getGmailAudit(),
      window.emailOrganizer.getGmailAnalysis(),
      window.emailOrganizer.getGmailOrganizationPlan(),
      window.emailOrganizer.getGmailSubscriptionDashboard(),
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
    setGmailSubscriptions(currentGmailSubscriptions);
  };

  const connectProton = async (credentials: BridgeCredentials) => {
    const result = await window.emailOrganizer.connectProtonBridge(credentials);
    if (result.connection) setProtonConnection(result.connection);
    return result;
  };

  const disconnectProton = async (connectionId: string) => {
    await window.emailOrganizer.disconnectProtonBridge({ connectionId });
    setProtonConnection(null);
    setProtonDiscovery(null);
    setProtonAudit(null);
    setAnalysis(null);
    setCleanupPlan(null);
    setDeletionPlan(null);
    setSubscriptions(null);
  };

  const discoverProton = async () => {
    const discovery = await window.emailOrganizer.discoverProtonMailbox();
    setProtonDiscovery(discovery);
    return discovery;
  };

  const startProtonAudit = async (extractBodies: boolean) => {
    setProtonAudit(await window.emailOrganizer.startProtonAudit({ extractBodies }));
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

  const generateCleanup = async (containers: Record<string, string>) => setCleanupPlan(await window.emailOrganizer.generateCleanupPlan({ kind: 'organize', containers, trashSenderDomains: [] }));
  const approveCleanup = async (planId: string, revision: string) => {
    const progress = await window.emailOrganizer.approveCleanupPlan({ planId, revision });
    setCleanupPlan(progress.plan);
  };
  const resumeCleanup = async (planId: string, revision: string) => {
    const progress = await window.emailOrganizer.resumeCleanupPlan({ planId, revision });
    setCleanupPlan(progress.plan);
  };
  const generateDeletion = async (senderDomains: string[]) => setDeletionPlan(await window.emailOrganizer.generateCleanupPlan({ kind: 'trash', containers: {}, trashSenderDomains: senderDomains }));
  const approveDeletion = async (planId: string, revision: string) => {
    const progress = await window.emailOrganizer.approveCleanupPlan({ planId, revision });
    setDeletionPlan(progress.plan);
  };
  const resumeDeletion = async (planId: string, revision: string) => {
    const progress = await window.emailOrganizer.resumeCleanupPlan({ planId, revision });
    setDeletionPlan(progress.plan);
  };
  const scanSubscriptions = async () => setSubscriptions(await window.emailOrganizer.scanSubscriptions());
  const startUnsubscribe = async (candidateIds: string[]) => {
    const progress = await window.emailOrganizer.startBulkUnsubscribe({ candidateIds });
    setSubscriptions(progress.dashboard);
  };
  const resumeUnsubscribe = async (jobId: string) => {
    const progress = await window.emailOrganizer.resumeBulkUnsubscribe({ jobId });
    setSubscriptions(progress.dashboard);
  };
  const connectGmail = async (clientId: string, clientSecret?: string) => {
    setGmailConnection(await window.emailOrganizer.connectGmail({ clientId, ...(clientSecret ? { clientSecret } : {}) }));
    setGmailAudit(await window.emailOrganizer.getGmailAudit());
  };
  const disconnectGmail = async (connectionId: string) => {
    await window.emailOrganizer.disconnectGmail({ connectionId });
    setGmailConnection(null);
    setGmailAudit(null);
    setGmailAnalysis(null);
    setGmailOrganization(null);
    setGmailSubscriptions(null);
  };
  const startGmailAudit = async () => setGmailAudit(await window.emailOrganizer.startGmailAudit());
  const analyzeGmail = async () => setGmailAnalysis(await window.emailOrganizer.analyzeGmail());
  const generateGmailOrganization=async()=>setGmailOrganization(await window.emailOrganizer.generateGmailOrganizationPlan());
  const approveGmailOrganization=async(planId:string,revision:string)=>setGmailOrganization(await window.emailOrganizer.approveGmailOrganizationPlan({planId,revision}));
  const scanGmailSubscriptions=async()=>setGmailSubscriptions(await window.emailOrganizer.scanGmailSubscriptions());
  const startGmailUnsubscribe=async(candidateIds:string[])=>setGmailSubscriptions(await window.emailOrganizer.startGmailBulkUnsubscribe({candidateIds}));

  if (loading) {
    return <main className="loading-screen" aria-live="polite"><BrandMark /><span>Preparing local workspace…</span></main>;
  }

  return activeProfile ? (
    <AppShell
      profileName={activeProfile.displayName}
      onSwitchProfile={() => setActiveProfile(null)}
      protonConnection={protonConnection}
      protonDiscovery={protonDiscovery}
      onDiagnoseProton={(credentials) => window.emailOrganizer.diagnoseProtonBridge(credentials)}
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
      deletionPlan={deletionPlan}
      onGenerateDeletion={generateDeletion}
      onApproveDeletion={approveDeletion}
      onResumeDeletion={resumeDeletion}
      subscriptions={subscriptions}
      onScanSubscriptions={scanSubscriptions}
      onStartUnsubscribe={startUnsubscribe}
      onResumeUnsubscribe={resumeUnsubscribe}
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
      gmailSubscriptions={gmailSubscriptions}
      onScanGmailSubscriptions={scanGmailSubscriptions}
      onStartGmailUnsubscribe={startGmailUnsubscribe}
    />
  ) : (
    <ProfilePicker profiles={profiles} loadError={loadError} onCreate={createProfile} onOpen={openProfile} />
  );
};
