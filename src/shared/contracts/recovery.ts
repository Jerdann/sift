import { z } from "zod";

export const diagnosticsSummarySchema = z.object({
  generatedAt: z.iso.datetime(),
  appVersion: z.string().min(1).max(40),
  platform: z.string().min(1).max(40),
  arch: z.string().min(1).max(40),
  encryptionAvailable: z.boolean(),
  schemaVersion: z.number().int().nonnegative(),
  integrity: z.enum(["ok", "failed"]),
  foreignKeyViolations: z.number().int().nonnegative(),
  databaseBytes: z.number().int().nonnegative(),
  providers: z.object({
    proton: z.number().int().nonnegative(),
    gmail: z.number().int().nonnegative(),
    outlook: z.number().int().nonnegative(),
  }),
  indexedMessages: z.object({
    proton: z.number().int().nonnegative(),
    gmail: z.number().int().nonnegative(),
    outlook: z.number().int().nonnegative(),
  }),
  jobs: z.object({
    pending: z.number().int().nonnegative(),
    running: z.number().int().nonnegative(),
    succeeded: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    verificationMismatch: z.number().int().nonnegative(),
  }),
});
export const diagnosticsExportResultSchema = z.object({
  canceled: z.boolean(),
  path: z.string().nullable(),
});
export const backupResultSchema = z.object({
  canceled: z.boolean(),
  path: z.string().nullable(),
  createdAt: z.iso.datetime().nullable(),
  bytes: z.number().int().nonnegative(),
});
export const restoreProfileInputSchema = z
  .object({ confirmation: z.literal("RESTORE LOCAL PROFILE") })
  .strict();
export const restoreResultSchema = z.object({
  restoredAt: z.iso.datetime(),
  databaseBytes: z.number().int().nonnegative(),
  secretFiles: z.number().int().nonnegative(),
});
export const rebuildIndexInputSchema = z
  .object({ confirmation: z.literal("REBUILD LOCAL INDEX") })
  .strict();
export const rebuildIndexResultSchema = z.object({
  rebuiltAt: z.iso.datetime(),
  clearedMessages: z.number().int().nonnegative(),
  preservedConnections: z.number().int().nonnegative(),
  preservedManagedRules: z.number().int().nonnegative(),
});

export type DiagnosticsSummary = z.infer<typeof diagnosticsSummarySchema>;
export type DiagnosticsExportResult = z.infer<
  typeof diagnosticsExportResultSchema
>;
export type BackupResult = z.infer<typeof backupResultSchema>;
export type RestoreProfileInput = z.infer<typeof restoreProfileInputSchema>;
export type RestoreResult = z.infer<typeof restoreResultSchema>;
export type RebuildIndexInput = z.infer<typeof rebuildIndexInputSchema>;
export type RebuildIndexResult = z.infer<typeof rebuildIndexResultSchema>;
