import { dialog, type IpcMain, type IpcMainInvokeEvent } from "electron";
import { writeFile } from "node:fs/promises";
import { mailboxAnalysisSummarySchema } from "../../shared/contracts/analysis";
import {
  exportRulePackInputSchema,
  exportRulePackResultSchema,
} from "../../shared/contracts/rules";
import { IPC_CHANNELS } from "../../shared/ipc";
import {
  buildPortableRulePack,
  renderProtonSieve,
} from "../../core/rules/rule-pack";
import {
  renderManagedProtonSieve,
  sha256,
} from "../../core/rules/rule-reconciliation";
import { GmailConnectionRepository } from "../gmail/gmail-connection-repository";
import { GmailAnalysisService } from "../gmail/gmail-analysis-service";
import { MailboxAnalysisRepository } from "../analysis/mailbox-analysis-repository";
import { analyzeMailbox } from "../analysis/mailbox-analysis-service";
import { ProfileSession } from "../profiles/profile-session";
import { ProtonConnectionRepository } from "../proton/proton-connection-repository";
import { assertTrustedIpcSender } from "../window-security";
import {
  exportProtonRulePlanSchema,
  protonRuleExportResultSchema,
  ruleReconciliationPlanSchema,
} from "../../shared/contracts/rule-management";
import { RuleReconciliationRepository } from "../rules/rule-reconciliation-repository";
import { OutlookConnectionRepository } from "../outlook/outlook-connection-repository";
import { OutlookAnalysisService } from "../outlook/outlook-analysis-service";

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
    if (!connection) throw new Error("proton_not_connected");
    return {
      context,
      connection,
      repository: new MailboxAnalysisRepository(
        context.database,
        context.profile.id,
      ),
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
    const repository = new MailboxAnalysisRepository(
      context.database,
      context.profile.id,
    );
    return mailboxAnalysisSummarySchema
      .nullable()
      .parse(repository.get(connection.id));
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
    exportRulePackInputSchema.parse(rawInput);
    profileSession.requireActiveContext();
    throw new Error("review_purpose_filters_in_rules");
  });
  ipcMain.handle(IPC_CHANNELS.rulePlanExportProton, async (event, rawInput) => {
    trust(event);
    const input = exportProtonRulePlanSchema.parse(rawInput);
    const context = profileSession.requireActiveContext();
    const rules = new RuleReconciliationRepository(
      context.database,
      context.profile.id,
    );
    if (input.enabledOperationIds)
      rules.configureEnabledOperations(
        input.planId,
        input.revision,
        input.enabledOperationIds,
      );
    const plan = rules.getPlan(input.planId);
    const desired = rules.rulesForPlan(input.planId, input.revision);
    const content = renderManagedProtonSieve(desired);
    const result = await dialog.showSaveDialog({
      title: "Save Proton filter file (Sieve)",
      defaultPath: `sift-proton-${input.revision.slice(0, 8)}.sieve`,
      filters: [{ name: "Sieve filters", extensions: ["sieve"] }],
    });
    if (result.canceled || !result.filePath) {
      return protonRuleExportResultSchema.parse({
        canceled: true,
        path: null,
        checksum: null,
        ruleCount: desired.length,
        plan,
      });
    }
    await writeFile(result.filePath, content, { encoding: "utf8", flag: "w" });
    const checksum = sha256(content);
    return protonRuleExportResultSchema.parse({
      canceled: false,
      path: result.filePath,
      checksum,
      ruleCount: desired.length,
      plan: rules.finalizeProtonExport(
        input.planId,
        input.revision,
        checksum,
        result.filePath,
      ),
    });
  });
  ipcMain.handle(IPC_CHANNELS.rulePlanConfirmProton, (event, rawInput) => {
    trust(event);
    const input = exportProtonRulePlanSchema.parse(rawInput);
    const context = profileSession.requireActiveContext();
    return ruleReconciliationPlanSchema.parse(
      new RuleReconciliationRepository(
        context.database,
        context.profile.id,
      ).confirmProtonImport(input.planId, input.revision),
    );
  });

  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.analysisGet);
    ipcMain.removeHandler(IPC_CHANNELS.analysisRun);
    ipcMain.removeHandler(IPC_CHANNELS.rulesExport);
    ipcMain.removeHandler(IPC_CHANNELS.rulePlanExportProton);
    ipcMain.removeHandler(IPC_CHANNELS.rulePlanConfirmProton);
  };
};
