import { z } from "zod";

export const appSettingsSchema = z
  .object({
    autoUpdateEnabled: z.boolean(),
    automaticUpdatesActive: z.boolean(),
    updatesSupported: z.boolean(),
    appVersion: z.string().min(1).max(64),
  })
  .strict();

export const updateAppSettingsInputSchema = z
  .object({
    autoUpdateEnabled: z.boolean(),
  })
  .strict();

export type AppSettings = z.infer<typeof appSettingsSchema>;
export type UpdateAppSettingsInput = z.infer<
  typeof updateAppSettingsInputSchema
>;
