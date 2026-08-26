import { z } from 'zod';
import { accountProviderSchema } from './accounts';
import { mailCategorySchema } from './analysis';
import { jobProgressSchema } from './jobs';

export const normalizedRuleCriteriaSchema = z.object({
  from: z.string().nullable(),
  to: z.string().nullable(),
  subject: z.string().nullable(),
  query: z.string().nullable(),
  negatedQuery: z.string().nullable(),
  hasAttachment: z.boolean().nullable(),
}).strict();

export const normalizedRuleActionSchema = z.object({
  addLabels: z.array(z.string()).max(32),
  removeLabels: z.array(z.string()).max(32),
}).strict();

export const providerRuleSnapshotSchema = z.object({
  providerRuleId: z.string().min(1).max(256),
  stableKey: z.string().length(64).nullable(),
  fingerprint: z.string().length(64),
  ownership: z.enum(['external', 'managed', 'adopted', 'exported']),
  criteria: normalizedRuleCriteriaSchema,
  action: normalizedRuleActionSchema,
});

export const ruleInventorySchema = z.object({
  id: z.uuid(),
  provider: accountProviderSchema,
  connectionId: z.uuid(),
  capability: z.enum(['live_api', 'managed_export']),
  capturedAt: z.iso.datetime(),
  providerLimit: z.number().int().positive().nullable(),
  containers: z.array(z.string().min(1).max(512)),
  rules: z.array(providerRuleSnapshotSchema),
});

export const desiredManagedRuleSchema = z.object({
  stableKey: z.string().length(64),
  fingerprint: z.string().length(64),
  senderDomain: z.string().min(1).max(253),
  receivingAddress: z.email().nullable(),
  category: mailCategorySchema,
  targetPath: z.string().min(1).max(192),
  markRead: z.boolean(),
  archive: z.boolean(),
  spam: z.boolean(),
  observedMessages: z.number().int().positive(),
  confidence: z.number().min(0).max(1),
});

export const ruleReconciliationOperationSchema = z.object({
  id: z.uuid(),
  stableKey: z.string().length(64),
  kind: z.enum(['create', 'replace', 'remove', 'adopt', 'unchanged']),
  desired: desiredManagedRuleSchema.nullable(),
  prior: providerRuleSnapshotSchema.nullable(),
  priorManaged: desiredManagedRuleSchema.nullable(),
  state: z.enum(['pending', 'running', 'succeeded', 'failed', 'verification_mismatch', 'undone']),
  providerRuleId: z.string().nullable(),
  errorCode: z.string().nullable(),
});

export const ruleReconciliationPlanSchema = z.object({
  id: z.uuid(),
  provider: accountProviderSchema,
  connectionId: z.uuid(),
  proposalId: z.uuid(),
  proposalRevision: z.string().length(64),
  inventoryId: z.uuid(),
  revision: z.string().length(64),
  state: z.enum(['draft', 'approved', 'executing', 'completed', 'failed', 'undone']),
  createdAt: z.iso.datetime(),
  approvedAt: z.iso.datetime().nullable(),
  operations: z.array(ruleReconciliationOperationSchema),
  job: jobProgressSchema.nullable(),
  undoJob: jobProgressSchema.nullable(),
});

export const ruleManagementScopeSchema = z.object({
  provider: accountProviderSchema,
  connectionId: z.uuid(),
  replaceExternalRules: z.boolean().optional(),
}).strict();

export const approveRulePlanSchema = z.object({
  planId: z.uuid(),
  revision: z.string().length(64),
}).strict();

export const retryRulePlanSchema = z.object({
  planId: z.uuid(),
  operationIds: z.array(z.uuid()).min(1).max(1_000),
}).strict();

export const undoRulePlanSchema = z.object({ planId: z.uuid() }).strict();

export const exportProtonRulePlanSchema = z.object({
  planId: z.uuid(),
  revision: z.string().length(64),
}).strict();

export const protonRuleExportResultSchema = z.object({
  canceled: z.boolean(),
  path: z.string().nullable(),
  checksum: z.string().length(64).nullable(),
  ruleCount: z.number().int().nonnegative(),
  plan: ruleReconciliationPlanSchema,
});

export type NormalizedRuleCriteria = z.infer<typeof normalizedRuleCriteriaSchema>;
export type NormalizedRuleAction = z.infer<typeof normalizedRuleActionSchema>;
export type ProviderRuleSnapshot = z.infer<typeof providerRuleSnapshotSchema>;
export type RuleInventory = z.infer<typeof ruleInventorySchema>;
export type DesiredManagedRule = z.infer<typeof desiredManagedRuleSchema>;
export type RuleReconciliationOperation = z.infer<typeof ruleReconciliationOperationSchema>;
export type RuleReconciliationPlan = z.infer<typeof ruleReconciliationPlanSchema>;
export type RuleManagementScope = z.infer<typeof ruleManagementScopeSchema>;
export type ApproveRulePlan = z.infer<typeof approveRulePlanSchema>;
export type RetryRulePlan = z.infer<typeof retryRulePlanSchema>;
export type UndoRulePlan = z.infer<typeof undoRulePlanSchema>;
export type ExportProtonRulePlan = z.infer<typeof exportProtonRulePlanSchema>;
export type ProtonRuleExportResult = z.infer<typeof protonRuleExportResultSchema>;
