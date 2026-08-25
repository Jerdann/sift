import { z } from 'zod';
import { jobProgressSchema } from './jobs';

export const startProtonAuditInputSchema = z.object({
  extractBodies: z.boolean().default(false),
});

export const protonAuditJobInputSchema = z.object({ jobId: z.uuid() });

export const protonAuditFolderProgressSchema = z.object({
  path: z.string(),
  state: z.enum(['pending', 'running', 'succeeded', 'failed', 'skipped', 'verification_mismatch']),
  indexedCount: z.number().int().nonnegative(),
  messageEstimate: z.number().int().nonnegative(),
  earliestAt: z.iso.datetime().nullable(),
  latestAt: z.iso.datetime().nullable(),
  failureCount: z.number().int().nonnegative(),
});

export const protonAuditProgressSchema = z.object({
  profileId: z.uuid(),
  job: jobProgressSchema,
  extractBodies: z.boolean(),
  indexedMessages: z.number().int().nonnegative(),
  totalEstimate: z.number().int().nonnegative(),
  currentFolder: z.string().nullable(),
  earliestAt: z.iso.datetime().nullable(),
  latestAt: z.iso.datetime().nullable(),
  failureCount: z.number().int().nonnegative(),
  folders: z.array(protonAuditFolderProgressSchema),
});

export type StartProtonAuditInput = z.infer<typeof startProtonAuditInputSchema>;
export type ProtonAuditJobInput = z.infer<typeof protonAuditJobInputSchema>;
export type ProtonAuditProgress = z.infer<typeof protonAuditProgressSchema>;
