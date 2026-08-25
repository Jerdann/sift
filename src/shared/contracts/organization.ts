import { z } from 'zod';
import { accountProviderSchema } from './accounts';
import { mailCategorySchema } from './analysis';

export const organizationProposalItemSchema = z.object({
  id: z.uuid(),
  scopeAddress: z.email().nullable(),
  containerName: z.string().nullable(),
  category: mailCategorySchema,
  targetPath: z.string().trim().min(1).max(192),
  enabled: z.boolean(),
  messageCount: z.number().int().positive(),
  latestAt: z.iso.datetime().nullable(),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string()).max(12),
  samples: z.array(z.string().max(240)).max(5),
});

export const organizationProposalSchema = z.object({
  id: z.uuid(),
  provider: accountProviderSchema,
  connectionId: z.uuid(),
  revision: z.string().length(64),
  state: z.enum(['draft', 'approved', 'superseded']),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  items: z.array(organizationProposalItemSchema),
});

export const organizationProposalScopeSchema = z.object({
  provider: accountProviderSchema,
  connectionId: z.uuid(),
}).strict();

export const editOrganizationProposalSchema = z.object({
  proposalId: z.uuid(),
  revision: z.string().length(64),
  itemId: z.uuid(),
  category: mailCategorySchema,
  targetPath: z.string().trim().min(1).max(192).regex(/^[^\\]+$/),
  enabled: z.boolean(),
}).strict();

export type OrganizationProposal = z.infer<typeof organizationProposalSchema>;
export type OrganizationProposalScope = z.infer<typeof organizationProposalScopeSchema>;
export type EditOrganizationProposal = z.infer<typeof editOrganizationProposalSchema>;
