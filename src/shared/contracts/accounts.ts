import { z } from 'zod';

export const accountProviderSchema = z.enum(['proton', 'gmail']);
export const accountIdentityStatusSchema = z.enum(['unreviewed', 'confirmed', 'rejected']);
export const identityEvidenceSourceSchema = z.enum([
  'provider_primary',
  'provider_alias',
  'sent_from',
  'delivered_to',
  'x_original_to',
]);

export const mailAccountSummarySchema = z.object({
  id: z.uuid(),
  provider: accountProviderSchema,
  label: z.string().min(1).max(320),
  state: z.enum(['connected', 'attention']),
  selected: z.boolean(),
  connectedAt: z.iso.datetime().nullable(),
});

export const accountSelectionInputSchema = z.object({
  provider: accountProviderSchema,
  connectionId: z.uuid(),
}).strict();

export const accountIdentitySummarySchema = z.object({
  id: z.uuid(),
  provider: accountProviderSchema,
  connectionId: z.uuid(),
  address: z.email(),
  evidence: z.array(identityEvidenceSourceSchema),
  sentFromCount: z.number().int().nonnegative(),
  deliveredToCount: z.number().int().nonnegative(),
  providerEvidence: z.boolean(),
  lastSeenAt: z.iso.datetime().nullable(),
  status: accountIdentityStatusSchema,
  containerEnabled: z.boolean(),
  containerName: z.string().min(1).max(64).nullable(),
  updatedAt: z.iso.datetime(),
});

export const accountIdentityListInputSchema = accountSelectionInputSchema;

export const accountIdentityUpdateInputSchema = z.object({
  provider: accountProviderSchema,
  connectionId: z.uuid(),
  address: z.email(),
  status: accountIdentityStatusSchema,
  containerEnabled: z.boolean(),
  containerName: z.string().trim().min(1).max(64).regex(/^[^\\/]+$/).nullable(),
}).strict().superRefine((input, context) => {
  if (input.containerEnabled && input.status !== 'confirmed') {
    context.addIssue({ code: 'custom', path: ['containerEnabled'], message: 'Only confirmed addresses can use a container' });
  }
  if (input.containerEnabled && !input.containerName) {
    context.addIssue({ code: 'custom', path: ['containerName'], message: 'A container name is required' });
  }
});

export type AccountProvider = z.infer<typeof accountProviderSchema>;
export type AccountIdentityStatus = z.infer<typeof accountIdentityStatusSchema>;
export type IdentityEvidenceSource = z.infer<typeof identityEvidenceSourceSchema>;
export type MailAccountSummary = z.infer<typeof mailAccountSummarySchema>;
export type AccountSelectionInput = z.infer<typeof accountSelectionInputSchema>;
export type AccountIdentitySummary = z.infer<typeof accountIdentitySummarySchema>;
export type AccountIdentityUpdateInput = z.infer<typeof accountIdentityUpdateInputSchema>;
