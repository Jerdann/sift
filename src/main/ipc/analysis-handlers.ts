import { dialog, type IpcMain, type IpcMainInvokeEvent } from 'electron';
import { writeFile } from 'node:fs/promises';
import { mailboxAnalysisSummarySchema } from '../../shared/contracts/analysis';
import { exportRulePackInputSchema, exportRulePackResultSchema } from '../../shared/contracts/rules';
import { IPC_CHANNELS } from '../../shared/ipc';
import { buildPortableRulePack, renderProtonSieve } from '../../core/rules/rule-pack';
import { GmailConnectionRepository } from '../gmail/gmail-connection-repository';
import { GmailAnalysisService } from '../gmail/gmail-analysis-service';
import { MailboxAnalysisRepository } from '../analysis/mailbox-analysis-repository';
import { analyzeMailbox } from '../analysis/mailbox-analysis-service';
import { ProfileSession } from '../profiles/profile-session';
import { ProtonConnectionRepository } from '../proton/proton-connection-repository';
import { assertTrustedIpcSender } from '../window-security';

export const registerAnalysisHandlers = ({
  ipcMain,
  profileSession,
  developmentServerUrl,
}: {
  ipcMain: IpcMain;
  profileSession: ProfileSession;
  developmentServerUrl?: string;
}): (() => void) => {
  const trust = (event: IpcMainInvokeEvent) =>
    assertTrustedIpcSender(event.senderFrame?.url, developmentServerUrl);
  const services = () => {
    const context = profileSession.requireActiveContext();
    const connection = new ProtonConnectionRepository(
      context.database,
      profileSession.requireSecretVault(),
      context.profile.id,
    ).get();
    if (!connection) throw new Error('proton_not_connected');
    return {
      context,
      connection,
      repository: new MailboxAnalysisRepository(context.database, context.profile.id),
    };
  };

  ipcMain.handle(IPC_CHANNELS.analysisGet, (event) => {
    trust(event);
    const context = profileSession.requireActiveContext();
    const connection = new ProtonConnectionRepository(
      context.database,
      profileSession.requireSecretVault(),
      context.profile.id,
    ).get();
    if (!connection) return null;
    const repository = new MailboxAnalysisRepository(context.database, context.profile.id);
    return mailboxAnalysisSummarySchema.nullable().parse(
      repository.get(connection.id),
    );
  });
  ipcMain.handle(IPC_CHANNELS.analysisRun, (event) => {
    trust(event);
    const current = services();
    return mailboxAnalysisSummarySchema.parse(
      analyzeMailbox(
        current.context.database,
        current.context.profile.id,
        current.connection.id,
        current.repository,
      ),
    );
  });
  ipcMain.handle(IPC_CHANNELS.rulesExport, async (event, rawInput) => {
    trust(event);
    const input = exportRulePackInputSchema.parse(rawInput);
    const context = profileSession.requireActiveContext();
    const analysis = input.source === 'proton'
      ? services().repository.get(services().connection.id)
      : (() => { const connection = new GmailConnectionRepository(context.database, profileSession.requireSecretVault(), context.profile.id).get(); return connection ? new GmailAnalysisService(context.database, context.profile.id).get(connection) : null; })();
    if (!analysis) throw new Error('mailbox_analysis_required');
    const pack = buildPortableRulePack(analysis);
    const sieve = input.format === 'proton-sieve';
    const result = await dialog.showSaveDialog({
      title: sieve ? 'Save Proton Sieve rules' : 'Save portable Sift rule pack',
      defaultPath: sieve ? 'sift-proton.sieve' : 'sift-rules.json',
      filters: sieve
        ? [{ name: 'Sieve filters', extensions: ['sieve'] }]
        : [{ name: 'JSON rule packs', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) {
      return exportRulePackResultSchema.parse({ canceled: true, path: null, ruleCount: pack.rules.length });
    }
    await writeFile(
      result.filePath,
      sieve ? renderProtonSieve(pack) : `${JSON.stringify(pack, null, 2)}\n`,
      { encoding: 'utf8', flag: 'w' },
    );
    return exportRulePackResultSchema.parse({ canceled: false, path: result.filePath, ruleCount: pack.rules.length });
  });

  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.analysisGet);
    ipcMain.removeHandler(IPC_CHANNELS.analysisRun);
    ipcMain.removeHandler(IPC_CHANNELS.rulesExport);
  };
};
