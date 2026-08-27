import { shell, type IpcMain, type IpcMainInvokeEvent } from "electron";
import { mailboxAnalysisSummarySchema } from "../../shared/contracts/analysis";
import {
  approveGmailOrganizationInputSchema,
  generateGmailDeletionInputSchema,
  gmailOrganizationPlanSchema,
  retryGmailOrganizationInputSchema,
  undoGmailOrganizationInputSchema,
} from "../../shared/contracts/gmail-organize";
import {
  retryUnsubscribeInputSchema,
  startUnsubscribeInputSchema,
  subscriptionDashboardSchema,
  unsubscribeJobInputSchema,
} from "../../shared/contracts/unsubscribe";
import {
  outlookAuditSummarySchema,
  outlookConnectionSummarySchema,
  outlookDisconnectInputSchema,
  outlookOAuthInputSchema,
} from "../../shared/contracts/outlook";
import { IPC_CHANNELS } from "../../shared/ipc";
import { OutlookAnalysisService } from "../outlook/outlook-analysis-service";
import { OutlookAuditService } from "../outlook/outlook-audit-service";
import { OutlookConnectionRepository } from "../outlook/outlook-connection-repository";
import { OutlookHistoryRepository } from "../outlook/outlook-history-repository";
import { OutlookHistoryRunner } from "../outlook/outlook-history-runner";
import { authorizeOutlook, type OutlookFetch } from "../outlook/outlook-oauth";
import { JobRepository } from "../jobs/job-repository";
import { OutlookSubscriptionService } from "../outlook/outlook-subscription-service";
import { UnsubscribeRunner } from "../unsubscribe/unsubscribe-runner";
import type { ProfileSession } from "../profiles/profile-session";
import { assertTrustedIpcSender } from "../window-security";

export const registerOutlookHandlers = ({
  ipcMain,
  profileSession,
  developmentServerUrl,
  fetchPort = fetch,
}: {
  ipcMain: IpcMain;
  profileSession: ProfileSession;
  developmentServerUrl?: string;
  fetchPort?: OutlookFetch;
}): (() => void) => {
  let running = false;
  const trust = (event: IpcMainInvokeEvent) =>
    assertTrustedIpcSender(event.senderFrame?.url, developmentServerUrl);
  const current = () => {
    const context = profileSession.requireActiveContext();
    return {
      context,
      repository: new OutlookConnectionRepository(
        context.database,
        profileSession.requireSecretVault(),
        context.profile.id,
      ),
    };
  };
  ipcMain.handle(IPC_CHANNELS.outlookGetConnection, (event) => {
    trust(event);
    return outlookConnectionSummarySchema
      .nullable()
      .parse(current().repository.get());
  });
  ipcMain.handle(IPC_CHANNELS.outlookConnect, async (event, raw) => {
    trust(event);
    const input = outlookOAuthInputSchema.parse(raw);
    const grant = await authorizeOutlook(
      input,
      (url) => shell.openExternal(url),
      fetchPort,
    );
    const connection = current().repository.save(
      input,
      grant.email,
      grant.refreshToken,
    );
    const context = profileSession.requireActiveContext();
    const count = (
      context.database
        .prepare(
          "SELECT (SELECT COUNT(*) FROM gmail_connections WHERE profile_id=?)+(SELECT COUNT(*) FROM provider_connections WHERE profile_id=?)+(SELECT COUNT(*) FROM outlook_connections WHERE profile_id=?) count",
        )
        .get(context.profile.id, context.profile.id, context.profile.id) as {
        count: number;
      }
    ).count;
    profileSession.setActiveProviderCount(count);
    return outlookConnectionSummarySchema.parse(connection);
  });
  ipcMain.handle(IPC_CHANNELS.outlookDisconnect, (event, raw) => {
    trust(event);
    current().repository.disconnect(
      outlookDisconnectInputSchema.parse(raw).connectionId,
    );
  });
  ipcMain.handle(IPC_CHANNELS.outlookAuditGet, (event) => {
    trust(event);
    const value = current();
    return outlookAuditSummarySchema
      .nullable()
      .parse(
        new OutlookAuditService(value.context.database, value.repository, {
          fetchPort,
        }).get(),
      );
  });
  ipcMain.handle(IPC_CHANNELS.outlookAuditStart, async (event) => {
    trust(event);
    if (running) throw new Error("outlook_audit_active");
    const value = current();
    running = true;
    try {
      return await new OutlookAuditService(
        value.context.database,
        value.repository,
        { fetchPort },
      ).run((summary) =>
        event.sender.send(IPC_CHANNELS.outlookAuditProgress, {
          profileId: value.context.profile.id,
          summary,
        }),
      );
    } finally {
      running = false;
    }
  });
  ipcMain.handle(IPC_CHANNELS.outlookAnalysisGet, (event) => {
    trust(event);
    const value = current();
    const connection = value.repository.get();
    return mailboxAnalysisSummarySchema
      .nullable()
      .parse(
        connection
          ? new OutlookAnalysisService(
              value.context.database,
              value.context.profile.id,
            ).get(connection)
          : null,
      );
  });
  ipcMain.handle(IPC_CHANNELS.outlookAnalysisRun, (event) => {
    trust(event);
    const value = current();
    const connection = value.repository.get();
    if (!connection) throw new Error("outlook_not_connected");
    return mailboxAnalysisSummarySchema.parse(
      new OutlookAnalysisService(
        value.context.database,
        value.context.profile.id,
      ).analyze(connection),
    );
  });
  const history = () => {
    const value = current();
    const jobs = new JobRepository(value.context.database);
    return {
      ...value,
      jobs,
      plans: new OutlookHistoryRepository(
        value.context.database,
        jobs,
        value.context.profile.id,
      ),
    };
  };
  ipcMain.handle(IPC_CHANNELS.outlookOrganizeGet, (event) => {
    trust(event);
    const value = history();
    const connection = value.repository.get();
    return gmailOrganizationPlanSchema
      .nullable()
      .parse(connection ? value.plans.get(connection.id, "organize") : null);
  });
  ipcMain.handle(IPC_CHANNELS.outlookDeletionGet, (event) => {
    trust(event);
    const value = history();
    const connection = value.repository.get();
    return gmailOrganizationPlanSchema
      .nullable()
      .parse(connection ? value.plans.get(connection.id, "trash") : null);
  });
  ipcMain.handle(IPC_CHANNELS.outlookSpamGet, (event) => {
    trust(event);
    const value = history();
    const connection = value.repository.get();
    return gmailOrganizationPlanSchema
      .nullable()
      .parse(connection ? value.plans.get(connection.id, "spam") : null);
  });
  ipcMain.handle(IPC_CHANNELS.outlookOrganizeGenerate, (event) => {
    trust(event);
    const value = history();
    const connection = value.repository.get();
    if (!connection) throw new Error("outlook_not_connected");
    return gmailOrganizationPlanSchema.parse(value.plans.generate(connection));
  });
  ipcMain.handle(IPC_CHANNELS.outlookDeletionGenerate, (event, raw) => {
    trust(event);
    const input = generateGmailDeletionInputSchema.parse(raw);
    const value = history();
    const connection = value.repository.get();
    if (!connection) throw new Error("outlook_not_connected");
    return gmailOrganizationPlanSchema.parse(
      value.plans.generate(connection, {
        kind: "trash",
        senderDomains: input.senderDomains,
        olderThanDays: input.olderThanDays,
      }),
    );
  });
  ipcMain.handle(IPC_CHANNELS.outlookSpamGenerate, (event) => {
    trust(event);
    const value = history();
    const connection = value.repository.get();
    if (!connection) throw new Error("outlook_not_connected");
    return gmailOrganizationPlanSchema.parse(
      value.plans.generate(connection, { kind: "spam" }),
    );
  });
  ipcMain.handle(IPC_CHANNELS.outlookOrganizeApprove, async (event, raw) => {
    trust(event);
    const input = approveGmailOrganizationInputSchema.parse(raw);
    const value = history();
    const connection = value.repository.get();
    if (!connection) throw new Error("outlook_not_connected");
    const approved = value.plans.approve(
      connection.id,
      input.planId,
      input.revision,
    );
    return gmailOrganizationPlanSchema.parse(
      await new OutlookHistoryRunner(
        value.repository,
        value.plans,
        value.jobs,
        fetchPort,
      ).run(approved.job!.id, (plan) =>
        event.sender.send(IPC_CHANNELS.outlookOrganizeProgress, {
          profileId: value.context.profile.id,
          plan,
        }),
      ),
    );
  });
  ipcMain.handle(IPC_CHANNELS.outlookOrganizeRetry, async (event, raw) => {
    trust(event);
    const input = retryGmailOrganizationInputSchema.parse(raw);
    const value = history();
    const plan = value.plans.retry(input.planId, input.batchIds);
    return gmailOrganizationPlanSchema.parse(
      await new OutlookHistoryRunner(
        value.repository,
        value.plans,
        value.jobs,
        fetchPort,
      ).run(plan.job!.id, (next) =>
        event.sender.send(IPC_CHANNELS.outlookOrganizeProgress, {
          profileId: value.context.profile.id,
          plan: next,
        }),
      ),
    );
  });
  ipcMain.handle(IPC_CHANNELS.outlookOrganizeUndo, async (event, raw) => {
    trust(event);
    const input = undoGmailOrganizationInputSchema.parse(raw);
    const value = history();
    const plan = value.plans.prepareUndo(input.planId);
    return gmailOrganizationPlanSchema.parse(
      await new OutlookHistoryRunner(
        value.repository,
        value.plans,
        value.jobs,
        fetchPort,
      ).undo(plan.undoJob!.id, (next) =>
        event.sender.send(IPC_CHANNELS.outlookOrganizeProgress, {
          profileId: value.context.profile.id,
          plan: next,
        }),
      ),
    );
  });
  const subscriptions = () => {
    const value = current();
    const jobs = new JobRepository(value.context.database);
    return {
      ...value,
      jobs,
      service: new OutlookSubscriptionService(
        value.context.database,
        jobs,
        value.context.profile.id,
      ),
    };
  };
  const runUnsubscribe = async (
    event: IpcMainInvokeEvent,
    value: ReturnType<typeof subscriptions>,
    jobId: string,
  ) => {
    const runner = new UnsubscribeRunner(value.jobs, value.service);
    const stop = runner.subscribe((progress) =>
      event.sender.send(IPC_CHANNELS.outlookUnsubscribeProgress, progress),
    );
    try {
      return (await runner.run(jobId)).dashboard;
    } finally {
      stop();
    }
  };
  ipcMain.handle(IPC_CHANNELS.outlookUnsubscribeGet, (event) => {
    trust(event);
    const value = subscriptions();
    const connection = value.repository.get();
    return subscriptionDashboardSchema
      .nullable()
      .parse(connection ? value.service.getCurrent(connection.id) : null);
  });
  ipcMain.handle(IPC_CHANNELS.outlookUnsubscribeScan, (event) => {
    trust(event);
    const value = subscriptions();
    const connection = value.repository.get();
    if (!connection) throw new Error("outlook_not_connected");
    return subscriptionDashboardSchema.parse(value.service.scan(connection.id));
  });
  ipcMain.handle(IPC_CHANNELS.outlookUnsubscribeStart, async (event, raw) => {
    trust(event);
    const input = startUnsubscribeInputSchema.parse(raw);
    const value = subscriptions();
    const dashboard = value.service.start(input.candidateIds);
    return subscriptionDashboardSchema.parse(
      await runUnsubscribe(event, value, dashboard.job!.id),
    );
  });
  ipcMain.handle(IPC_CHANNELS.outlookUnsubscribeResume, async (event, raw) => {
    trust(event);
    const input = unsubscribeJobInputSchema.parse(raw);
    const value = subscriptions();
    return subscriptionDashboardSchema.parse(
      await runUnsubscribe(event, value, input.jobId),
    );
  });
  ipcMain.handle(IPC_CHANNELS.outlookUnsubscribeRetry, async (event, raw) => {
    trust(event);
    const input = retryUnsubscribeInputSchema.parse(raw);
    const value = subscriptions();
    value.service.retry(input.jobId, input.candidateIds);
    return subscriptionDashboardSchema.parse(
      await runUnsubscribe(event, value, input.jobId),
    );
  });
  return () => {
    for (const channel of [
      IPC_CHANNELS.outlookGetConnection,
      IPC_CHANNELS.outlookConnect,
      IPC_CHANNELS.outlookDisconnect,
      IPC_CHANNELS.outlookAuditGet,
      IPC_CHANNELS.outlookAuditStart,
      IPC_CHANNELS.outlookAnalysisGet,
      IPC_CHANNELS.outlookAnalysisRun,
      IPC_CHANNELS.outlookOrganizeGet,
      IPC_CHANNELS.outlookOrganizeGenerate,
      IPC_CHANNELS.outlookOrganizeApprove,
      IPC_CHANNELS.outlookOrganizeRetry,
      IPC_CHANNELS.outlookOrganizeUndo,
      IPC_CHANNELS.outlookDeletionGet,
      IPC_CHANNELS.outlookDeletionGenerate,
      IPC_CHANNELS.outlookSpamGet,
      IPC_CHANNELS.outlookSpamGenerate,
      IPC_CHANNELS.outlookUnsubscribeGet,
      IPC_CHANNELS.outlookUnsubscribeScan,
      IPC_CHANNELS.outlookUnsubscribeStart,
      IPC_CHANNELS.outlookUnsubscribeResume,
      IPC_CHANNELS.outlookUnsubscribeRetry,
    ])
      ipcMain.removeHandler(channel);
  };
};
