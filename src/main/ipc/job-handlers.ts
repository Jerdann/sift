import type { IpcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import { jobProgressSchema, getJobInputSchema, startSyntheticJobInputSchema } from '../../shared/contracts/jobs';
import { IPC_CHANNELS } from '../../shared/ipc';
import { JobRepository } from '../jobs/job-repository';
import { JobRunner } from '../jobs/job-runner';
import { ProfileSession } from '../profiles/profile-session';
import { assertTrustedIpcSender } from '../window-security';

export interface RegisterJobHandlersOptions {
  ipcMain: IpcMain;
  profileSession: ProfileSession;
  developmentServerUrl?: string;
}

export const registerJobHandlers = ({
  ipcMain,
  profileSession,
  developmentServerUrl,
}: RegisterJobHandlersOptions): (() => void) => {
  let activeProfileId: string | null = null;
  let repository: JobRepository | null = null;
  let runner: JobRunner | null = null;
  const runningJobIds = new Set<string>();

  const services = () => {
    const context = profileSession.requireActiveContext();
    if (activeProfileId !== context.profile.id || !repository || !runner) {
      activeProfileId = context.profile.id;
      repository = new JobRepository(context.database);
      repository.recoverInterrupted();
      runner = new JobRunner(repository);
    }
    return { context, repository, runner };
  };

  const runJob = (
    event: Electron.IpcMainInvokeEvent,
    jobId: string,
    current: ReturnType<typeof services>,
  ) => {
    const unsubscribe = current.runner.subscribe((progress) => {
      if (progress.id !== jobId) return;
      if (!event.sender.isDestroyed()) {
        event.sender.send(IPC_CHANNELS.jobsProgress, jobProgressSchema.parse(progress));
      }
      if (['succeeded', 'failed', 'skipped', 'verification_mismatch'].includes(progress.state)) {
        unsubscribe();
        runningJobIds.delete(jobId);
      }
    });
    if (!runningJobIds.has(jobId)) {
      runningJobIds.add(jobId);
      void current.runner.run(jobId).catch(() => {
        unsubscribe();
        runningJobIds.delete(jobId);
      });
    }
  };

  ipcMain.handle(IPC_CHANNELS.jobsStartSynthetic, (event, rawInput: unknown) => {
    assertTrustedIpcSender(event.senderFrame?.url, developmentServerUrl);
    const input = startSyntheticJobInputSchema.parse(rawInput);
    const current = services();
    const job = current.repository.createJob({
      profileId: current.context.profile.id,
      kind: 'synthetic-audit',
      idempotencyKey: `synthetic:${randomUUID()}`,
      itemKeys: Array.from({ length: input.totalItems }, (_, index) => `check-${index + 1}`),
    });
    runJob(event, job.id, current);
    return jobProgressSchema.parse(current.repository.getProgress(job.id));
  });

  ipcMain.handle(IPC_CHANNELS.jobsResume, (event, rawInput: unknown) => {
    assertTrustedIpcSender(event.senderFrame?.url, developmentServerUrl);
    const { jobId } = getJobInputSchema.parse(rawInput);
    const current = services();
    const job = current.repository.getJob(jobId);
    if (job.profileId !== current.context.profile.id) throw new Error('Job was not found');
    runJob(event, jobId, current);
    return jobProgressSchema.parse(current.repository.getProgress(jobId));
  });

  ipcMain.handle(IPC_CHANNELS.jobsGet, (event, rawInput: unknown) => {
    assertTrustedIpcSender(event.senderFrame?.url, developmentServerUrl);
    const { jobId } = getJobInputSchema.parse(rawInput);
    const current = services();
    const job = current.repository.getJob(jobId);
    if (job.profileId !== current.context.profile.id) throw new Error('Job was not found');
    return jobProgressSchema.parse(current.repository.getProgress(jobId));
  });

  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.jobsStartSynthetic);
    ipcMain.removeHandler(IPC_CHANNELS.jobsGet);
    ipcMain.removeHandler(IPC_CHANNELS.jobsResume);
  };
};
