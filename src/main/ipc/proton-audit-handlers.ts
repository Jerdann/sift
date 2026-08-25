import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import {
  protonAuditJobInputSchema,
  protonAuditProgressSchema,
  startProtonAuditInputSchema,
} from '../../shared/contracts/proton-audit';
import { IPC_CHANNELS } from '../../shared/ipc';
import { JobRepository } from '../jobs/job-repository';
import { ProfileSession } from '../profiles/profile-session';
import {
  createProtonAuditClient,
  type ProtonAuditClientFactory,
} from '../proton/bridge-client';
import { ProtonAuditRepository } from '../proton/proton-audit-repository';
import { ProtonAuditRunner } from '../proton/proton-audit-runner';
import { ProtonConnectionRepository } from '../proton/proton-connection-repository';
import { assertTrustedIpcSender } from '../window-security';

export interface RegisterProtonAuditHandlersOptions {
  ipcMain: IpcMain;
  profileSession: ProfileSession;
  developmentServerUrl?: string;
  createProtonAuditClient?: ProtonAuditClientFactory;
}

export const registerProtonAuditHandlers = ({
  ipcMain,
  profileSession,
  developmentServerUrl,
  createProtonAuditClient: createClient = createProtonAuditClient,
}: RegisterProtonAuditHandlersOptions): (() => void) => {
  let activeProfileId: string | null = null;
  let jobs: JobRepository | null = null;
  let audits: ProtonAuditRepository | null = null;
  let runner: ProtonAuditRunner | null = null;
  const running = new Set<string>();

  const trust = (event: IpcMainInvokeEvent) =>
    assertTrustedIpcSender(event.senderFrame?.url, developmentServerUrl);

  const services = () => {
    const context = profileSession.requireActiveContext();
    if (activeProfileId !== context.profile.id || !jobs || !audits || !runner) {
      activeProfileId = context.profile.id;
      jobs = new JobRepository(context.database);
      jobs.recoverInterrupted();
      audits = new ProtonAuditRepository(context.database);
      const connections = new ProtonConnectionRepository(
        context.database,
        profileSession.requireSecretVault(),
        context.profile.id,
      );
      runner = new ProtonAuditRunner(jobs, audits, connections, createClient);
    }
    return { context, jobs, audits, runner };
  };

  const runAudit = (event: IpcMainInvokeEvent, jobId: string, current: ReturnType<typeof services>) => {
    const unsubscribe = current.runner.subscribe((progress) => {
      if (progress.job.id !== jobId) return;
      if (!event.sender.isDestroyed()) {
        event.sender.send(IPC_CHANNELS.protonAuditProgress, protonAuditProgressSchema.parse(progress));
      }
      if (['succeeded', 'failed', 'skipped', 'verification_mismatch'].includes(progress.job.state)) {
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

  ipcMain.handle(IPC_CHANNELS.protonAuditStart, (event, rawInput: unknown) => {
    trust(event);
    const input = startProtonAuditInputSchema.parse(rawInput);
    const current = services();
    const connection = new ProtonConnectionRepository(
      current.context.database,
      profileSession.requireSecretVault(),
      current.context.profile.id,
    ).get();
    if (!connection) throw new Error('proton_not_connected');
    const containers = current.audits.containers(connection.id);
    if (!containers.length) throw new Error('proton_discovery_required');
    const job = current.jobs.createJob({
      profileId: current.context.profile.id,
      kind: 'proton-audit',
      idempotencyKey: `proton-audit:${connection.id}:${randomUUID()}`,
      itemKeys: containers.map((container) => container.provider_container_id),
    });
    current.audits.registerRun(job.id, connection.id, input.extractBodies);
    runAudit(event, job.id, current);
    return protonAuditProgressSchema.parse(current.runner.progress(job.id));
  });

  ipcMain.handle(IPC_CHANNELS.protonAuditGetCurrent, (event) => {
    trust(event);
    const current = services();
    const jobId = current.audits.findLatestJobId(current.context.profile.id);
    return protonAuditProgressSchema.nullable().parse(jobId ? current.runner.progress(jobId) : null);
  });

  ipcMain.handle(IPC_CHANNELS.protonAuditResume, (event, rawInput: unknown) => {
    trust(event);
    const { jobId } = protonAuditJobInputSchema.parse(rawInput);
    const current = services();
    const job = current.jobs.getJob(jobId);
    if (job.profileId !== current.context.profile.id || job.kind !== 'proton-audit') {
      throw new Error('Proton audit was not found');
    }
    runAudit(event, jobId, current);
    return protonAuditProgressSchema.parse(current.runner.progress(jobId));
  });

  ipcMain.handle(IPC_CHANNELS.protonAuditPause, (event, rawInput: unknown) => {
    trust(event);
    const { jobId } = protonAuditJobInputSchema.parse(rawInput);
    const current = services();
    current.runner.requestPause(jobId);
    return protonAuditProgressSchema.parse(current.runner.progress(jobId));
  });

  return () => {
    for (const channel of [
      IPC_CHANNELS.protonAuditStart,
      IPC_CHANNELS.protonAuditGetCurrent,
      IPC_CHANNELS.protonAuditResume,
      IPC_CHANNELS.protonAuditPause,
    ]) ipcMain.removeHandler(channel);
  };
};
