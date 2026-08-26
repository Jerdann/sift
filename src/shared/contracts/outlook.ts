import { z } from "zod";

export const outlookOAuthInputSchema = z
  .object({
    clientId: z.uuid(),
    tenant: z.enum(["common", "consumers", "organizations"]).default("common"),
  })
  .strict();

export const outlookConnectionSummarySchema = z.object({
  id: z.uuid(),
  email: z.email(),
  clientId: z.uuid(),
  tenant: z.string(),
  connectedAt: z.iso.datetime(),
  state: z.enum(["connected", "attention"]),
});
export const outlookDisconnectInputSchema = z
  .object({ connectionId: z.uuid() })
  .strict();
export const outlookAuditSummarySchema = z.object({
  connectionId: z.uuid(),
  state: z.enum(["idle", "scanning", "paused", "completed", "failed"]),
  indexedMessages: z.number().int().nonnegative(),
  totalEstimate: z.number().int().nonnegative(),
  earliestAt: z.iso.datetime().nullable(),
  latestAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime(),
});
export type OutlookOAuthInput = z.infer<typeof outlookOAuthInputSchema>;
export type OutlookConnectionSummary = z.infer<
  typeof outlookConnectionSummarySchema
>;
export type OutlookDisconnectInput = z.infer<
  typeof outlookDisconnectInputSchema
>;
export type OutlookAuditSummary = z.infer<typeof outlookAuditSummarySchema>;
