import { z } from 'zod';
import { mailCategorySchema } from './analysis';
import { jobProgressSchema } from './jobs';

export const gmailHistoryImpactSchema = z.object({
  id: z.uuid(), scopeAddress: z.email().nullable(), sourceCategory: mailCategorySchema, category: mailCategorySchema,
  targetLabel: z.string(), markRead: z.boolean(), archive: z.boolean(), spam: z.boolean(), existingMessages: z.number().int().nonnegative(), confidence: z.number().min(0).max(1), state: z.enum(['pending','running','succeeded','failed','verification_mismatch']),
});
export const gmailOrganizationPlanSchema = z.object({
  id: z.uuid(), revision: z.string(), state: z.enum(['draft','approved','running','completed','failed']),
  proposalId: z.uuid(), proposalRevision: z.string().length(64), impactCount: z.number().int().nonnegative(), batchCount: z.number().int().nonnegative(),
  existingMessageCount: z.number().int().nonnegative(), skippedAmbiguousStreams: z.number().int().nonnegative(), impacts: z.array(gmailHistoryImpactSchema),
  job: jobProgressSchema.nullable(), undoJob: jobProgressSchema.nullable(),
  failedBatches: z.array(z.object({ id: z.uuid(), targetLabel: z.string(), state: z.enum(['failed','verification_mismatch']), errorCode: z.string().nullable() })),
  createdAt: z.iso.datetime(), approvedAt: z.iso.datetime().nullable(),
});
export const approveGmailOrganizationInputSchema = z.object({ planId: z.uuid(), revision: z.string().length(64) }).strict();
export const retryGmailOrganizationInputSchema = z.object({ planId: z.uuid(), batchIds: z.array(z.uuid()).min(1).max(5_000) }).strict();
export const undoGmailOrganizationInputSchema = z.object({ planId: z.uuid() }).strict();
export type GmailOrganizationPlan = z.infer<typeof gmailOrganizationPlanSchema>;
export type ApproveGmailOrganizationInput = z.infer<typeof approveGmailOrganizationInputSchema>;
export type RetryGmailOrganizationInput = z.infer<typeof retryGmailOrganizationInputSchema>;
export type UndoGmailOrganizationInput = z.infer<typeof undoGmailOrganizationInputSchema>;
