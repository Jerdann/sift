import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { approveCleanupInputSchema, cleanupPlanSchema, cleanupProgressSchema, generateCleanupInputSchema, getCleanupInputSchema } from '../../shared/contracts/cleanup';
import { IPC_CHANNELS } from '../../shared/ipc';
import { CleanupPlanRepository } from '../cleanup/cleanup-plan-repository';
import { CleanupRunner } from '../cleanup/cleanup-runner';
import { JobRepository } from '../jobs/job-repository';
import { ProfileSession } from '../profiles/profile-session';
import type { ProtonMutationClientFactory } from '../proton/proton-mutation-client';
import { ProtonConnectionRepository } from '../proton/proton-connection-repository';
import { assertTrustedIpcSender } from '../window-security';

export const registerCleanupHandlers = ({
  ipcMain,
  profileSession,
  developmentServerUrl,
  createMutationClient,
}: {
  ipcMain: IpcMain;
  profileSession: ProfileSession;
  developmentServerUrl?: string;
  createMutationClient?: ProtonMutationClientFactory;
}): (() => void) => {
  let profileId: string | null = null;
  let jobs: JobRepository | null = null;
  let plans: CleanupPlanRepository | null = null;
  let runner: CleanupRunner | null = null;
  const running = new Set<string>();
  const trust = (event: IpcMainInvokeEvent) => assertTrustedIpcSender(event.senderFrame?.url, developmentServerUrl);
  const services = () => {
    const context = profileSession.requireActiveContext();
    if (profileId !== context.profile.id || !jobs || !plans || !runner) {
      profileId = context.profile.id;
      jobs = new JobRepository(context.database);
      jobs.recoverInterrupted();
      plans = new CleanupPlanRepository(context.database, jobs, context.profile.id);
      const connections = new ProtonConnectionRepository(context.database, profileSession.requireSecretVault(), context.profile.id);
      runner = new CleanupRunner(jobs, plans, connections, createMutationClient);
    }
    const connection = new ProtonConnectionRepository(context.database, profileSession.requireSecretVault(), context.profile.id).get();
    return { context, connection, jobs, plans, runner };
  };
  const run = (event: IpcMainInvokeEvent, jobId: string, planId: string, current: ReturnType<typeof services>) => {
    const unsubscribe = current.runner.subscribe((progress) => {
      if (progress.plan.id !== planId) return;
      if (!event.sender.isDestroyed()) event.sender.send(IPC_CHANNELS.cleanupProgress, cleanupProgressSchema.parse(progress));
      if (progress.plan.job && ['succeeded', 'failed', 'verification_mismatch'].includes(progress.plan.job.state)) {
        unsubscribe();
        running.delete(jobId);
      }
    });
    if (!running.has(jobId)) {
      running.add(jobId);
      void current.runner.run(jobId).catch(() => {
        unsubscribe();
        running.delete(jobId);
      });
    }
  };

  ipcMain.handle(IPC_CHANNELS.cleanupGet, (event, rawInput: unknown) => {
    trust(event);
    const input = getCleanupInputSchema.parse(rawInput);
    const current = services();
    return cleanupPlanSchema.nullable().parse(current.connection ? current.plans.getCurrent(current.connection.id, input.kind) : null);
  });
  ipcMain.handle(IPC_CHANNELS.cleanupGenerate, (event, rawInput: unknown) => {
    trust(event);
    const input = generateCleanupInputSchema.parse(rawInput);
    const current = services();
    if (!current.connection) throw new Error('proton_not_connected');
    return cleanupPlanSchema.parse(current.plans.generate(current.connection.id, input));
  });
  ipcMain.handle(IPC_CHANNELS.cleanupApprove, (event, rawInput: unknown) => {
    trust(event);
    const input = approveCleanupInputSchema.parse(rawInput);
    const current = services();
    const plan = current.plans.approve(input.planId, input.revision);
    if (!plan.job) throw new Error('cleanup_job_missing');
    run(event, plan.job.id, plan.id, current);
    return cleanupProgressSchema.parse(current.runner.progress(plan.id));
  });
  ipcMain.handle(IPC_CHANNELS.cleanupResume, (event, rawInput: unknown) => {
    trust(event);
    const input = approveCleanupInputSchema.parse(rawInput);
    const current = services();
    const plan = current.plans.get(input.planId);
    if (plan.revision !== input.revision || !plan.job) throw new Error('cleanup_plan_changed');
    run(event, plan.job.id, plan.id, current);
    return cleanupProgressSchema.parse(current.runner.progress(plan.id));
  });
  return () => {
    for (const channel of [IPC_CHANNELS.cleanupGet, IPC_CHANNELS.cleanupGenerate, IPC_CHANNELS.cleanupApprove, IPC_CHANNELS.cleanupResume]) ipcMain.removeHandler(channel);
  };
};
