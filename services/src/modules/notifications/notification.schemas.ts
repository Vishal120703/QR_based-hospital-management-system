import { z } from 'zod';

export const notificationQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    before: z.string().uuid().optional(),
    unread: z.enum(['true', 'false']).optional(),
  })
  .strict();
export const notificationId = z.object({ id: z.string().uuid() }).strict();
export const noInput = z.object({}).strict();
