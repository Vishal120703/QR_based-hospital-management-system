import { z } from 'zod';
import { periodShape } from '../../common/validation.js';

export const auditQuerySchema = z
  .object({
    ...periodShape,
    category: z
      .string()
      .regex(/^[a-zA-Z]+$/)
      .optional(),
    membershipId: z.string().uuid().optional(),
    targetId: z.string().uuid().optional(),
    before: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();
