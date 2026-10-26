import { z } from 'zod';

/** Same length rules as every other password in the product (bcrypt truncates beyond 72 bytes). */
export const changeRequiredPasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(72),
    newPassword: z.string().min(8).max(72),
  })
  .refine((value) => value.newPassword !== value.currentPassword, {
    message: 'Choose a password different from the temporary one.',
    path: ['newPassword'],
  });
export type ChangeRequiredPasswordInput = z.infer<
  typeof changeRequiredPasswordSchema
>;
