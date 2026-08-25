import { contextBridge, ipcRenderer } from 'electron';
import { z } from 'zod';
import type { EmailOrganizerBridge } from '../shared/ipc';
import { IPC_CHANNELS } from '../shared/ipc';
import {
  type CreateProfileInput,
  type SelectProfileInput,
  createProfileInputSchema,
  profileSummarySchema,
  selectProfileInputSchema,
} from '../shared/contracts/profiles';
import {
  type GetJobInput,
  type StartSyntheticJobInput,
  getJobInputSchema,
  jobProgressSchema,
  startSyntheticJobInputSchema,
} from '../shared/contracts/jobs';
import type { JobProgress } from '../core/jobs/job-types';
import {
  type ProtonAuditJobInput,
  type ProtonAuditProgress,
  type StartProtonAuditInput,
  protonAuditJobInputSchema,
  protonAuditProgressSchema,
  startProtonAuditInputSchema,
} from '../shared/contracts/proton-audit';
import { mailboxAnalysisSummarySchema } from '../shared/contracts/analysis';
import { type ExportRulePackInput, exportRulePackInputSchema, exportRulePackResultSchema } from '../shared/contracts/rules';
import { type GmailAuditSummary, type GmailDisconnectInput, type GmailOAuthInput, gmailAuditSummarySchema, gmailConnectionSummarySchema, gmailDisconnectInputSchema, gmailOAuthInputSchema } from '../shared/contracts/gmail';
import { type ApproveGmailOrganizationInput, approveGmailOrganizationInputSchema, gmailOrganizationPlanSchema } from '../shared/contracts/gmail-organize';
import {
  type ApproveCleanupInput,
  type CleanupProgress,
  type GenerateCleanupInput,
  type GetCleanupInput,
  approveCleanupInputSchema,
  cleanupPlanSchema,
  cleanupProgressSchema,
  generateCleanupInputSchema,
  getCleanupInputSchema,
} from '../shared/contracts/cleanup';
import {
  type StartUnsubscribeInput,
  type UnsubscribeJobInput,
  type UnsubscribeProgress,
  startUnsubscribeInputSchema,
  subscriptionDashboardSchema,
  unsubscribeJobInputSchema,
  unsubscribeProgressSchema,
} from '../shared/contracts/unsubscribe';
import {
  type BridgeCredentials,
  type ProtonDisconnectInput,
  bridgeConnectResultSchema,
  bridgeCredentialsSchema,
  bridgeDiagnosticSchema,
  protonConnectionSummarySchema,
  protonDiscoverySummarySchema,
  protonDisconnectInputSchema,
} from '../shared/contracts/proton';
import {
  type AccountIdentityListInput,
  type AccountIdentityUpdateInput,
  type AccountSelectionInput,
  accountIdentityListInputSchema,
  accountIdentitySummarySchema,
  accountIdentityUpdateInputSchema,
  accountSelectionInputSchema,
  mailAccountSummarySchema,
} from '../shared/contracts/accounts';

const bridge: Readonly<EmailOrganizerBridge> = Object.freeze({
  getVersion: async () =>
    z.string().parse(await ipcRenderer.invoke(IPC_CHANNELS.appGetVersion)),
  listMailAccounts: async () =>
    z.array(mailAccountSummarySchema).parse(await ipcRenderer.invoke(IPC_CHANNELS.accountsList)),
  selectMailAccount: async (input: AccountSelectionInput) =>
    mailAccountSummarySchema.parse(await ipcRenderer.invoke(
      IPC_CHANNELS.accountsSelect,
      accountSelectionInputSchema.parse(input),
    )),
  listAccountIdentities: async (input: AccountIdentityListInput) =>
    z.array(accountIdentitySummarySchema).parse(await ipcRenderer.invoke(
      IPC_CHANNELS.identitiesList,
      accountIdentityListInputSchema.parse(input),
    )),
  refreshAccountIdentities: async (input: AccountIdentityListInput) =>
    z.array(accountIdentitySummarySchema).parse(await ipcRenderer.invoke(
      IPC_CHANNELS.identitiesRefresh,
      accountIdentityListInputSchema.parse(input),
    )),
  updateAccountIdentity: async (input: AccountIdentityUpdateInput) =>
    accountIdentitySummarySchema.parse(await ipcRenderer.invoke(
      IPC_CHANNELS.identitiesUpdate,
      accountIdentityUpdateInputSchema.parse(input),
    )),
  listProfiles: async () =>
    z.array(profileSummarySchema).parse(
      await ipcRenderer.invoke(IPC_CHANNELS.profilesList),
    ),
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
    protonConnectionSummarySchema.nullable().parse(
      await ipcRenderer.invoke(IPC_CHANNELS.protonGetConnection),
    ),
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
    protonDiscoverySummarySchema.nullable().parse(
      await ipcRenderer.invoke(IPC_CHANNELS.protonGetDiscovery),
    ),
  startProtonAudit: async (input: StartProtonAuditInput) =>
    protonAuditProgressSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.protonAuditStart, startProtonAuditInputSchema.parse(input)),
    ),
  getCurrentProtonAudit: async () =>
    protonAuditProgressSchema.nullable().parse(
      await ipcRenderer.invoke(IPC_CHANNELS.protonAuditGetCurrent),
    ),
  resumeProtonAudit: async (input: ProtonAuditJobInput) =>
    protonAuditProgressSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.protonAuditResume, protonAuditJobInputSchema.parse(input)),
    ),
  pauseProtonAudit: async (input: ProtonAuditJobInput) =>
    protonAuditProgressSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.protonAuditPause, protonAuditJobInputSchema.parse(input)),
    ),
  onProtonAuditProgress: (listener: (progress: ProtonAuditProgress) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      listener(protonAuditProgressSchema.parse(payload));
    };
    ipcRenderer.on(IPC_CHANNELS.protonAuditProgress, wrapped);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.protonAuditProgress, wrapped);
  },
  getMailboxAnalysis: async () =>
    mailboxAnalysisSummarySchema.nullable().parse(
      await ipcRenderer.invoke(IPC_CHANNELS.analysisGet),
    ),
  analyzeMailbox: async () =>
    mailboxAnalysisSummarySchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.analysisRun),
    ),
  exportRulePack: async (input: ExportRulePackInput) =>
    exportRulePackResultSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.rulesExport, exportRulePackInputSchema.parse(input)),
    ),
  getGmailConnection: async () =>
    gmailConnectionSummarySchema.nullable().parse(await ipcRenderer.invoke(IPC_CHANNELS.gmailGetConnection)),
  connectGmail: async (input: GmailOAuthInput) =>
    gmailConnectionSummarySchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.gmailConnect, gmailOAuthInputSchema.parse(input))),
  disconnectGmail: async (input: GmailDisconnectInput) => {
    await ipcRenderer.invoke(IPC_CHANNELS.gmailDisconnect, gmailDisconnectInputSchema.parse(input));
  },
  getGmailAudit: async () => gmailAuditSummarySchema.nullable().parse(await ipcRenderer.invoke(IPC_CHANNELS.gmailAuditGet)),
  startGmailAudit: async () => gmailAuditSummarySchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.gmailAuditStart)),
  onGmailAuditProgress: (listener: (progress: { profileId: string; summary: GmailAuditSummary }) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      const parsed = z.object({ profileId: z.uuid(), summary: gmailAuditSummarySchema }).parse(payload);
      listener(parsed);
    };
    ipcRenderer.on(IPC_CHANNELS.gmailAuditProgress, wrapped);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.gmailAuditProgress, wrapped);
  },
  getGmailAnalysis: async () => mailboxAnalysisSummarySchema.nullable().parse(await ipcRenderer.invoke(IPC_CHANNELS.gmailAnalysisGet)),
  analyzeGmail: async () => mailboxAnalysisSummarySchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.gmailAnalysisRun)),
  getGmailOrganizationPlan: async () => gmailOrganizationPlanSchema.nullable().parse(await ipcRenderer.invoke(IPC_CHANNELS.gmailOrganizeGet)),
  generateGmailOrganizationPlan: async () => gmailOrganizationPlanSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.gmailOrganizeGenerate)),
  approveGmailOrganizationPlan: async (input: ApproveGmailOrganizationInput) => gmailOrganizationPlanSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.gmailOrganizeApprove, approveGmailOrganizationInputSchema.parse(input))),
  getGmailSubscriptionDashboard: async () => subscriptionDashboardSchema.nullable().parse(await ipcRenderer.invoke(IPC_CHANNELS.gmailUnsubscribeGet)),
  scanGmailSubscriptions: async () => subscriptionDashboardSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.gmailUnsubscribeScan)),
  startGmailBulkUnsubscribe: async (input: StartUnsubscribeInput) => subscriptionDashboardSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.gmailUnsubscribeStart, startUnsubscribeInputSchema.parse(input))),
  getCleanupPlan: async (input: GetCleanupInput) =>
    cleanupPlanSchema.nullable().parse(await ipcRenderer.invoke(IPC_CHANNELS.cleanupGet, getCleanupInputSchema.parse(input))),
  generateCleanupPlan: async (input: GenerateCleanupInput) =>
    cleanupPlanSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.cleanupGenerate, generateCleanupInputSchema.parse(input))),
  approveCleanupPlan: async (input: ApproveCleanupInput) =>
    cleanupProgressSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.cleanupApprove, approveCleanupInputSchema.parse(input))),
  resumeCleanupPlan: async (input: ApproveCleanupInput) =>
    cleanupProgressSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.cleanupResume, approveCleanupInputSchema.parse(input))),
  onCleanupProgress: (listener: (progress: CleanupProgress) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(cleanupProgressSchema.parse(payload));
    ipcRenderer.on(IPC_CHANNELS.cleanupProgress, wrapped);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.cleanupProgress, wrapped);
  },
  getSubscriptionDashboard: async () =>
    subscriptionDashboardSchema.nullable().parse(await ipcRenderer.invoke(IPC_CHANNELS.unsubscribeGet)),
  scanSubscriptions: async () =>
    subscriptionDashboardSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.unsubscribeScan)),
  startBulkUnsubscribe: async (input: StartUnsubscribeInput) =>
    unsubscribeProgressSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.unsubscribeStart, startUnsubscribeInputSchema.parse(input))),
  resumeBulkUnsubscribe: async (input: UnsubscribeJobInput) =>
    unsubscribeProgressSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.unsubscribeResume, unsubscribeJobInputSchema.parse(input))),
  onUnsubscribeProgress: (listener: (progress: UnsubscribeProgress) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(unsubscribeProgressSchema.parse(payload));
    ipcRenderer.on(IPC_CHANNELS.unsubscribeProgress, wrapped);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.unsubscribeProgress, wrapped);
  },
});

contextBridge.exposeInMainWorld('emailOrganizer', bridge);
