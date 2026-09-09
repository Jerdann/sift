import { z } from "zod";
import { accountSelectionInputSchema } from "./accounts";

export { GROUP_COLORS } from "../../core/classification/group-colors";
export const groupColorSchema = z.enum([
  "blue",
  "red",
  "pink",
  "green",
  "purple",
  "yellow",
]);
const groupIdSchema = z.union([z.literal("main"), z.uuid()]);
export const addressGroupSchema = z
  .object({
    id: groupIdSchema,
    name: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[^\\/\x00-\x1f]+$/)
      .refine((v) => ![".", ".."].includes(v)),
    color: groupColorSchema,
    addresses: z.array(z.email().transform((v) => v.toLowerCase())),
  })
  .strict();
export const addressGroupsStateSchema = z.object({
  groups: z.array(addressGroupSchema),
  revision: z.string(),
});
export const saveAddressGroupsSchema = accountSelectionInputSchema
  .extend({
    revision: z.string(),
    groups: z.array(addressGroupSchema).min(1),
  })
  .strict();
export type AddressGroup = z.infer<typeof addressGroupSchema>;
export type GroupColor = z.infer<typeof groupColorSchema>;
export type AddressGroupsState = z.infer<typeof addressGroupsStateSchema>;
export type SaveAddressGroups = z.infer<typeof saveAddressGroupsSchema>;
export const copyAddressGroupChoicesSchema = accountSelectionInputSchema
  .extend({
    sourceId: groupIdSchema,
    targetIds: z.array(groupIdSchema).min(1),
    revision: z.string(),
  })
  .strict();
export type CopyAddressGroupChoices = z.infer<
  typeof copyAddressGroupChoicesSchema
>;
