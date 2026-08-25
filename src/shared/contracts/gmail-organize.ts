import { z } from 'zod';
import { mailCategorySchema } from './analysis';

export const gmailRuleSchema = z.object({
  id: z.string(), senderDomain: z.string(), receivingAddress: z.string().nullable(), category: mailCategorySchema,
  targetLabel: z.string(), markRead: z.boolean(), archive: z.boolean(), spam: z.boolean(), existingMessages: z.number().int().nonnegative(), confidence: z.number().min(0).max(1), state: z.enum(['pending','running','succeeded','failed']),
});
export const gmailOrganizationPlanSchema = z.object({
  id: z.uuid(), revision: z.string(), state: z.enum(['draft','approved','running','completed','failed']),
  ruleCount: z.number().int().nonnegative(), existingMessageCount: z.number().int().nonnegative(), skippedAmbiguousStreams: z.number().int().nonnegative(), rules: z.array(gmailRuleSchema), createdAt: z.iso.datetime(), approvedAt: z.iso.datetime().nullable(),
});
export const approveGmailOrganizationInputSchema = z.object({ planId: z.uuid(), revision: z.string().length(64) }).strict();
export type GmailOrganizationPlan = z.infer<typeof gmailOrganizationPlanSchema>;
export type ApproveGmailOrganizationInput = z.infer<typeof approveGmailOrganizationInputSchema>;
