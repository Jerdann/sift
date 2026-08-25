export const JOB_STATES = [
  'pending',
  'running',
  'succeeded',
  'failed',
  'skipped',
  'verification_mismatch',
] as const;

export type JobState = (typeof JOB_STATES)[number];
export type JobKind = 'synthetic-audit' | 'proton-audit' | 'proton-cleanup' | 'gmail-history' | 'bulk-unsubscribe' | 'provider-rules';

export interface DurableJob {
  readonly id: string;
  readonly profileId: string;
  readonly kind: JobKind;
  readonly state: JobState;
  readonly idempotencyKey: string;
  readonly totalItems: number;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly errorCode: string | null;
}

export interface DurableJobItem {
  readonly id: string;
  readonly jobId: string;
  readonly itemKey: string;
  readonly state: JobState;
  readonly attempts: number;
  readonly errorCode: string | null;
  readonly updatedAt: string;
}

export interface JobStateCounts {
  readonly pending: number;
  readonly running: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly skipped: number;
  readonly verificationMismatch: number;
}

export interface JobProgress {
  readonly id: string;
  readonly kind: JobKind;
  readonly state: JobState;
  readonly totalItems: number;
  readonly completedItems: number;
  readonly percent: number;
  readonly counts: JobStateCounts;
  readonly errorCode: string | null;
}

export interface SafeJobResult {
  readonly operation: 'synthetic-check' | 'proton-folder-index' | 'proton-cleanup-action' | 'gmail-history-batch' | 'unsubscribe-one-click' | 'provider-rule-action';
  readonly verified: boolean;
}
