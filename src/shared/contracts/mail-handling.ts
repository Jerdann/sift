import { z } from "zod";
import { accountProviderSchema } from "./accounts";
import { mailCategorySchema } from "./analysis";

export const categoryHandlingSchema = z
  .object({
    destination: z.enum(["file", "inbox", "spam", "trash"]),
    markRead: z.boolean(),
    retentionDays: z.number().int().min(1).max(3650).nullable(),
  })
  .strict();
export const handlingPreferencesSchema = z
  .object({
    detail: z.enum(["simple", "detailed"]).default("detailed"),
    strictness: z.enum(["clear", "broader"]).default("clear"),
    categories: z
      .partialRecord(mailCategorySchema, categoryHandlingSchema)
      .default({}),
  })
  .strict();
export const handlingScopeSchema = z
  .object({
    provider: accountProviderSchema,
    connectionId: z.uuid(),
    address: z.email().nullable().default(null),
    level: z.enum(["profile", "account", "alias"]).default("account"),
  })
  .strict();
export const handlingSaveSchema = handlingScopeSchema.extend({
  preferences: handlingPreferencesSchema,
  reset: z.boolean().optional(),
});
export const handlingPreviewInputSchema = handlingSaveSchema.extend({
  page: z.number().int().min(0).max(10000).default(0),
  category: mailCategorySchema.nullable().default(null),
});
export const handlingStateSchema = z.object({
  preferences: handlingPreferencesSchema,
  inherited: z.boolean(),
  revision: z.string(),
  aliases: z.array(z.email()),
});
export const handlingPreviewSchema = z.object({
  total: z.number(),
  matched: z.number(),
  held: z.number(),
  changed: z.number(),
  retention: z.number(),
  withBody: z.number(),
  classifierVersion: z.string(),
  groups: z.array(
    z.object({
      category: mailCategorySchema,
      count: z.number(),
      matched: z.number(),
      retention: z.number(),
      target: z.string(),
      action: z.string(),
      reasons: z.array(z.string()),
    }),
  ),
  examples: z.array(
    z.object({
      subject: z.string(),
      sender: z.string(),
      address: z.string().nullable(),
      category: mailCategorySchema,
      priorCategory: mailCategorySchema,
      source: z.string(),
      target: z.string(),
      action: z.string(),
      held: z.boolean(),
      reasons: z.array(z.string()),
    }),
  ),
  page: z.number(),
  pages: z.number(),
});
export type CategoryHandling = z.infer<typeof categoryHandlingSchema>;
export type HandlingPreferences = z.infer<typeof handlingPreferencesSchema>;
export type HandlingScope = z.infer<typeof handlingScopeSchema>;
export type HandlingSave = z.infer<typeof handlingSaveSchema>;
export type HandlingState = z.infer<typeof handlingStateSchema>;
export type HandlingPreview = z.infer<typeof handlingPreviewSchema>;
export type HandlingPreviewInput = z.infer<typeof handlingPreviewInputSchema>;
