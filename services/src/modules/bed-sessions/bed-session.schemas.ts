import { z } from 'zod';

export const bedSessionFilterSchema = z
  .object({
    bedId: z.string().uuid().optional(),
    status: z.enum(['ACTIVE', 'CLOSED']).optional(),
  })
  .strict();

export const startBedSessionSchema = z.object({ bedId: z.string().uuid() }).strict();

export type BedSessionFilter = z.infer<typeof bedSessionFilterSchema>;
