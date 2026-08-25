import { shell, type IpcMain, type IpcMainInvokeEvent } from 'electron';
import { gmailConnectionSummarySchema, gmailDisconnectInputSchema, gmailOAuthInputSchema } from '../../shared/contracts/gmail';
import { IPC_CHANNELS } from '../../shared/ipc';
import { authorizeGmail, type OAuthFetch } from '../gmail/gmail-oauth';
import { GmailConnectionRepository } from '../gmail/gmail-connection-repository';
import { GmailAuditService } from '../gmail/gmail-audit-service';
import { GmailAnalysisService } from '../gmail/gmail-analysis-service';
import { mailboxAnalysisSummarySchema } from '../../shared/contracts/analysis';
import { approveGmailOrganizationInputSchema, gmailOrganizationPlanSchema } from '../../shared/contracts/gmail-organize';
import { GmailOrganizationRepository } from '../gmail/gmail-organization-repository';
import { GmailOrganizationRunner } from '../gmail/gmail-organization-runner';
import { GmailSubscriptionService } from '../gmail/gmail-subscription-service';
import { startUnsubscribeInputSchema, subscriptionDashboardSchema } from '../../shared/contracts/unsubscribe';
import { ProfileSession } from '../profiles/profile-session';
import { assertTrustedIpcSender } from '../window-security';

export const registerGmailHandlers = ({ ipcMain, profileSession, developmentServerUrl, fetchPort = fetch }: { ipcMain: IpcMain; profileSession: ProfileSession; developmentServerUrl?: string; fetchPort?: OAuthFetch }): (() => void) => {
  let gmailAuditRunning = false;
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
    const protonCount = Number((context.database.prepare("SELECT COUNT(*) AS count FROM provider_connections WHERE profile_id = ? AND provider = 'proton'").get(context.profile.id) as { count: number }).count);
    profileSession.setActiveProviderCount(protonCount + 1);
    return gmailConnectionSummarySchema.parse(connection);
  });
  ipcMain.handle(IPC_CHANNELS.gmailDisconnect, (event, rawInput) => {
    trust(event);
    const { connectionId } = gmailDisconnectInputSchema.parse(rawInput);
    repository().disconnect(connectionId);
    const context = profileSession.requireActiveContext();
    const protonCount = Number((context.database.prepare("SELECT COUNT(*) AS count FROM provider_connections WHERE profile_id = ? AND provider = 'proton'").get(context.profile.id) as { count: number }).count);
    profileSession.setActiveProviderCount(protonCount);
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
  const organization = () => { const context=profileSession.requireActiveContext(); const analysis=new GmailAnalysisService(context.database,context.profile.id); return { context, repository:new GmailOrganizationRepository(context.database,analysis,context.profile.id), connection:repository() }; };
  ipcMain.handle(IPC_CHANNELS.gmailOrganizeGet,(event)=>{trust(event);const current=organization();const connection=current.connection.get();if(connection)current.repository.recoverInterrupted(connection.id);return gmailOrganizationPlanSchema.nullable().parse(connection?current.repository.get(connection.id):null);});
  ipcMain.handle(IPC_CHANNELS.gmailOrganizeGenerate,(event)=>{trust(event);const current=organization();const connection=current.connection.get();if(!connection)throw new Error('gmail_not_connected');return gmailOrganizationPlanSchema.parse(current.repository.generate(connection));});
  ipcMain.handle(IPC_CHANNELS.gmailOrganizeApprove,async(event,rawInput)=>{trust(event);const input=approveGmailOrganizationInputSchema.parse(rawInput);const current=organization();const connection=current.connection.get();if(!connection)throw new Error('gmail_not_connected');current.repository.approve(connection.id,input.planId,input.revision);await new GmailOrganizationRunner(current.connection,current.repository,fetchPort).run(input.planId);return gmailOrganizationPlanSchema.parse(current.repository.get(connection.id));});
  const gmailSubscriptions=()=>{const context=profileSession.requireActiveContext();return{context,service:new GmailSubscriptionService(context.database,context.profile.id),connection:repository().get()};};
  ipcMain.handle(IPC_CHANNELS.gmailUnsubscribeGet,(event)=>{trust(event);const current=gmailSubscriptions();return subscriptionDashboardSchema.nullable().parse(current.connection?current.service.getCurrent(current.connection.id):null);});
  ipcMain.handle(IPC_CHANNELS.gmailUnsubscribeScan,(event)=>{trust(event);const current=gmailSubscriptions();if(!current.connection)throw new Error('gmail_not_connected');return subscriptionDashboardSchema.parse(current.service.scan(current.connection.id));});
  ipcMain.handle(IPC_CHANNELS.gmailUnsubscribeStart,async(event,rawInput)=>{trust(event);const input=startUnsubscribeInputSchema.parse(rawInput);const current=gmailSubscriptions();if(!current.connection)throw new Error('gmail_not_connected');return subscriptionDashboardSchema.parse(await current.service.start(input.candidateIds));});
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
    ipcMain.removeHandler(IPC_CHANNELS.gmailUnsubscribeGet);
    ipcMain.removeHandler(IPC_CHANNELS.gmailUnsubscribeScan);
    ipcMain.removeHandler(IPC_CHANNELS.gmailUnsubscribeStart);
  };
};
