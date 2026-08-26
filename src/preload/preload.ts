import { contextBridge, ipcRenderer } from "electron";
import { z } from "zod";
import type { EmailOrganizerBridge } from "../shared/ipc";
import { IPC_CHANNELS } from "../shared/ipc";
import {
  type CreateProfileInput,
  type SelectProfileInput,
  createProfileInputSchema,
  profileSummarySchema,
  selectProfileInputSchema,
} from "../shared/contracts/profiles";
import {
  type GetJobInput,
  type StartSyntheticJobInput,
  getJobInputSchema,
  jobProgressSchema,
  startSyntheticJobInputSchema,
} from "../shared/contracts/jobs";
import type { JobProgress } from "../core/jobs/job-types";
import {
  type ProtonAuditJobInput,
  type ProtonAuditProgress,
  type StartProtonAuditInput,
  protonAuditJobInputSchema,
  protonAuditProgressSchema,
  startProtonAuditInputSchema,
} from "../shared/contracts/proton-audit";
import { mailboxAnalysisSummarySchema } from "../shared/contracts/analysis";
import {
  type ExportRulePackInput,
  exportRulePackInputSchema,
  exportRulePackResultSchema,
} from "../shared/contracts/rules";
import {
  type GmailAuditSummary,
  type GmailDisconnectInput,
  type GmailOAuthInput,
  gmailAuditSummarySchema,
  gmailConnectionSummarySchema,
  gmailDisconnectInputSchema,
  gmailOAuthInputSchema,
} from "../shared/contracts/gmail";
import {
  type ApproveGmailOrganizationInput,
  type GenerateGmailDeletionInput,
  type RetryGmailOrganizationInput,
  type UndoGmailOrganizationInput,
  approveGmailOrganizationInputSchema,
  generateGmailDeletionInputSchema,
  gmailOrganizationPlanSchema,
  retryGmailOrganizationInputSchema,
  undoGmailOrganizationInputSchema,
} from "../shared/contracts/gmail-organize";
import {
  type ApproveCleanupInput,
  type CleanupProgress,
  type GenerateCleanupInput,
  type GetCleanupInput,
  type RetryCleanupInput,
  type UndoCleanupInput,
  approveCleanupInputSchema,
  cleanupPlanSchema,
  cleanupProgressSchema,
  generateCleanupInputSchema,
  getCleanupInputSchema,
  retryCleanupInputSchema,
  undoCleanupInputSchema,
} from "../shared/contracts/cleanup";
import {
  type StartUnsubscribeInput,
  type RetryUnsubscribeInput,
  type UnsubscribeJobInput,
  type UnsubscribeProgress,
  startUnsubscribeInputSchema,
  retryUnsubscribeInputSchema,
  subscriptionDashboardSchema,
  unsubscribeJobInputSchema,
  unsubscribeProgressSchema,
} from "../shared/contracts/unsubscribe";
import {
  type BridgeCredentials,
  type ProtonDisconnectInput,
  bridgeConnectResultSchema,
  bridgeCredentialsSchema,
  bridgeDiagnosticSchema,
  protonConnectionSummarySchema,
  protonDiscoverySummarySchema,
  protonDisconnectInputSchema,
} from "../shared/contracts/proton";
import {
  type OutlookOAuthInput,
  type OutlookDisconnectInput,
  type OutlookAuditSummary,
  outlookOAuthInputSchema,
  outlookDisconnectInputSchema,
  outlookConnectionSummarySchema,
  outlookAuditSummarySchema,
} from "../shared/contracts/outlook";
import {
  type AccountIdentityListInput,
  type AccountIdentityUpdateInput,
  type AccountSelectionInput,
  accountIdentityListInputSchema,
  accountIdentitySummarySchema,
  accountIdentityUpdateInputSchema,
  accountSelectionInputSchema,
  mailAccountSummarySchema,
} from "../shared/contracts/accounts";
import {
  type EditOrganizationProposal,
  type OrganizationProposalScope,
  editOrganizationProposalSchema,
  organizationProposalSchema,
  organizationProposalScopeSchema,
} from "../shared/contracts/organization";
import {
  type ApproveRulePlan,
  type RetryRulePlan,
  type UndoRulePlan,
  type ExportProtonRulePlan,
  type RuleManagementScope,
  approveRulePlanSchema,
  retryRulePlanSchema,
  undoRulePlanSchema,
  exportProtonRulePlanSchema,
  protonRuleExportResultSchema,
  ruleInventorySchema,
  ruleManagementScopeSchema,
  ruleReconciliationPlanSchema,
} from "../shared/contracts/rule-management";
import {
  type RebuildIndexInput,
  type RestoreProfileInput,
  backupResultSchema,
  diagnosticsExportResultSchema,
  diagnosticsSummarySchema,
  rebuildIndexInputSchema,
  rebuildIndexResultSchema,
  restoreProfileInputSchema,
  restoreResultSchema,
} from "../shared/contracts/recovery";
import {
  type UpdateAppSettingsInput,
  appSettingsSchema,
  updateAppSettingsInputSchema,
} from "../shared/contracts/settings";

const bridge: Readonly<EmailOrganizerBridge> = Object.freeze({
  getVersion: async () =>
    z.string().parse(await ipcRenderer.invoke(IPC_CHANNELS.appGetVersion)),
  getAppSettings: async () =>
    appSettingsSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.appSettingsGet),
    ),
  updateAppSettings: async (input: UpdateAppSettingsInput) =>
    appSettingsSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.appSettingsUpdate,
        updateAppSettingsInputSchema.parse(input),
      ),
    ),
  listMailAccounts: async () =>
    z
      .array(mailAccountSummarySchema)
      .parse(await ipcRenderer.invoke(IPC_CHANNELS.accountsList)),
  selectMailAccount: async (input: AccountSelectionInput) =>
    mailAccountSummarySchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.accountsSelect,
        accountSelectionInputSchema.parse(input),
      ),
    ),
  listAccountIdentities: async (input: AccountIdentityListInput) =>
    z
      .array(accountIdentitySummarySchema)
      .parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.identitiesList,
          accountIdentityListInputSchema.parse(input),
        ),
      ),
  refreshAccountIdentities: async (input: AccountIdentityListInput) =>
    z
      .array(accountIdentitySummarySchema)
      .parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.identitiesRefresh,
          accountIdentityListInputSchema.parse(input),
        ),
      ),
  updateAccountIdentity: async (input: AccountIdentityUpdateInput) =>
    accountIdentitySummarySchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.identitiesUpdate,
        accountIdentityUpdateInputSchema.parse(input),
      ),
    ),
  getOrganizationProposal: async (input: OrganizationProposalScope) =>
    organizationProposalSchema
      .nullable()
      .parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.organizationProposalGet,
          organizationProposalScopeSchema.parse(input),
        ),
      ),
  generateOrganizationProposal: async (input: OrganizationProposalScope) =>
    organizationProposalSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.organizationProposalGenerate,
        organizationProposalScopeSchema.parse(input),
      ),
    ),
  editOrganizationProposal: async (input: EditOrganizationProposal) =>
    organizationProposalSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.organizationProposalEdit,
        editOrganizationProposalSchema.parse(input),
      ),
    ),
  getRuleInventory: async (input: RuleManagementScope) =>
    ruleInventorySchema
      .nullable()
      .parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.ruleInventoryGet,
          ruleManagementScopeSchema.parse(input),
        ),
      ),
  refreshRuleInventory: async (input: RuleManagementScope) =>
    ruleInventorySchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.ruleInventoryRefresh,
        ruleManagementScopeSchema.parse(input),
      ),
    ),
  getRulePlan: async (input: RuleManagementScope) =>
    ruleReconciliationPlanSchema
      .nullable()
      .parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.rulePlanGet,
          ruleManagementScopeSchema.parse(input),
        ),
      ),
  generateRulePlan: async (input: RuleManagementScope) =>
    ruleReconciliationPlanSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.rulePlanGenerate,
        ruleManagementScopeSchema.parse(input),
      ),
    ),
  approveRulePlan: async (input: ApproveRulePlan) =>
    ruleReconciliationPlanSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.rulePlanApprove,
        approveRulePlanSchema.parse(input),
      ),
    ),
  retryRulePlan: async (input: RetryRulePlan) =>
    ruleReconciliationPlanSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.rulePlanRetry,
        retryRulePlanSchema.parse(input),
      ),
    ),
  undoRulePlan: async (input: UndoRulePlan) =>
    ruleReconciliationPlanSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.rulePlanUndo,
        undoRulePlanSchema.parse(input),
      ),
    ),
  exportProtonRulePlan: async (input: ExportProtonRulePlan) =>
    protonRuleExportResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.rulePlanExportProton,
        exportProtonRulePlanSchema.parse(input),
      ),
    ),
  listProfiles: async () =>
    z
      .array(profileSummarySchema)
      .parse(await ipcRenderer.invoke(IPC_CHANNELS.profilesList)),
  createProfile: async (input: CreateProfileInput) =>
    profileSummarySchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.profilesCreate,
        createProfileInputSchema.parse(input),
      ),
    ),
  selectProfile: async (input: SelectProfileInput) =>
    profileSummarySchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.profilesSelect,
        selectProfileInputSchema.parse(input),
      ),
    ),
  startSyntheticJob: async (input: StartSyntheticJobInput) =>
    jobProgressSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.jobsStartSynthetic,
        startSyntheticJobInputSchema.parse(input),
      ),
    ),
  getJob: async (input: GetJobInput) =>
    jobProgressSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.jobsGet,
        getJobInputSchema.parse(input),
      ),
    ),
  resumeJob: async (input: GetJobInput) =>
    jobProgressSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.jobsResume,
        getJobInputSchema.parse(input),
      ),
    ),
  onJobProgress: (listener: (progress: JobProgress) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      listener(jobProgressSchema.parse(payload));
    };
    ipcRenderer.on(IPC_CHANNELS.jobsProgress, wrapped);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.jobsProgress, wrapped);
  },
  getProtonConnection: async () =>
    protonConnectionSummarySchema
      .nullable()
      .parse(await ipcRenderer.invoke(IPC_CHANNELS.protonGetConnection)),
  diagnoseProtonBridge: async (input: BridgeCredentials) =>
    bridgeDiagnosticSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.protonDiagnose,
        bridgeCredentialsSchema.parse(input),
      ),
    ),
  connectProtonBridge: async (input: BridgeCredentials) =>
    bridgeConnectResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.protonConnect,
        bridgeCredentialsSchema.parse(input),
      ),
    ),
  disconnectProtonBridge: async (input: ProtonDisconnectInput) => {
    await ipcRenderer.invoke(
      IPC_CHANNELS.protonDisconnect,
      protonDisconnectInputSchema.parse(input),
    );
  },
  discoverProtonMailbox: async () =>
    protonDiscoverySummarySchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.protonDiscover),
    ),
  getProtonDiscovery: async () =>
    protonDiscoverySummarySchema
      .nullable()
      .parse(await ipcRenderer.invoke(IPC_CHANNELS.protonGetDiscovery)),
  startProtonAudit: async (input: StartProtonAuditInput) =>
    protonAuditProgressSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.protonAuditStart,
        startProtonAuditInputSchema.parse(input),
      ),
    ),
  getCurrentProtonAudit: async () =>
    protonAuditProgressSchema
      .nullable()
      .parse(await ipcRenderer.invoke(IPC_CHANNELS.protonAuditGetCurrent)),
  resumeProtonAudit: async (input: ProtonAuditJobInput) =>
    protonAuditProgressSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.protonAuditResume,
        protonAuditJobInputSchema.parse(input),
      ),
    ),
  pauseProtonAudit: async (input: ProtonAuditJobInput) =>
    protonAuditProgressSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.protonAuditPause,
        protonAuditJobInputSchema.parse(input),
      ),
    ),
  onProtonAuditProgress: (
    listener: (progress: ProtonAuditProgress) => void,
  ) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      listener(protonAuditProgressSchema.parse(payload));
    };
    ipcRenderer.on(IPC_CHANNELS.protonAuditProgress, wrapped);
    return () =>
      ipcRenderer.removeListener(IPC_CHANNELS.protonAuditProgress, wrapped);
  },
  getMailboxAnalysis: async () =>
    mailboxAnalysisSummarySchema
      .nullable()
      .parse(await ipcRenderer.invoke(IPC_CHANNELS.analysisGet)),
  analyzeMailbox: async () =>
    mailboxAnalysisSummarySchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.analysisRun),
    ),
  exportRulePack: async (input: ExportRulePackInput) =>
    exportRulePackResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.rulesExport,
        exportRulePackInputSchema.parse(input),
      ),
    ),
  getGmailConnection: async () =>
    gmailConnectionSummarySchema
      .nullable()
      .parse(await ipcRenderer.invoke(IPC_CHANNELS.gmailGetConnection)),
  connectGmail: async (input: GmailOAuthInput) =>
    gmailConnectionSummarySchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.gmailConnect,
        gmailOAuthInputSchema.parse(input),
      ),
    ),
  disconnectGmail: async (input: GmailDisconnectInput) => {
    await ipcRenderer.invoke(
      IPC_CHANNELS.gmailDisconnect,
      gmailDisconnectInputSchema.parse(input),
    );
  },
  getGmailAudit: async () =>
    gmailAuditSummarySchema
      .nullable()
      .parse(await ipcRenderer.invoke(IPC_CHANNELS.gmailAuditGet)),
  startGmailAudit: async () =>
    gmailAuditSummarySchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.gmailAuditStart),
    ),
  onGmailAuditProgress: (
    listener: (progress: {
      profileId: string;
      summary: GmailAuditSummary;
    }) => void,
  ) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      const parsed = z
        .object({ profileId: z.uuid(), summary: gmailAuditSummarySchema })
        .parse(payload);
      listener(parsed);
    };
    ipcRenderer.on(IPC_CHANNELS.gmailAuditProgress, wrapped);
    return () =>
      ipcRenderer.removeListener(IPC_CHANNELS.gmailAuditProgress, wrapped);
  },
  getGmailAnalysis: async () =>
    mailboxAnalysisSummarySchema
      .nullable()
      .parse(await ipcRenderer.invoke(IPC_CHANNELS.gmailAnalysisGet)),
  analyzeGmail: async () =>
    mailboxAnalysisSummarySchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.gmailAnalysisRun),
    ),
  getGmailOrganizationPlan: async () =>
    gmailOrganizationPlanSchema
      .nullable()
      .parse(await ipcRenderer.invoke(IPC_CHANNELS.gmailOrganizeGet)),
  generateGmailOrganizationPlan: async () =>
    gmailOrganizationPlanSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.gmailOrganizeGenerate),
    ),
  approveGmailOrganizationPlan: async (input: ApproveGmailOrganizationInput) =>
    gmailOrganizationPlanSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.gmailOrganizeApprove,
        approveGmailOrganizationInputSchema.parse(input),
      ),
    ),
  retryGmailOrganizationPlan: async (input: RetryGmailOrganizationInput) =>
    gmailOrganizationPlanSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.gmailOrganizeRetry,
        retryGmailOrganizationInputSchema.parse(input),
      ),
    ),
  undoGmailOrganizationPlan: async (input: UndoGmailOrganizationInput) =>
    gmailOrganizationPlanSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.gmailOrganizeUndo,
        undoGmailOrganizationInputSchema.parse(input),
      ),
    ),
  onGmailOrganizationProgress: (
    listener: (progress: {
      profileId: string;
      plan: import("../shared/contracts/gmail-organize").GmailOrganizationPlan;
    }) => void,
  ) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) =>
      listener(
        z
          .object({ profileId: z.uuid(), plan: gmailOrganizationPlanSchema })
          .parse(payload),
      );
    ipcRenderer.on(IPC_CHANNELS.gmailOrganizeProgress, wrapped);
    return () =>
      ipcRenderer.removeListener(IPC_CHANNELS.gmailOrganizeProgress, wrapped);
  },
  getGmailDeletionPlan: async () =>
    gmailOrganizationPlanSchema
      .nullable()
      .parse(await ipcRenderer.invoke(IPC_CHANNELS.gmailDeletionGet)),
  generateGmailDeletionPlan: async (input: GenerateGmailDeletionInput) =>
    gmailOrganizationPlanSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.gmailDeletionGenerate,
        generateGmailDeletionInputSchema.parse(input),
      ),
    ),
  getGmailSubscriptionDashboard: async () =>
    subscriptionDashboardSchema
      .nullable()
      .parse(await ipcRenderer.invoke(IPC_CHANNELS.gmailUnsubscribeGet)),
  scanGmailSubscriptions: async () =>
    subscriptionDashboardSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.gmailUnsubscribeScan),
    ),
  startGmailBulkUnsubscribe: async (input: StartUnsubscribeInput) =>
    subscriptionDashboardSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.gmailUnsubscribeStart,
        startUnsubscribeInputSchema.parse(input),
      ),
    ),
  resumeGmailBulkUnsubscribe: async (input: UnsubscribeJobInput) =>
    subscriptionDashboardSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.gmailUnsubscribeResume,
        unsubscribeJobInputSchema.parse(input),
      ),
    ),
  retryGmailBulkUnsubscribe: async (input: RetryUnsubscribeInput) =>
    subscriptionDashboardSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.gmailUnsubscribeRetry,
        retryUnsubscribeInputSchema.parse(input),
      ),
    ),
  onGmailUnsubscribeProgress: (
    listener: (progress: UnsubscribeProgress) => void,
  ) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) =>
      listener(unsubscribeProgressSchema.parse(payload));
    ipcRenderer.on(IPC_CHANNELS.gmailUnsubscribeProgress, wrapped);
    return () =>
      ipcRenderer.removeListener(
        IPC_CHANNELS.gmailUnsubscribeProgress,
        wrapped,
      );
  },
  getOutlookConnection: async () =>
    outlookConnectionSummarySchema
      .nullable()
      .parse(await ipcRenderer.invoke(IPC_CHANNELS.outlookGetConnection)),
  connectOutlook: async (input: OutlookOAuthInput) =>
    outlookConnectionSummarySchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.outlookConnect,
        outlookOAuthInputSchema.parse(input),
      ),
    ),
  disconnectOutlook: async (input: OutlookDisconnectInput) => {
    await ipcRenderer.invoke(
      IPC_CHANNELS.outlookDisconnect,
      outlookDisconnectInputSchema.parse(input),
    );
  },
  getOutlookAudit: async () =>
    outlookAuditSummarySchema
      .nullable()
      .parse(await ipcRenderer.invoke(IPC_CHANNELS.outlookAuditGet)),
  startOutlookAudit: async () =>
    outlookAuditSummarySchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.outlookAuditStart),
    ),
  onOutlookAuditProgress: (
    listener: (progress: {
      profileId: string;
      summary: OutlookAuditSummary;
    }) => void,
  ) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) =>
      listener(
        z
          .object({ profileId: z.uuid(), summary: outlookAuditSummarySchema })
          .parse(payload),
      );
    ipcRenderer.on(IPC_CHANNELS.outlookAuditProgress, wrapped);
    return () =>
      ipcRenderer.removeListener(IPC_CHANNELS.outlookAuditProgress, wrapped);
  },
  getOutlookAnalysis: async () =>
    mailboxAnalysisSummarySchema
      .nullable()
      .parse(await ipcRenderer.invoke(IPC_CHANNELS.outlookAnalysisGet)),
  analyzeOutlook: async () =>
    mailboxAnalysisSummarySchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.outlookAnalysisRun),
    ),
  getOutlookOrganizationPlan: async () =>
    gmailOrganizationPlanSchema
      .nullable()
      .parse(await ipcRenderer.invoke(IPC_CHANNELS.outlookOrganizeGet)),
  generateOutlookOrganizationPlan: async () =>
    gmailOrganizationPlanSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.outlookOrganizeGenerate),
    ),
  approveOutlookOrganizationPlan: async (
    input: ApproveGmailOrganizationInput,
  ) =>
    gmailOrganizationPlanSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.outlookOrganizeApprove,
        approveGmailOrganizationInputSchema.parse(input),
      ),
    ),
  retryOutlookOrganizationPlan: async (input: RetryGmailOrganizationInput) =>
    gmailOrganizationPlanSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.outlookOrganizeRetry,
        retryGmailOrganizationInputSchema.parse(input),
      ),
    ),
  undoOutlookOrganizationPlan: async (input: UndoGmailOrganizationInput) =>
    gmailOrganizationPlanSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.outlookOrganizeUndo,
        undoGmailOrganizationInputSchema.parse(input),
      ),
    ),
  onOutlookOrganizationProgress: (
    listener: (progress: {
      profileId: string;
      plan: import("../shared/contracts/gmail-organize").GmailOrganizationPlan;
    }) => void,
  ) => {
    const schema = z.object({
      profileId: z.uuid(),
      plan: gmailOrganizationPlanSchema,
    });
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) =>
      listener(schema.parse(payload));
    ipcRenderer.on(IPC_CHANNELS.outlookOrganizeProgress, wrapped);
    return () =>
      ipcRenderer.removeListener(IPC_CHANNELS.outlookOrganizeProgress, wrapped);
  },
  getOutlookDeletionPlan: async () =>
    gmailOrganizationPlanSchema
      .nullable()
      .parse(await ipcRenderer.invoke(IPC_CHANNELS.outlookDeletionGet)),
  generateOutlookDeletionPlan: async (input: GenerateGmailDeletionInput) =>
    gmailOrganizationPlanSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.outlookDeletionGenerate,
        generateGmailDeletionInputSchema.parse(input),
      ),
    ),
  getOutlookSubscriptionDashboard: async () =>
    subscriptionDashboardSchema
      .nullable()
      .parse(await ipcRenderer.invoke(IPC_CHANNELS.outlookUnsubscribeGet)),
  scanOutlookSubscriptions: async () =>
    subscriptionDashboardSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.outlookUnsubscribeScan),
    ),
  startOutlookBulkUnsubscribe: async (input: StartUnsubscribeInput) =>
    subscriptionDashboardSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.outlookUnsubscribeStart,
        startUnsubscribeInputSchema.parse(input),
      ),
    ),
  resumeOutlookBulkUnsubscribe: async (input: UnsubscribeJobInput) =>
    subscriptionDashboardSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.outlookUnsubscribeResume,
        unsubscribeJobInputSchema.parse(input),
      ),
    ),
  retryOutlookBulkUnsubscribe: async (input: RetryUnsubscribeInput) =>
    subscriptionDashboardSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.outlookUnsubscribeRetry,
        retryUnsubscribeInputSchema.parse(input),
      ),
    ),
  onOutlookUnsubscribeProgress: (
    listener: (progress: UnsubscribeProgress) => void,
  ) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) =>
      listener(unsubscribeProgressSchema.parse(payload));
    ipcRenderer.on(IPC_CHANNELS.outlookUnsubscribeProgress, wrapped);
    return () =>
      ipcRenderer.removeListener(
        IPC_CHANNELS.outlookUnsubscribeProgress,
        wrapped,
      );
  },
  getCleanupPlan: async (input: GetCleanupInput) =>
    cleanupPlanSchema
      .nullable()
      .parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.cleanupGet,
          getCleanupInputSchema.parse(input),
        ),
      ),
  generateCleanupPlan: async (input: GenerateCleanupInput) =>
    cleanupPlanSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.cleanupGenerate,
        generateCleanupInputSchema.parse(input),
      ),
    ),
  approveCleanupPlan: async (input: ApproveCleanupInput) =>
    cleanupProgressSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.cleanupApprove,
        approveCleanupInputSchema.parse(input),
      ),
    ),
  resumeCleanupPlan: async (input: ApproveCleanupInput) =>
    cleanupProgressSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.cleanupResume,
        approveCleanupInputSchema.parse(input),
      ),
    ),
  retryCleanupPlan: async (input: RetryCleanupInput) =>
    cleanupProgressSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.cleanupRetry,
        retryCleanupInputSchema.parse(input),
      ),
    ),
  undoCleanupPlan: async (input: UndoCleanupInput) =>
    cleanupProgressSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.cleanupUndo,
        undoCleanupInputSchema.parse(input),
      ),
    ),
  onCleanupProgress: (listener: (progress: CleanupProgress) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) =>
      listener(cleanupProgressSchema.parse(payload));
    ipcRenderer.on(IPC_CHANNELS.cleanupProgress, wrapped);
    return () =>
      ipcRenderer.removeListener(IPC_CHANNELS.cleanupProgress, wrapped);
  },
  getSubscriptionDashboard: async () =>
    subscriptionDashboardSchema
      .nullable()
      .parse(await ipcRenderer.invoke(IPC_CHANNELS.unsubscribeGet)),
  scanSubscriptions: async () =>
    subscriptionDashboardSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.unsubscribeScan),
    ),
  startBulkUnsubscribe: async (input: StartUnsubscribeInput) =>
    unsubscribeProgressSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.unsubscribeStart,
        startUnsubscribeInputSchema.parse(input),
      ),
    ),
  resumeBulkUnsubscribe: async (input: UnsubscribeJobInput) =>
    unsubscribeProgressSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.unsubscribeResume,
        unsubscribeJobInputSchema.parse(input),
      ),
    ),
  retryBulkUnsubscribe: async (input: RetryUnsubscribeInput) =>
    unsubscribeProgressSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.unsubscribeRetry,
        retryUnsubscribeInputSchema.parse(input),
      ),
    ),
  onUnsubscribeProgress: (
    listener: (progress: UnsubscribeProgress) => void,
  ) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) =>
      listener(unsubscribeProgressSchema.parse(payload));
    ipcRenderer.on(IPC_CHANNELS.unsubscribeProgress, wrapped);
    return () =>
      ipcRenderer.removeListener(IPC_CHANNELS.unsubscribeProgress, wrapped);
  },
  getDiagnostics: async () =>
    diagnosticsSummarySchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.recoveryDiagnosticsGet),
    ),
  exportDiagnostics: async () =>
    diagnosticsExportResultSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.recoveryDiagnosticsExport),
    ),
  createEncryptedBackup: async () =>
    backupResultSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.recoveryBackupCreate),
    ),
  restoreEncryptedBackup: async (input: RestoreProfileInput) =>
    restoreResultSchema
      .nullable()
      .parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.recoveryBackupRestore,
          restoreProfileInputSchema.parse(input),
        ),
      ),
  rebuildLocalIndex: async (input: RebuildIndexInput) =>
    rebuildIndexResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.recoveryIndexRebuild,
        rebuildIndexInputSchema.parse(input),
      ),
    ),
});

contextBridge.exposeInMainWorld("emailOrganizer", bridge);
