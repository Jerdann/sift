import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import {
  startUnsubscribeInputSchema,
  retryUnsubscribeInputSchema,
  subscriptionDashboardSchema,
  unsubscribeJobInputSchema,
  unsubscribeProgressSchema,
} from '../../shared/contracts/unsubscribe';
import { IPC_CHANNELS } from '../../shared/ipc';
import { JobRepository } from '../jobs/job-repository';
import { ProfileSession } from '../profiles/profile-session';
import { ProtonConnectionRepository } from '../proton/proton-connection-repository';
import { SubscriptionRepository } from '../unsubscribe/subscription-repository';
import { UnsubscribeRunner } from '../unsubscribe/unsubscribe-runner';
import { assertTrustedIpcSender } from '../window-security';

export const registerUnsubscribeHandlers = ({
  ipcMain,
  profileSession,
  developmentServerUrl,
}: {
  ipcMain: IpcMain;
  profileSession: ProfileSession;
  developmentServerUrl?: string;
}): (() => void) => {
  let profileId: string | null = null;
  let jobs: JobRepository | null = null;
  let subscriptions: SubscriptionRepository | null = null;
  let runner: UnsubscribeRunner | null = null;
  const running = new Set<string>();
  const trust = (event: IpcMainInvokeEvent) => assertTrustedIpcSender(event.senderFrame?.url, developmentServerUrl);
  const services = () => {
    const context = profileSession.requireActiveContext();
    if (profileId !== context.profile.id || !jobs || !subscriptions || !runner) {
      profileId = context.profile.id;
      jobs = new JobRepository(context.database);
      jobs.recoverInterrupted();
      subscriptions = new SubscriptionRepository(context.database, jobs, context.profile.id);
      runner = new UnsubscribeRunner(jobs, subscriptions);
    }
    const connection = new ProtonConnectionRepository(context.database, profileSession.requireSecretVault(), context.profile.id).get();
    return { context, connection, jobs, subscriptions, runner };
  };
  const run = (event: IpcMainInvokeEvent, jobId: string, current: ReturnType<typeof services>) => {
    const unsubscribe = current.runner.subscribe((progress) => {
      if (progress.dashboard.job?.id !== jobId) return;
      if (!event.sender.isDestroyed()) event.sender.send(IPC_CHANNELS.unsubscribeProgress, unsubscribeProgressSchema.parse(progress));
      if (progress.dashboard.job && ['succeeded', 'failed'].includes(progress.dashboard.job.state)) {
        unsubscribe(); running.delete(jobId);
      }
    });
    if (!running.has(jobId)) {
      running.add(jobId);
      void current.runner.run(jobId).catch(() => { unsubscribe(); running.delete(jobId); });
    }
  };

  ipcMain.handle(IPC_CHANNELS.unsubscribeGet, (event) => {
    trust(event);
    const current = services();
    return subscriptionDashboardSchema.nullable().parse(current.connection ? current.subscriptions.getCurrent(current.connection.id) : null);
  });
  ipcMain.handle(IPC_CHANNELS.unsubscribeScan, (event) => {
    trust(event);
    const current = services();
    if (!current.connection) throw new Error('proton_not_connected');
    return subscriptionDashboardSchema.parse(current.subscriptions.scan(current.connection.id));
  });
  ipcMain.handle(IPC_CHANNELS.unsubscribeStart, (event, rawInput: unknown) => {
    trust(event);
    const input = startUnsubscribeInputSchema.parse(rawInput);
    const current = services();
    const dashboard = current.subscriptions.start(input.candidateIds);
    if (!dashboard.job) throw new Error('unsubscribe_job_missing');
    run(event, dashboard.job.id, current);
    return unsubscribeProgressSchema.parse(current.runner.progress(current.subscriptions.scanIdForJob(dashboard.job.id)));
  });
  ipcMain.handle(IPC_CHANNELS.unsubscribeResume, (event, rawInput: unknown) => {
    trust(event);
    const { jobId } = unsubscribeJobInputSchema.parse(rawInput);
    const current = services();
    const scanId = current.subscriptions.scanIdForJob(jobId);
    run(event, jobId, current);
    return unsubscribeProgressSchema.parse(current.runner.progress(scanId));
  });
  ipcMain.handle(IPC_CHANNELS.unsubscribeRetry, (event, rawInput: unknown) => {
    trust(event);
    const input = retryUnsubscribeInputSchema.parse(rawInput);
    const current = services();
    current.subscriptions.retry(input.jobId, input.candidateIds);
    const scanId = current.subscriptions.scanIdForJob(input.jobId);
    run(event, input.jobId, current);
    return unsubscribeProgressSchema.parse(current.runner.progress(scanId));
  });
  return () => {
    for (const channel of [IPC_CHANNELS.unsubscribeGet, IPC_CHANNELS.unsubscribeScan, IPC_CHANNELS.unsubscribeStart, IPC_CHANNELS.unsubscribeResume, IPC_CHANNELS.unsubscribeRetry]) ipcMain.removeHandler(channel);
  };
};
