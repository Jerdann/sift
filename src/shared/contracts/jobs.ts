import { z } from "zod";
import { JOB_STATES } from "../../core/jobs/job-types";

export const jobStateSchema = z.enum(JOB_STATES);
export const jobKindSchema = z.enum([
  "synthetic-audit",
  "proton-audit",
  "proton-cleanup",
  "gmail-history",
  "outlook-history",
  "bulk-unsubscribe",
  "provider-rules",
]);

export const jobStateCountsSchema = z.object({
  pending: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  verificationMismatch: z.number().int().nonnegative(),
});

export const jobProgressSchema = z.object({
  id: z.uuid(),
  kind: jobKindSchema,
  state: jobStateSchema,
  totalItems: z.number().int().nonnegative(),
  completedItems: z.number().int().nonnegative(),
  percent: z.number().min(0).max(100),
  counts: jobStateCountsSchema,
  errorCode: z.string().nullable(),
});

export const startSyntheticJobInputSchema = z.object({
  totalItems: z.number().int().min(1).max(100),
});

export const getJobInputSchema = z.object({
  jobId: z.uuid(),
});

export type StartSyntheticJobInput = z.infer<
  typeof startSyntheticJobInputSchema
>;
export type GetJobInput = z.infer<typeof getJobInputSchema>;
