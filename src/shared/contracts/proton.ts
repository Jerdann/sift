import { z } from 'zod';

export const bridgeSecuritySchema = z.enum(['starttls', 'tls', 'plain']);
export const bridgeHostSchema = z.enum(['127.0.0.1', '::1', 'localhost']);

export const bridgeCredentialsSchema = z.object({
  host: bridgeHostSchema.default('127.0.0.1'),
  port: z.number().int().min(1).max(65_535),
  username: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(1_024),
  security: bridgeSecuritySchema,
});

export const bridgeDiagnosticCategorySchema = z.enum([
  'connected',
  'bridge_unavailable',
  'authentication_failed',
  'tls_failed',
  'connection_interrupted',
  'configuration_invalid',
]);

export const bridgeDiagnosticSchema = z.object({
  ok: z.boolean(),
  category: bridgeDiagnosticCategorySchema,
  message: z.string(),
  capabilityCount: z.number().int().nonnegative(),
  mailboxCount: z.number().int().nonnegative(),
});

export const protonConnectionSummarySchema = z.object({
  id: z.uuid(),
  host: bridgeHostSchema,
  port: z.number().int().min(1).max(65_535),
  username: z.string(),
  security: bridgeSecuritySchema,
  state: z.enum(['connected', 'attention']),
  lastConnectedAt: z.iso.datetime().nullable(),
  lastErrorCategory: bridgeDiagnosticCategorySchema.nullable(),
});

export const protonDisconnectInputSchema = z.object({
  connectionId: z.uuid(),
});

export const bridgeConnectResultSchema = z.object({
  diagnostic: bridgeDiagnosticSchema,
  connection: protonConnectionSummarySchema.nullable(),
});

export const protonMailboxSchema = z.object({
  id: z.uuid(),
  path: z.string().min(1),
  name: z.string().min(1),
  delimiter: z.string(),
  specialUse: z.string().nullable(),
  flags: z.array(z.string()),
  messageCount: z.number().int().nonnegative(),
  unreadCount: z.number().int().nonnegative(),
  uidValidity: z.string(),
  uidNext: z.number().int().nonnegative(),
});

export const protonAddressEvidenceSchema = z.object({
  address: z.email(),
  occurrenceCount: z.number().int().positive(),
  lastSeenAt: z.iso.datetime().nullable(),
  sources: z.array(z.enum(['delivered-to', 'x-original-to', 'to', 'cc', 'bcc'])),
});

export const protonDiscoverySummarySchema = z.object({
  connectionId: z.uuid(),
  discoveredAt: z.iso.datetime(),
  capabilities: z.array(z.string()),
  mailboxes: z.array(protonMailboxSchema),
  addresses: z.array(protonAddressEvidenceSchema),
  totalMessageEstimate: z.number().int().nonnegative(),
});

export type BridgeCredentials = z.infer<typeof bridgeCredentialsSchema>;
export type BridgeSecurity = z.infer<typeof bridgeSecuritySchema>;
export type BridgeDiagnostic = z.infer<typeof bridgeDiagnosticSchema>;
export type BridgeDiagnosticCategory = z.infer<typeof bridgeDiagnosticCategorySchema>;
export type ProtonConnectionSummary = z.infer<typeof protonConnectionSummarySchema>;
export type ProtonDisconnectInput = z.infer<typeof protonDisconnectInputSchema>;
export type BridgeConnectResult = z.infer<typeof bridgeConnectResultSchema>;
export type ProtonMailbox = z.infer<typeof protonMailboxSchema>;
export type ProtonAddressEvidence = z.infer<typeof protonAddressEvidenceSchema>;
export type ProtonDiscoverySummary = z.infer<typeof protonDiscoverySummarySchema>;
