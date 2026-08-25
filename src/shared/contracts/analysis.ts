import { z } from 'zod';
import { accountIdentityStatusSchema, identityEvidenceSourceSchema } from './accounts';

export const mailCategorySchema = z.enum([
  'personal', 'security', 'accounts', 'transactions', 'finance', 'shopping',
  'travel', 'games', 'subscriptions', 'promotions', 'social', 'suspicious', 'spam', 'other',
]);

export const categorySummarySchema = z.object({
  category: mailCategorySchema,
  label: z.string(),
  proposedFolder: z.string(),
  messageCount: z.number().int().nonnegative(),
  streamCount: z.number().int().nonnegative(),
  averageConfidence: z.number().min(0).max(1),
});

export const senderStreamSchema = z.object({
  senderDomain: z.string(),
  category: mailCategorySchema,
  receivingAddress: z.string(),
  messageCount: z.number().int().positive(),
  latestAt: z.iso.datetime().nullable(),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string()),
});

export const addressServiceSchema = z.object({
  address: z.string(),
  ownershipEvidence: z.enum(['provider_account', 'sent_and_received', 'sent', 'received']),
  canRetire: z.boolean(),
  sentFromCount: z.number().int().nonnegative(),
  deliveredToCount: z.number().int().nonnegative(),
  evidence: z.array(identityEvidenceSourceSchema),
  status: accountIdentityStatusSchema,
  containerEnabled: z.boolean(),
  containerName: z.string().nullable(),
  recommendation: z.enum(['retain', 'migrate', 'watch', 'consider_deactivation']),
  messageCount: z.number().int().nonnegative(),
  latestAt: z.iso.datetime().nullable(),
  importantCount: z.number().int().nonnegative(),
  services: z.array(z.object({
    domain: z.string(),
    messageCount: z.number().int().positive(),
    latestAt: z.iso.datetime().nullable(),
    categories: z.array(mailCategorySchema),
  })),
  rationale: z.string(),
});

export const mailboxAnalysisSummarySchema = z.object({
  connectionId: z.uuid(),
  analyzedAt: z.iso.datetime(),
  classifierVersion: z.string(),
  uniqueMessages: z.number().int().nonnegative(),
  categories: z.array(categorySummarySchema),
  topStreams: z.array(senderStreamSchema),
  addresses: z.array(addressServiceSchema),
});

export type MailCategory = z.infer<typeof mailCategorySchema>;
export type MailboxAnalysisSummary = z.infer<typeof mailboxAnalysisSummarySchema>;
export type SenderStream = z.infer<typeof senderStreamSchema>;
export type AddressService = z.infer<typeof addressServiceSchema>;
