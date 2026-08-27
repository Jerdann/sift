import { z } from "zod";
import { accountProviderSchema } from "./accounts";
import { mailCategorySchema } from "./analysis";

export const spamReviewDecisionSchema = z.enum([
  "review",
  "spam",
  "not_spam",
]);

export const spamReviewCandidateSchema = z.object({
  id: z.uuid(),
  senderDomain: z.string().min(1).max(253),
  receivingAddress: z.email(),
  category: mailCategorySchema,
  messageCount: z.number().int().positive(),
  latestAt: z.iso.datetime().nullable(),
  confidence: z.number().min(0).max(1),
  categoryShare: z.number().min(0).max(1),
  evidence: z.array(z.string()),
  reason: z.enum([
    "likely_spam",
    "suspicious",
    "bulk_mail",
    "filter_candidate",
  ]),
  decision: spamReviewDecisionSchema,
});

export const spamReviewSchema = z.object({
  id: z.uuid(),
  provider: accountProviderSchema,
  connectionId: z.uuid(),
  analysisId: z.string().min(1),
  revision: z.string().length(64),
  state: z.enum(["draft", "completed"]),
  createdAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  candidates: z.array(spamReviewCandidateSchema),
});

export const spamReviewScopeSchema = z
  .object({
    provider: accountProviderSchema,
    connectionId: z.uuid(),
  })
  .strict();

export const completeSpamReviewSchema = z
  .object({
    reviewId: z.uuid(),
    revision: z.string().length(64),
    decisions: z
      .array(
        z
          .object({
            candidateId: z.uuid(),
            decision: spamReviewDecisionSchema,
          })
          .strict(),
      )
      .max(5_000),
  })
  .strict();

export type SpamReviewDecision = z.infer<typeof spamReviewDecisionSchema>;
export type SpamReviewCandidate = z.infer<typeof spamReviewCandidateSchema>;
export type SpamReview = z.infer<typeof spamReviewSchema>;
export type SpamReviewScope = z.infer<typeof spamReviewScopeSchema>;
export type CompleteSpamReview = z.infer<typeof completeSpamReviewSchema>;
