import { z } from 'zod';

export const exportRulePackInputSchema = z.object({
  format: z.enum(['proton-sieve', 'portable-json']),
  source: z.enum(['proton', 'gmail']),
}).strict();

export const exportRulePackResultSchema = z.object({
  canceled: z.boolean(),
  path: z.string().nullable(),
  ruleCount: z.number().int().nonnegative(),
});

export type ExportRulePackInput = z.infer<typeof exportRulePackInputSchema>;
export type ExportRulePackResult = z.infer<typeof exportRulePackResultSchema>;
