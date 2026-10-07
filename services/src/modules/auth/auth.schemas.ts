import { z } from 'zod';
import { emailSchema, loginPasswordSchema } from '../../common/validation.js';

export const loginSchema = z
  .object({
    hospitalCode: z
      .string()
      .trim()
      .min(2)
      .max(32)
      .regex(/^[A-Za-z0-9-]+$/),
    email: emailSchema,
    password: loginPasswordSchema,
  })
  .strict();
