import type {
  CreateProfileInput,
  ProfileSummary,
  SelectProfileInput,
} from './contracts/profiles';
import type { JobProgress } from '../core/jobs/job-types';
import type { GetJobInput, StartSyntheticJobInput } from './contracts/jobs';
import type {
  BridgeConnectResult,
  BridgeCredentials,
  BridgeDiagnostic,
  ProtonConnectionSummary,
  ProtonDiscoverySummary,
  ProtonDisconnectInput,
} from './contracts/proton';
import type {
  ProtonAuditJobInput,
  ProtonAuditProgress,
  StartProtonAuditInput,
} from './contracts/proton-audit';
import type { MailboxAnalysisSummary } from './contracts/analysis';
import type { ApproveCleanupInput, CleanupPlan, CleanupProgress, GenerateCleanupInput, GetCleanupInput } from './contracts/cleanup';
import type { StartUnsubscribeInput, SubscriptionDashboard, UnsubscribeJobInput, UnsubscribeProgress } from './contracts/unsubscribe';
import type { ExportRulePackInput, ExportRulePackResult } from './contracts/rules';
import type { GmailAuditSummary, GmailConnectionSummary, GmailDisconnectInput, GmailOAuthInput } from './contracts/gmail';
import type { ApproveGmailOrganizationInput, GmailOrganizationPlan } from './contracts/gmail-organize';
import type {
  AccountIdentityListInput,
  AccountIdentitySummary,
  AccountIdentityUpdateInput,
  AccountSelectionInput,
  MailAccountSummary,
} from './contracts/accounts';
import type { EditOrganizationProposal, OrganizationProposal, OrganizationProposalScope } from './contracts/organization';

export const IPC_CHANNELS = Object.freeze({
  appGetVersion: 'app:get-version',
  accountsList: 'accounts:list',
  accountsSelect: 'accounts:select',
  identitiesList: 'identities:list',
  identitiesRefresh: 'identities:refresh',
  identitiesUpdate: 'identities:update',
  organizationProposalGet: 'organization-proposal:get',
  organizationProposalGenerate: 'organization-proposal:generate',
  organizationProposalEdit: 'organization-proposal:edit',
  profilesCreate: 'profiles:create',
  profilesList: 'profiles:list',
  profilesSelect: 'profiles:select',
  jobsGet: 'jobs:get',
  jobsProgress: 'jobs:progress',
  jobsResume: 'jobs:resume',
  jobsStartSynthetic: 'jobs:start-synthetic',
  protonConnect: 'proton:connect',
  protonDiagnose: 'proton:diagnose',
  protonDisconnect: 'proton:disconnect',
  protonDiscover: 'proton:discover',
  protonGetDiscovery: 'proton:get-discovery',
  protonGetConnection: 'proton:get-connection',
  protonAuditGetCurrent: 'proton-audit:get-current',
  protonAuditPause: 'proton-audit:pause',
  protonAuditProgress: 'proton-audit:progress',
  protonAuditResume: 'proton-audit:resume',
  protonAuditStart: 'proton-audit:start',
  analysisGet: 'analysis:get',
  analysisRun: 'analysis:run',
  rulesExport: 'rules:export',
  gmailConnect: 'gmail:connect',
  gmailDisconnect: 'gmail:disconnect',
  gmailGetConnection: 'gmail:get-connection',
  gmailAuditGet: 'gmail-audit:get',
  gmailAuditStart: 'gmail-audit:start',
  gmailAuditProgress: 'gmail-audit:progress',
  gmailAnalysisGet: 'gmail-analysis:get',
  gmailAnalysisRun: 'gmail-analysis:run',
  gmailOrganizeGet: 'gmail-organize:get',
  gmailOrganizeGenerate: 'gmail-organize:generate',
  gmailOrganizeApprove: 'gmail-organize:approve',
  gmailUnsubscribeGet: 'gmail-unsubscribe:get',
  gmailUnsubscribeScan: 'gmail-unsubscribe:scan',
  gmailUnsubscribeStart: 'gmail-unsubscribe:start',
  cleanupApprove: 'cleanup:approve',
  cleanupGenerate: 'cleanup:generate',
  cleanupGet: 'cleanup:get',
  cleanupProgress: 'cleanup:progress',
  cleanupResume: 'cleanup:resume',
  unsubscribeGet: 'unsubscribe:get',
  unsubscribeProgress: 'unsubscribe:progress',
  unsubscribeResume: 'unsubscribe:resume',
  unsubscribeScan: 'unsubscribe:scan',
  unsubscribeStart: 'unsubscribe:start',
} as const);

export const EMAIL_ORGANIZER_BRIDGE_METHODS = Object.freeze([
  'getVersion',
  'listMailAccounts',
  'selectMailAccount',
  'listAccountIdentities',
  'refreshAccountIdentities',
  'updateAccountIdentity',
  'getOrganizationProposal',
  'generateOrganizationProposal',
  'editOrganizationProposal',
  'listProfiles',
  'createProfile',
  'selectProfile',
  'startSyntheticJob',
  'getJob',
  'resumeJob',
  'onJobProgress',
  'getProtonConnection',
  'diagnoseProtonBridge',
  'connectProtonBridge',
  'disconnectProtonBridge',
  'discoverProtonMailbox',
  'getProtonDiscovery',
  'startProtonAudit',
  'getCurrentProtonAudit',
  'resumeProtonAudit',
  'pauseProtonAudit',
  'onProtonAuditProgress',
  'getMailboxAnalysis',
  'analyzeMailbox',
  'exportRulePack',
  'getGmailConnection',
  'connectGmail',
  'disconnectGmail',
  'getGmailAudit',
  'startGmailAudit',
  'onGmailAuditProgress',
  'getGmailAnalysis',
  'analyzeGmail',
  'getGmailOrganizationPlan',
  'generateGmailOrganizationPlan',
  'approveGmailOrganizationPlan',
  'getGmailSubscriptionDashboard',
  'scanGmailSubscriptions',
  'startGmailBulkUnsubscribe',
  'getCleanupPlan',
  'generateCleanupPlan',
  'approveCleanupPlan',
  'resumeCleanupPlan',
  'onCleanupProgress',
  'getSubscriptionDashboard',
  'scanSubscriptions',
  'startBulkUnsubscribe',
  'resumeBulkUnsubscribe',
  'onUnsubscribeProgress',
] as const);

export interface EmailOrganizerBridge {
  getVersion(): Promise<string>;
  listMailAccounts(): Promise<MailAccountSummary[]>;
  selectMailAccount(input: AccountSelectionInput): Promise<MailAccountSummary>;
  listAccountIdentities(input: AccountIdentityListInput): Promise<AccountIdentitySummary[]>;
  refreshAccountIdentities(input: AccountIdentityListInput): Promise<AccountIdentitySummary[]>;
  updateAccountIdentity(input: AccountIdentityUpdateInput): Promise<AccountIdentitySummary>;
  getOrganizationProposal(input: OrganizationProposalScope): Promise<OrganizationProposal | null>;
  generateOrganizationProposal(input: OrganizationProposalScope): Promise<OrganizationProposal>;
  editOrganizationProposal(input: EditOrganizationProposal): Promise<OrganizationProposal>;
  listProfiles(): Promise<ProfileSummary[]>;
  createProfile(input: CreateProfileInput): Promise<ProfileSummary>;
  selectProfile(input: SelectProfileInput): Promise<ProfileSummary>;
  startSyntheticJob(input: StartSyntheticJobInput): Promise<JobProgress>;
  getJob(input: GetJobInput): Promise<JobProgress>;
  resumeJob(input: GetJobInput): Promise<JobProgress>;
  onJobProgress(listener: (progress: JobProgress) => void): () => void;
  getProtonConnection(): Promise<ProtonConnectionSummary | null>;
  diagnoseProtonBridge(input: BridgeCredentials): Promise<BridgeDiagnostic>;
  connectProtonBridge(input: BridgeCredentials): Promise<BridgeConnectResult>;
  disconnectProtonBridge(input: ProtonDisconnectInput): Promise<void>;
  discoverProtonMailbox(): Promise<ProtonDiscoverySummary>;
  getProtonDiscovery(): Promise<ProtonDiscoverySummary | null>;
  startProtonAudit(input: StartProtonAuditInput): Promise<ProtonAuditProgress>;
  getCurrentProtonAudit(): Promise<ProtonAuditProgress | null>;
  resumeProtonAudit(input: ProtonAuditJobInput): Promise<ProtonAuditProgress>;
  pauseProtonAudit(input: ProtonAuditJobInput): Promise<ProtonAuditProgress>;
  onProtonAuditProgress(listener: (progress: ProtonAuditProgress) => void): () => void;
  getMailboxAnalysis(): Promise<MailboxAnalysisSummary | null>;
  analyzeMailbox(): Promise<MailboxAnalysisSummary>;
  exportRulePack(input: ExportRulePackInput): Promise<ExportRulePackResult>;
  getGmailConnection(): Promise<GmailConnectionSummary | null>;
  connectGmail(input: GmailOAuthInput): Promise<GmailConnectionSummary>;
  disconnectGmail(input: GmailDisconnectInput): Promise<void>;
  getGmailAudit(): Promise<GmailAuditSummary | null>;
  startGmailAudit(): Promise<GmailAuditSummary>;
  onGmailAuditProgress(listener: (progress: { profileId: string; summary: GmailAuditSummary }) => void): () => void;
  getGmailAnalysis(): Promise<MailboxAnalysisSummary | null>;
  analyzeGmail(): Promise<MailboxAnalysisSummary>;
  getGmailOrganizationPlan(): Promise<GmailOrganizationPlan | null>;
  generateGmailOrganizationPlan(): Promise<GmailOrganizationPlan>;
  approveGmailOrganizationPlan(input: ApproveGmailOrganizationInput): Promise<GmailOrganizationPlan>;
  getGmailSubscriptionDashboard(): Promise<SubscriptionDashboard | null>;
  scanGmailSubscriptions(): Promise<SubscriptionDashboard>;
  startGmailBulkUnsubscribe(input: StartUnsubscribeInput): Promise<SubscriptionDashboard>;
  getCleanupPlan(input: GetCleanupInput): Promise<CleanupPlan | null>;
  generateCleanupPlan(input: GenerateCleanupInput): Promise<CleanupPlan>;
  approveCleanupPlan(input: ApproveCleanupInput): Promise<CleanupProgress>;
  resumeCleanupPlan(input: ApproveCleanupInput): Promise<CleanupProgress>;
  onCleanupProgress(listener: (progress: CleanupProgress) => void): () => void;
  getSubscriptionDashboard(): Promise<SubscriptionDashboard | null>;
  scanSubscriptions(): Promise<SubscriptionDashboard>;
  startBulkUnsubscribe(input: StartUnsubscribeInput): Promise<UnsubscribeProgress>;
  resumeBulkUnsubscribe(input: UnsubscribeJobInput): Promise<UnsubscribeProgress>;
  onUnsubscribeProgress(listener: (progress: UnsubscribeProgress) => void): () => void;
}

declare global {
  interface Window {
    emailOrganizer: Readonly<EmailOrganizerBridge>;
  }
}
