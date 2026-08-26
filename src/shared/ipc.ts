import type {
  CreateProfileInput,
  ProfileSummary,
  SelectProfileInput,
} from "./contracts/profiles";
import type { JobProgress } from "../core/jobs/job-types";
import type { GetJobInput, StartSyntheticJobInput } from "./contracts/jobs";
import type {
  BridgeConnectResult,
  BridgeCredentials,
  BridgeDiagnostic,
  ProtonConnectionSummary,
  ProtonDiscoverySummary,
  ProtonDisconnectInput,
} from "./contracts/proton";
import type {
  ProtonAuditJobInput,
  ProtonAuditProgress,
  StartProtonAuditInput,
} from "./contracts/proton-audit";
import type { MailboxAnalysisSummary } from "./contracts/analysis";
import type {
  ApproveCleanupInput,
  CleanupPlan,
  CleanupProgress,
  GenerateCleanupInput,
  GetCleanupInput,
  RetryCleanupInput,
  UndoCleanupInput,
} from "./contracts/cleanup";
import type {
  RetryUnsubscribeInput,
  StartUnsubscribeInput,
  SubscriptionDashboard,
  UnsubscribeJobInput,
  UnsubscribeProgress,
} from "./contracts/unsubscribe";
import type {
  ExportRulePackInput,
  ExportRulePackResult,
} from "./contracts/rules";
import type {
  GmailAuditSummary,
  GmailConnectionSummary,
  GmailDisconnectInput,
  GmailOAuthInput,
} from "./contracts/gmail";
import type {
  ApproveGmailOrganizationInput,
  GenerateGmailDeletionInput,
  GmailOrganizationPlan,
  RetryGmailOrganizationInput,
  UndoGmailOrganizationInput,
} from "./contracts/gmail-organize";
import type {
  AccountIdentityListInput,
  AccountIdentitySummary,
  AccountIdentityUpdateInput,
  AccountSelectionInput,
  MailAccountSummary,
} from "./contracts/accounts";
import type {
  EditOrganizationProposal,
  OrganizationProposal,
  OrganizationProposalScope,
} from "./contracts/organization";
import type {
  ApproveRulePlan,
  ExportProtonRulePlan,
  ProtonRuleExportResult,
  RetryRulePlan,
  RuleInventory,
  RuleManagementScope,
  RuleReconciliationPlan,
  UndoRulePlan,
} from "./contracts/rule-management";
import type {
  OutlookAuditSummary,
  OutlookConnectionSummary,
  OutlookDisconnectInput,
  OutlookOAuthInput,
} from "./contracts/outlook";
import type {
  BackupResult,
  DiagnosticsExportResult,
  DiagnosticsSummary,
  RebuildIndexInput,
  RebuildIndexResult,
  RestoreProfileInput,
  RestoreResult,
} from "./contracts/recovery";

export const IPC_CHANNELS = Object.freeze({
  appGetVersion: "app:get-version",
  accountsList: "accounts:list",
  accountsSelect: "accounts:select",
  identitiesList: "identities:list",
  identitiesRefresh: "identities:refresh",
  identitiesUpdate: "identities:update",
  organizationProposalGet: "organization-proposal:get",
  organizationProposalGenerate: "organization-proposal:generate",
  organizationProposalEdit: "organization-proposal:edit",
  ruleInventoryGet: "rule-inventory:get",
  ruleInventoryRefresh: "rule-inventory:refresh",
  rulePlanGet: "rule-plan:get",
  rulePlanGenerate: "rule-plan:generate",
  rulePlanApprove: "rule-plan:approve",
  rulePlanRetry: "rule-plan:retry",
  rulePlanUndo: "rule-plan:undo",
  rulePlanExportProton: "rule-plan:export-proton",
  profilesCreate: "profiles:create",
  profilesList: "profiles:list",
  profilesSelect: "profiles:select",
  jobsGet: "jobs:get",
  jobsProgress: "jobs:progress",
  jobsResume: "jobs:resume",
  jobsStartSynthetic: "jobs:start-synthetic",
  protonConnect: "proton:connect",
  protonDiagnose: "proton:diagnose",
  protonDisconnect: "proton:disconnect",
  protonDiscover: "proton:discover",
  protonGetDiscovery: "proton:get-discovery",
  protonGetConnection: "proton:get-connection",
  protonAuditGetCurrent: "proton-audit:get-current",
  protonAuditPause: "proton-audit:pause",
  protonAuditProgress: "proton-audit:progress",
  protonAuditResume: "proton-audit:resume",
  protonAuditStart: "proton-audit:start",
  analysisGet: "analysis:get",
  analysisRun: "analysis:run",
  rulesExport: "rules:export",
  gmailConnect: "gmail:connect",
  gmailDisconnect: "gmail:disconnect",
  gmailGetConnection: "gmail:get-connection",
  gmailAuditGet: "gmail-audit:get",
  gmailAuditStart: "gmail-audit:start",
  gmailAuditProgress: "gmail-audit:progress",
  gmailAnalysisGet: "gmail-analysis:get",
  gmailAnalysisRun: "gmail-analysis:run",
  gmailOrganizeGet: "gmail-organize:get",
  gmailOrganizeGenerate: "gmail-organize:generate",
  gmailOrganizeApprove: "gmail-organize:approve",
  gmailOrganizeRetry: "gmail-organize:retry",
  gmailOrganizeUndo: "gmail-organize:undo",
  gmailOrganizeProgress: "gmail-organize:progress",
  gmailDeletionGet: "gmail-deletion:get",
  gmailDeletionGenerate: "gmail-deletion:generate",
  gmailUnsubscribeGet: "gmail-unsubscribe:get",
  gmailUnsubscribeScan: "gmail-unsubscribe:scan",
  gmailUnsubscribeStart: "gmail-unsubscribe:start",
  gmailUnsubscribeResume: "gmail-unsubscribe:resume",
  gmailUnsubscribeRetry: "gmail-unsubscribe:retry",
  gmailUnsubscribeProgress: "gmail-unsubscribe:progress",
  outlookConnect: "outlook:connect",
  outlookDisconnect: "outlook:disconnect",
  outlookGetConnection: "outlook:get-connection",
  outlookAuditGet: "outlook-audit:get",
  outlookAuditStart: "outlook-audit:start",
  outlookAuditProgress: "outlook-audit:progress",
  outlookAnalysisGet: "outlook-analysis:get",
  outlookAnalysisRun: "outlook-analysis:run",
  outlookOrganizeGet: "outlook-organize:get",
  outlookOrganizeGenerate: "outlook-organize:generate",
  outlookOrganizeApprove: "outlook-organize:approve",
  outlookOrganizeRetry: "outlook-organize:retry",
  outlookOrganizeUndo: "outlook-organize:undo",
  outlookOrganizeProgress: "outlook-organize:progress",
  outlookDeletionGet: "outlook-deletion:get",
  outlookDeletionGenerate: "outlook-deletion:generate",
  outlookUnsubscribeGet: "outlook-unsubscribe:get",
  outlookUnsubscribeScan: "outlook-unsubscribe:scan",
  outlookUnsubscribeStart: "outlook-unsubscribe:start",
  outlookUnsubscribeResume: "outlook-unsubscribe:resume",
  outlookUnsubscribeRetry: "outlook-unsubscribe:retry",
  outlookUnsubscribeProgress: "outlook-unsubscribe:progress",
  cleanupApprove: "cleanup:approve",
  cleanupGenerate: "cleanup:generate",
  cleanupGet: "cleanup:get",
  cleanupProgress: "cleanup:progress",
  cleanupResume: "cleanup:resume",
  cleanupRetry: "cleanup:retry",
  cleanupUndo: "cleanup:undo",
  unsubscribeGet: "unsubscribe:get",
  unsubscribeProgress: "unsubscribe:progress",
  unsubscribeResume: "unsubscribe:resume",
  unsubscribeScan: "unsubscribe:scan",
  unsubscribeStart: "unsubscribe:start",
  unsubscribeRetry: "unsubscribe:retry",
  recoveryDiagnosticsGet: "recovery:diagnostics:get",
  recoveryDiagnosticsExport: "recovery:diagnostics:export",
  recoveryBackupCreate: "recovery:backup:create",
  recoveryBackupRestore: "recovery:backup:restore",
  recoveryIndexRebuild: "recovery:index:rebuild",
} as const);

export const EMAIL_ORGANIZER_BRIDGE_METHODS = Object.freeze([
  "getVersion",
  "listMailAccounts",
  "selectMailAccount",
  "listAccountIdentities",
  "refreshAccountIdentities",
  "updateAccountIdentity",
  "getOrganizationProposal",
  "generateOrganizationProposal",
  "editOrganizationProposal",
  "getRuleInventory",
  "refreshRuleInventory",
  "getRulePlan",
  "generateRulePlan",
  "approveRulePlan",
  "retryRulePlan",
  "undoRulePlan",
  "exportProtonRulePlan",
  "listProfiles",
  "createProfile",
  "selectProfile",
  "startSyntheticJob",
  "getJob",
  "resumeJob",
  "onJobProgress",
  "getProtonConnection",
  "diagnoseProtonBridge",
  "connectProtonBridge",
  "disconnectProtonBridge",
  "discoverProtonMailbox",
  "getProtonDiscovery",
  "startProtonAudit",
  "getCurrentProtonAudit",
  "resumeProtonAudit",
  "pauseProtonAudit",
  "onProtonAuditProgress",
  "getMailboxAnalysis",
  "analyzeMailbox",
  "exportRulePack",
  "getGmailConnection",
  "connectGmail",
  "disconnectGmail",
  "getGmailAudit",
  "startGmailAudit",
  "onGmailAuditProgress",
  "getGmailAnalysis",
  "analyzeGmail",
  "getGmailOrganizationPlan",
  "generateGmailOrganizationPlan",
  "approveGmailOrganizationPlan",
  "retryGmailOrganizationPlan",
  "undoGmailOrganizationPlan",
  "onGmailOrganizationProgress",
  "getGmailDeletionPlan",
  "generateGmailDeletionPlan",
  "getGmailSubscriptionDashboard",
  "scanGmailSubscriptions",
  "startGmailBulkUnsubscribe",
  "resumeGmailBulkUnsubscribe",
  "retryGmailBulkUnsubscribe",
  "onGmailUnsubscribeProgress",
  "getOutlookConnection",
  "connectOutlook",
  "disconnectOutlook",
  "getOutlookAudit",
  "startOutlookAudit",
  "onOutlookAuditProgress",
  "getOutlookAnalysis",
  "analyzeOutlook",
  "getOutlookOrganizationPlan",
  "generateOutlookOrganizationPlan",
  "approveOutlookOrganizationPlan",
  "retryOutlookOrganizationPlan",
  "undoOutlookOrganizationPlan",
  "onOutlookOrganizationProgress",
  "getOutlookDeletionPlan",
  "generateOutlookDeletionPlan",
  "getOutlookSubscriptionDashboard",
  "scanOutlookSubscriptions",
  "startOutlookBulkUnsubscribe",
  "resumeOutlookBulkUnsubscribe",
  "retryOutlookBulkUnsubscribe",
  "onOutlookUnsubscribeProgress",
  "getCleanupPlan",
  "generateCleanupPlan",
  "approveCleanupPlan",
  "resumeCleanupPlan",
  "retryCleanupPlan",
  "undoCleanupPlan",
  "onCleanupProgress",
  "getSubscriptionDashboard",
  "scanSubscriptions",
  "startBulkUnsubscribe",
  "resumeBulkUnsubscribe",
  "retryBulkUnsubscribe",
  "onUnsubscribeProgress",
  "getDiagnostics",
  "exportDiagnostics",
  "createEncryptedBackup",
  "restoreEncryptedBackup",
  "rebuildLocalIndex",
] as const);

export interface EmailOrganizerBridge {
  getVersion(): Promise<string>;
  listMailAccounts(): Promise<MailAccountSummary[]>;
  selectMailAccount(input: AccountSelectionInput): Promise<MailAccountSummary>;
  listAccountIdentities(
    input: AccountIdentityListInput,
  ): Promise<AccountIdentitySummary[]>;
  refreshAccountIdentities(
    input: AccountIdentityListInput,
  ): Promise<AccountIdentitySummary[]>;
  updateAccountIdentity(
    input: AccountIdentityUpdateInput,
  ): Promise<AccountIdentitySummary>;
  getOrganizationProposal(
    input: OrganizationProposalScope,
  ): Promise<OrganizationProposal | null>;
  generateOrganizationProposal(
    input: OrganizationProposalScope,
  ): Promise<OrganizationProposal>;
  editOrganizationProposal(
    input: EditOrganizationProposal,
  ): Promise<OrganizationProposal>;
  getRuleInventory(input: RuleManagementScope): Promise<RuleInventory | null>;
  refreshRuleInventory(input: RuleManagementScope): Promise<RuleInventory>;
  getRulePlan(
    input: RuleManagementScope,
  ): Promise<RuleReconciliationPlan | null>;
  generateRulePlan(input: RuleManagementScope): Promise<RuleReconciliationPlan>;
  approveRulePlan(input: ApproveRulePlan): Promise<RuleReconciliationPlan>;
  retryRulePlan(input: RetryRulePlan): Promise<RuleReconciliationPlan>;
  undoRulePlan(input: UndoRulePlan): Promise<RuleReconciliationPlan>;
  exportProtonRulePlan(
    input: ExportProtonRulePlan,
  ): Promise<ProtonRuleExportResult>;
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
  onProtonAuditProgress(
    listener: (progress: ProtonAuditProgress) => void,
  ): () => void;
  getMailboxAnalysis(): Promise<MailboxAnalysisSummary | null>;
  analyzeMailbox(): Promise<MailboxAnalysisSummary>;
  exportRulePack(input: ExportRulePackInput): Promise<ExportRulePackResult>;
  getGmailConnection(): Promise<GmailConnectionSummary | null>;
  connectGmail(input: GmailOAuthInput): Promise<GmailConnectionSummary>;
  disconnectGmail(input: GmailDisconnectInput): Promise<void>;
  getGmailAudit(): Promise<GmailAuditSummary | null>;
  startGmailAudit(): Promise<GmailAuditSummary>;
  onGmailAuditProgress(
    listener: (progress: {
      profileId: string;
      summary: GmailAuditSummary;
    }) => void,
  ): () => void;
  getGmailAnalysis(): Promise<MailboxAnalysisSummary | null>;
  analyzeGmail(): Promise<MailboxAnalysisSummary>;
  getGmailOrganizationPlan(): Promise<GmailOrganizationPlan | null>;
  generateGmailOrganizationPlan(): Promise<GmailOrganizationPlan>;
  approveGmailOrganizationPlan(
    input: ApproveGmailOrganizationInput,
  ): Promise<GmailOrganizationPlan>;
  retryGmailOrganizationPlan(
    input: RetryGmailOrganizationInput,
  ): Promise<GmailOrganizationPlan>;
  undoGmailOrganizationPlan(
    input: UndoGmailOrganizationInput,
  ): Promise<GmailOrganizationPlan>;
  onGmailOrganizationProgress(
    listener: (progress: {
      profileId: string;
      plan: GmailOrganizationPlan;
    }) => void,
  ): () => void;
  getGmailDeletionPlan(): Promise<GmailOrganizationPlan | null>;
  generateGmailDeletionPlan(
    input: GenerateGmailDeletionInput,
  ): Promise<GmailOrganizationPlan>;
  getGmailSubscriptionDashboard(): Promise<SubscriptionDashboard | null>;
  scanGmailSubscriptions(): Promise<SubscriptionDashboard>;
  startGmailBulkUnsubscribe(
    input: StartUnsubscribeInput,
  ): Promise<SubscriptionDashboard>;
  resumeGmailBulkUnsubscribe(
    input: UnsubscribeJobInput,
  ): Promise<SubscriptionDashboard>;
  retryGmailBulkUnsubscribe(
    input: RetryUnsubscribeInput,
  ): Promise<SubscriptionDashboard>;
  onGmailUnsubscribeProgress(
    listener: (progress: UnsubscribeProgress) => void,
  ): () => void;
  getOutlookConnection(): Promise<OutlookConnectionSummary | null>;
  connectOutlook(input: OutlookOAuthInput): Promise<OutlookConnectionSummary>;
  disconnectOutlook(input: OutlookDisconnectInput): Promise<void>;
  getOutlookAudit(): Promise<OutlookAuditSummary | null>;
  startOutlookAudit(): Promise<OutlookAuditSummary>;
  onOutlookAuditProgress(
    listener: (progress: {
      profileId: string;
      summary: OutlookAuditSummary;
    }) => void,
  ): () => void;
  getOutlookAnalysis(): Promise<MailboxAnalysisSummary | null>;
  analyzeOutlook(): Promise<MailboxAnalysisSummary>;
  getOutlookOrganizationPlan(): Promise<GmailOrganizationPlan | null>;
  generateOutlookOrganizationPlan(): Promise<GmailOrganizationPlan>;
  approveOutlookOrganizationPlan(
    input: ApproveGmailOrganizationInput,
  ): Promise<GmailOrganizationPlan>;
  retryOutlookOrganizationPlan(
    input: RetryGmailOrganizationInput,
  ): Promise<GmailOrganizationPlan>;
  undoOutlookOrganizationPlan(
    input: UndoGmailOrganizationInput,
  ): Promise<GmailOrganizationPlan>;
  onOutlookOrganizationProgress(
    listener: (progress: {
      profileId: string;
      plan: GmailOrganizationPlan;
    }) => void,
  ): () => void;
  getOutlookDeletionPlan(): Promise<GmailOrganizationPlan | null>;
  generateOutlookDeletionPlan(
    input: GenerateGmailDeletionInput,
  ): Promise<GmailOrganizationPlan>;
  getOutlookSubscriptionDashboard(): Promise<SubscriptionDashboard | null>;
  scanOutlookSubscriptions(): Promise<SubscriptionDashboard>;
  startOutlookBulkUnsubscribe(
    input: StartUnsubscribeInput,
  ): Promise<SubscriptionDashboard>;
  resumeOutlookBulkUnsubscribe(
    input: UnsubscribeJobInput,
  ): Promise<SubscriptionDashboard>;
  retryOutlookBulkUnsubscribe(
    input: RetryUnsubscribeInput,
  ): Promise<SubscriptionDashboard>;
  onOutlookUnsubscribeProgress(
    listener: (progress: UnsubscribeProgress) => void,
  ): () => void;
  getCleanupPlan(input: GetCleanupInput): Promise<CleanupPlan | null>;
  generateCleanupPlan(input: GenerateCleanupInput): Promise<CleanupPlan>;
  approveCleanupPlan(input: ApproveCleanupInput): Promise<CleanupProgress>;
  resumeCleanupPlan(input: ApproveCleanupInput): Promise<CleanupProgress>;
  retryCleanupPlan(input: RetryCleanupInput): Promise<CleanupProgress>;
  undoCleanupPlan(input: UndoCleanupInput): Promise<CleanupProgress>;
  onCleanupProgress(listener: (progress: CleanupProgress) => void): () => void;
  getSubscriptionDashboard(): Promise<SubscriptionDashboard | null>;
  scanSubscriptions(): Promise<SubscriptionDashboard>;
  startBulkUnsubscribe(
    input: StartUnsubscribeInput,
  ): Promise<UnsubscribeProgress>;
  resumeBulkUnsubscribe(
    input: UnsubscribeJobInput,
  ): Promise<UnsubscribeProgress>;
  retryBulkUnsubscribe(
    input: RetryUnsubscribeInput,
  ): Promise<UnsubscribeProgress>;
  onUnsubscribeProgress(
    listener: (progress: UnsubscribeProgress) => void,
  ): () => void;
  getDiagnostics(): Promise<DiagnosticsSummary>;
  exportDiagnostics(): Promise<DiagnosticsExportResult>;
  createEncryptedBackup(): Promise<BackupResult>;
  restoreEncryptedBackup(
    input: RestoreProfileInput,
  ): Promise<RestoreResult | null>;
  rebuildLocalIndex(input: RebuildIndexInput): Promise<RebuildIndexResult>;
}

declare global {
  interface Window {
    emailOrganizer: Readonly<EmailOrganizerBridge>;
  }
}
