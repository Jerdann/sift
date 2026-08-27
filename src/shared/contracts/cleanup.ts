import { z } from 'zod';
import { jobProgressSchema } from './jobs';
import { mailCategorySchema } from './analysis';

export const cleanupImpactSchema = z.object({
  scopeAddress: z.string().email().nullable(),
  containerName: z.string().nullable(),
  category: mailCategorySchema,
  targetFolder: z.string(),
  action: z.enum(['sort_read_archive', 'native_spam', 'native_trash']),
  messageCount: z.number().int().nonnegative(),
});

export const cleanupPlanSchema = z.object({
  id: z.uuid(),
  connectionId: z.uuid(),
  kind: z.enum(['organize', 'spam', 'trash']),
  existingSetup: z.enum(['extend', 'reuse', 'replace']),
  revision: z.string(),
  proposalId: z.uuid().nullable(),
  proposalRevision: z.string().length(64).nullable(),
  spamReviewId: z.uuid().nullable(),
  state: z.enum(['draft', 'approved', 'executing', 'completed', 'failed']),
  createdAt: z.iso.datetime(),
  approvedAt: z.iso.datetime().nullable(),
  actionCount: z.number().int().nonnegative(),
  spamCount: z.number().int().nonnegative(),
  trashCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  requiresRebuild: z.boolean(),
  impacts: z.array(cleanupImpactSchema),
  job: jobProgressSchema.nullable(),
  undoJob: jobProgressSchema.nullable(),
  failedActions: z.array(z.object({
    id: z.uuid(),
    targetPath: z.string(),
    state: z.enum(['failed', 'verification_mismatch']),
    errorCode: z.string().nullable(),
  })),
  legacyContainers: z.array(z.object({
    id: z.uuid(),
    providerPath: z.string().min(1),
    kind: z.enum(['folder', 'label']),
    observedMessages: z.number().int().nonnegative(),
    state: z.enum(['pending', 'running', 'retired', 'retained_nonempty', 'failed']),
    errorCode: z.string().nullable(),
  })),
});

export const approveCleanupInputSchema = z.object({
  planId: z.uuid(),
  revision: z.string().min(1),
});

export const generateCleanupInputSchema = z.object({
  kind: z.enum(['organize', 'spam', 'trash']).default('organize'),
  existingSetup: z.enum(['extend', 'reuse', 'replace']).default('extend'),
  containers: z.record(
    z.string().email(),
    z.string().trim().min(1).max(64).regex(/^[^\\/\0]+$/),
  ).default({}),
  trashSenderDomains: z.array(z.string().trim().min(1).max(253)).max(500).default([]),
});

export const getCleanupInputSchema = z.object({
  kind: z.enum(['organize', 'spam', 'trash']).default('organize'),
});

export const retryCleanupInputSchema = z.object({
  planId: z.uuid(),
  actionIds: z.array(z.uuid()).min(1).max(5_000),
}).strict();

export const undoCleanupInputSchema = z.object({ planId: z.uuid() }).strict();

export const cleanupProgressSchema = z.object({
  profileId: z.uuid(),
  plan: cleanupPlanSchema,
  currentTarget: z.string().nullable(),
});

export type CleanupPlan = z.infer<typeof cleanupPlanSchema>;
export type GenerateCleanupInput = Omit<
  z.infer<typeof generateCleanupInputSchema>,
  'existingSetup'
> & {
  existingSetup?: 'extend' | 'reuse' | 'replace';
};
export type GetCleanupInput = z.infer<typeof getCleanupInputSchema>;
export type ApproveCleanupInput = z.infer<typeof approveCleanupInputSchema>;
export type RetryCleanupInput = z.infer<typeof retryCleanupInputSchema>;
export type UndoCleanupInput = z.infer<typeof undoCleanupInputSchema>;
export type CleanupProgress = z.infer<typeof cleanupProgressSchema>;
