import { z } from 'zod';

export const profileDisplayNameSchema = z
  .string()
  .trim()
  .min(2, 'Enter at least 2 characters.')
  .max(80, 'Use 80 characters or fewer.')
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), {
    message: 'Control characters are not allowed.',
  });

export const profileSummarySchema = z.object({
  id: z.uuid(),
  displayName: profileDisplayNameSchema,
  createdAt: z.iso.datetime(),
  lastOpenedAt: z.iso.datetime().nullable(),
  providerCount: z.number().int().nonnegative(),
});

export const createProfileInputSchema = z.object({
  displayName: profileDisplayNameSchema,
});

export const selectProfileInputSchema = z.object({
  profileId: z.uuid(),
});

export type ProfileSummary = z.infer<typeof profileSummarySchema>;
export type CreateProfileInput = z.infer<typeof createProfileInputSchema>;
export type SelectProfileInput = z.infer<typeof selectProfileInputSchema>;
