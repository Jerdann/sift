import { shell, type IpcMain, type IpcMainInvokeEvent } from 'electron';
import { gmailConnectionSummarySchema, gmailDisconnectInputSchema, gmailOAuthInputSchema } from '../../shared/contracts/gmail';
import { IPC_CHANNELS } from '../../shared/ipc';
import { authorizeGmail, type OAuthFetch } from '../gmail/gmail-oauth';
import { GmailConnectionRepository } from '../gmail/gmail-connection-repository';
import { GmailAuditService } from '../gmail/gmail-audit-service';
import { GmailAnalysisService } from '../gmail/gmail-analysis-service';
import { mailboxAnalysisSummarySchema } from '../../shared/contracts/analysis';
import { approveGmailOrganizationInputSchema, generateGmailDeletionInputSchema, gmailOrganizationPlanSchema, retryGmailOrganizationInputSchema, undoGmailOrganizationInputSchema } from '../../shared/contracts/gmail-organize';
import { GmailOrganizationRepository } from '../gmail/gmail-organization-repository';
import { GmailOrganizationRunner } from '../gmail/gmail-organization-runner';
import { GmailSubscriptionService } from '../gmail/gmail-subscription-service';
import { retryUnsubscribeInputSchema, startUnsubscribeInputSchema, subscriptionDashboardSchema, unsubscribeJobInputSchema, unsubscribeProgressSchema } from '../../shared/contracts/unsubscribe';
import { ProfileSession } from '../profiles/profile-session';
import { assertTrustedIpcSender } from '../window-security';
import { JobRepository } from '../jobs/job-repository';
import { UnsubscribeRunner } from '../unsubscribe/unsubscribe-runner';

export const registerGmailHandlers = ({ ipcMain, profileSession, developmentServerUrl, fetchPort = fetch }: { ipcMain: IpcMain; profileSession: ProfileSession; developmentServerUrl?: string; fetchPort?: OAuthFetch }): (() => void) => {
  let gmailAuditRunning = false;
  let organizationProfileId: string | null = null;
  let organizationJobs: JobRepository | null = null;
  let organizationRepository: GmailOrganizationRepository | null = null;
  let subscriptionProfileId: string | null = null;
  let subscriptionService: GmailSubscriptionService | null = null;
  let subscriptionRunner: UnsubscribeRunner | null = null;
  const gmailUnsubscribeRunning = new Set<string>();
  const trust = (event: IpcMainInvokeEvent) => assertTrustedIpcSender(event.senderFrame?.url, developmentServerUrl);
  const repository = () => {
    const context = profileSession.requireActiveContext();
    return new GmailConnectionRepository(context.database, profileSession.requireSecretVault(), context.profile.id);
  };
  ipcMain.handle(IPC_CHANNELS.gmailGetConnection, (event) => {
    trust(event);
    return gmailConnectionSummarySchema.nullable().parse(repository().get());
  });
  ipcMain.handle(IPC_CHANNELS.gmailConnect, async (event, rawInput) => {
    trust(event);
    const input = gmailOAuthInputSchema.parse(rawInput);
    const grant = await authorizeGmail(input, (url) => shell.openExternal(url), fetchPort);
    const connection = repository().save(input, grant.email, grant.refreshToken);
    const context = profileSession.requireActiveContext();
    const providerCount = Number((context.database.prepare(`SELECT
      (SELECT COUNT(*) FROM gmail_connections WHERE profile_id = ?) +
      (SELECT COUNT(*) FROM provider_connections WHERE profile_id = ? AND provider = 'proton') AS count
    `).get(context.profile.id, context.profile.id) as { count: number }).count);
    profileSession.setActiveProviderCount(providerCount);
    return gmailConnectionSummarySchema.parse(connection);
  });
  ipcMain.handle(IPC_CHANNELS.gmailDisconnect, (event, rawInput) => {
    trust(event);
    const { connectionId } = gmailDisconnectInputSchema.parse(rawInput);
    repository().disconnect(connectionId);
    const context = profileSession.requireActiveContext();
    const providerCount = Number((context.database.prepare(`SELECT
      (SELECT COUNT(*) FROM gmail_connections WHERE profile_id = ?) +
      (SELECT COUNT(*) FROM provider_connections WHERE profile_id = ? AND provider = 'proton') AS count
    `).get(context.profile.id, context.profile.id) as { count: number }).count);
    profileSession.setActiveProviderCount(providerCount);
  });
  ipcMain.handle(IPC_CHANNELS.gmailAuditGet, (event) => {
    trust(event);
    const context = profileSession.requireActiveContext();
    return new GmailAuditService(context.database, repository(), { fetchPort }).get();
  });
  ipcMain.handle(IPC_CHANNELS.gmailAuditStart, async (event) => {
    trust(event);
    if (gmailAuditRunning) throw new Error('gmail_audit_active');
    const context = profileSession.requireActiveContext();
    const service = new GmailAuditService(context.database, repository(), { fetchPort });
    gmailAuditRunning = true;
    try { return await service.run((summary) => event.sender.send(IPC_CHANNELS.gmailAuditProgress, { profileId: context.profile.id, summary })); }
    finally { gmailAuditRunning = false; }
  });
  ipcMain.handle(IPC_CHANNELS.gmailAnalysisGet, (event) => {
    trust(event); const context = profileSession.requireActiveContext(); const connection = repository().get();
    return mailboxAnalysisSummarySchema.nullable().parse(connection ? new GmailAnalysisService(context.database, context.profile.id).get(connection) : null);
  });
  ipcMain.handle(IPC_CHANNELS.gmailAnalysisRun, (event) => {
    trust(event); const context = profileSession.requireActiveContext(); const connection = repository().get();
    if (!connection) throw new Error('gmail_not_connected');
    return mailboxAnalysisSummarySchema.parse(new GmailAnalysisService(context.database, context.profile.id).analyze(connection));
  });
  const organization = () => { const context=profileSession.requireActiveContext();if(organizationProfileId!==context.profile.id||!organizationJobs||!organizationRepository){organizationProfileId=context.profile.id;organizationJobs=new JobRepository(context.database);organizationJobs.recoverInterrupted();organizationRepository=new GmailOrganizationRepository(context.database,organizationJobs,context.profile.id);}return {context,jobs:organizationJobs,repository:organizationRepository,connection:repository()};};
  ipcMain.handle(IPC_CHANNELS.gmailOrganizeGet,(event)=>{trust(event);const current=organization();const connection=current.connection.get();return gmailOrganizationPlanSchema.nullable().parse(connection?current.repository.get(connection.id):null);});
  ipcMain.handle(IPC_CHANNELS.gmailOrganizeGenerate,(event)=>{trust(event);const current=organization();const connection=current.connection.get();if(!connection)throw new Error('gmail_not_connected');return gmailOrganizationPlanSchema.parse(current.repository.generate(connection));});
  ipcMain.handle(IPC_CHANNELS.gmailDeletionGet,(event)=>{trust(event);const current=organization();const connection=current.connection.get();return gmailOrganizationPlanSchema.nullable().parse(connection?current.repository.get(connection.id,'trash'):null);});
  ipcMain.handle(IPC_CHANNELS.gmailDeletionGenerate,(event,rawInput)=>{trust(event);const input=generateGmailDeletionInputSchema.parse(rawInput);const current=organization();const connection=current.connection.get();if(!connection)throw new Error('gmail_not_connected');return gmailOrganizationPlanSchema.parse(current.repository.generate(connection,{kind:'trash',...input}));});
  ipcMain.handle(IPC_CHANNELS.gmailOrganizeApprove,async(event,rawInput)=>{trust(event);const input=approveGmailOrganizationInputSchema.parse(rawInput);const current=organization();const connection=current.connection.get();if(!connection)throw new Error('gmail_not_connected');const plan=current.repository.approve(connection.id,input.planId,input.revision);if(!plan.job)throw new Error('gmail_history_job_missing');return gmailOrganizationPlanSchema.parse(await new GmailOrganizationRunner(current.connection,current.repository,current.jobs,fetchPort).run(plan.job.id,(progress)=>{if(!event.sender.isDestroyed())event.sender.send(IPC_CHANNELS.gmailOrganizeProgress,{profileId:current.context.profile.id,plan:progress});}));});
  ipcMain.handle(IPC_CHANNELS.gmailOrganizeRetry,async(event,rawInput)=>{trust(event);const input=retryGmailOrganizationInputSchema.parse(rawInput);const current=organization();const plan=current.repository.retry(input.planId,input.batchIds);if(!plan.job)throw new Error('gmail_history_job_missing');return gmailOrganizationPlanSchema.parse(await new GmailOrganizationRunner(current.connection,current.repository,current.jobs,fetchPort).run(plan.job.id,(progress)=>{if(!event.sender.isDestroyed())event.sender.send(IPC_CHANNELS.gmailOrganizeProgress,{profileId:current.context.profile.id,plan:progress});}));});
  ipcMain.handle(IPC_CHANNELS.gmailOrganizeUndo,async(event,rawInput)=>{trust(event);const input=undoGmailOrganizationInputSchema.parse(rawInput);const current=organization();const plan=current.repository.prepareUndo(input.planId);if(!plan.undoJob)throw new Error('gmail_history_undo_job_missing');return gmailOrganizationPlanSchema.parse(await new GmailOrganizationRunner(current.connection,current.repository,current.jobs,fetchPort).undo(plan.undoJob.id,(progress)=>{if(!event.sender.isDestroyed())event.sender.send(IPC_CHANNELS.gmailOrganizeProgress,{profileId:current.context.profile.id,plan:progress});}));});
  const gmailSubscriptions=()=>{const current=organization();if(subscriptionProfileId!==current.context.profile.id||!subscriptionService||!subscriptionRunner){subscriptionProfileId=current.context.profile.id;subscriptionService=new GmailSubscriptionService(current.context.database,current.jobs,current.context.profile.id);subscriptionRunner=new UnsubscribeRunner(current.jobs,subscriptionService);}return{context:current.context,jobs:current.jobs,service:subscriptionService,runner:subscriptionRunner,connection:current.connection.get()};};
  const runGmailUnsubscribe=(event:IpcMainInvokeEvent,jobId:string,current:ReturnType<typeof gmailSubscriptions>)=>{const unsubscribe=current.runner.subscribe((progress)=>{if(progress.dashboard.job?.id!==jobId)return;if(!event.sender.isDestroyed())event.sender.send(IPC_CHANNELS.gmailUnsubscribeProgress,unsubscribeProgressSchema.parse(progress));if(progress.dashboard.job&&['succeeded','failed','verification_mismatch'].includes(progress.dashboard.job.state)){unsubscribe();gmailUnsubscribeRunning.delete(jobId);}});if(!gmailUnsubscribeRunning.has(jobId)){gmailUnsubscribeRunning.add(jobId);void current.runner.run(jobId).catch(()=>{unsubscribe();gmailUnsubscribeRunning.delete(jobId);});}};
  ipcMain.handle(IPC_CHANNELS.gmailUnsubscribeGet,(event)=>{trust(event);const current=gmailSubscriptions();return subscriptionDashboardSchema.nullable().parse(current.connection?current.service.getCurrent(current.connection.id):null);});
  ipcMain.handle(IPC_CHANNELS.gmailUnsubscribeScan,(event)=>{trust(event);const current=gmailSubscriptions();if(!current.connection)throw new Error('gmail_not_connected');return subscriptionDashboardSchema.parse(current.service.scan(current.connection.id));});
  ipcMain.handle(IPC_CHANNELS.gmailUnsubscribeStart,(event,rawInput)=>{trust(event);const input=startUnsubscribeInputSchema.parse(rawInput);const current=gmailSubscriptions();if(!current.connection)throw new Error('gmail_not_connected');const dashboard=current.service.start(input.candidateIds);if(!dashboard.job)throw new Error('unsubscribe_job_missing');runGmailUnsubscribe(event,dashboard.job.id,current);return subscriptionDashboardSchema.parse(dashboard);});
  ipcMain.handle(IPC_CHANNELS.gmailUnsubscribeResume,(event,rawInput)=>{trust(event);const{jobId}=unsubscribeJobInputSchema.parse(rawInput);const current=gmailSubscriptions();const scanId=current.service.scanIdForJob(jobId);runGmailUnsubscribe(event,jobId,current);return subscriptionDashboardSchema.parse(current.service.getByScan(scanId));});
  ipcMain.handle(IPC_CHANNELS.gmailUnsubscribeRetry,(event,rawInput)=>{trust(event);const input=retryUnsubscribeInputSchema.parse(rawInput);const current=gmailSubscriptions();const dashboard=current.service.retry(input.jobId,input.candidateIds);runGmailUnsubscribe(event,input.jobId,current);return subscriptionDashboardSchema.parse(dashboard);});
  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.gmailGetConnection);
    ipcMain.removeHandler(IPC_CHANNELS.gmailConnect);
    ipcMain.removeHandler(IPC_CHANNELS.gmailDisconnect);
    ipcMain.removeHandler(IPC_CHANNELS.gmailAuditGet);
    ipcMain.removeHandler(IPC_CHANNELS.gmailAuditStart);
    ipcMain.removeHandler(IPC_CHANNELS.gmailAnalysisGet);
    ipcMain.removeHandler(IPC_CHANNELS.gmailAnalysisRun);
    ipcMain.removeHandler(IPC_CHANNELS.gmailOrganizeGet);
    ipcMain.removeHandler(IPC_CHANNELS.gmailOrganizeGenerate);
    ipcMain.removeHandler(IPC_CHANNELS.gmailOrganizeApprove);
    ipcMain.removeHandler(IPC_CHANNELS.gmailOrganizeRetry);
    ipcMain.removeHandler(IPC_CHANNELS.gmailOrganizeUndo);
    ipcMain.removeHandler(IPC_CHANNELS.gmailDeletionGet);
    ipcMain.removeHandler(IPC_CHANNELS.gmailDeletionGenerate);
    ipcMain.removeHandler(IPC_CHANNELS.gmailUnsubscribeGet);
    ipcMain.removeHandler(IPC_CHANNELS.gmailUnsubscribeScan);
    ipcMain.removeHandler(IPC_CHANNELS.gmailUnsubscribeStart);
    ipcMain.removeHandler(IPC_CHANNELS.gmailUnsubscribeResume);
    ipcMain.removeHandler(IPC_CHANNELS.gmailUnsubscribeRetry);
  };
};
