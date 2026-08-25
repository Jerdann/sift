import { z } from 'zod';

export const gmailOAuthInputSchema = z.object({
  clientId: z.string().trim().min(20).max(512).regex(/\.apps\.googleusercontent\.com$/),
  clientSecret: z.string().trim().max(512).optional(),
}).strict();

export const gmailConnectionSummarySchema = z.object({
  id: z.uuid(),
  email: z.email(),
  clientId: z.string(),
  connectedAt: z.iso.datetime(),
  state: z.enum(['connected', 'attention']),
});

export const gmailDisconnectInputSchema = z.object({ connectionId: z.uuid() }).strict();

export const gmailAuditSummarySchema = z.object({
  connectionId: z.uuid(),
  state: z.enum(['idle', 'scanning', 'paused', 'completed', 'failed']),
  indexedMessages: z.number().int().nonnegative(),
  totalEstimate: z.number().int().nonnegative(),
  earliestAt: z.iso.datetime().nullable(),
  latestAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime(),
});

export type GmailOAuthInput = z.infer<typeof gmailOAuthInputSchema>;
export type GmailConnectionSummary = z.infer<typeof gmailConnectionSummarySchema>;
export type GmailDisconnectInput = z.infer<typeof gmailDisconnectInputSchema>;
export type GmailAuditSummary = z.infer<typeof gmailAuditSummarySchema>;
