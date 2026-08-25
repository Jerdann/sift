import { z } from 'zod';
import { mailCategorySchema } from './analysis';
import { jobProgressSchema } from './jobs';

export const subscriptionCandidateSchema = z.object({
  id: z.uuid(),
  senderDomain: z.string(),
  listId: z.string(),
  receivingAddress: z.string(),
  eligibility: z.enum(['eligible', 'manual', 'protected', 'spam_skipped']),
  authenticated: z.boolean(),
  messageCount: z.number().int().positive(),
  latestAt: z.iso.datetime().nullable(),
  priorityScore: z.number().nonnegative(),
  requestedAt: z.iso.datetime().nullable(),
  recurrence: z.enum(['never_requested', 'quiet', 'recurring']),
  categories: z.array(mailCategorySchema),
  sampleSubjects: z.array(z.string()),
  status: z.enum(['pending', 'unsubscribed', 'failed', 'manual', 'spam_skipped']),
  reason: z.string(),
});

export const subscriptionDashboardSchema = z.object({
  analysisId: z.uuid(),
  generatedAt: z.iso.datetime(),
  candidates: z.array(subscriptionCandidateSchema),
  job: jobProgressSchema.nullable(),
});

export const startUnsubscribeInputSchema = z.object({
  candidateIds: z.array(z.uuid()).min(1).max(500),
});

export const unsubscribeJobInputSchema = z.object({ jobId: z.uuid() });
export const retryUnsubscribeInputSchema = z.object({ jobId: z.uuid(), candidateIds: z.array(z.uuid()).min(1).max(500) }).strict();

export const unsubscribeProgressSchema = z.object({
  profileId: z.uuid(),
  dashboard: subscriptionDashboardSchema,
});

export type SubscriptionDashboard = z.infer<typeof subscriptionDashboardSchema>;
export type StartUnsubscribeInput = z.infer<typeof startUnsubscribeInputSchema>;
export type UnsubscribeJobInput = z.infer<typeof unsubscribeJobInputSchema>;
export type RetryUnsubscribeInput = z.infer<typeof retryUnsubscribeInputSchema>;
export type UnsubscribeProgress = z.infer<typeof unsubscribeProgressSchema>;
