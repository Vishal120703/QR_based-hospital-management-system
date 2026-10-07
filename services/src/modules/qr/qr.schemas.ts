import { z } from 'zod';

const uuid = z.string().uuid();

export const qrListQuerySchema = z.object({ bedId: uuid.optional() }).strict();

export const resolveQrSchema = z.object({ token: z.string().min(1).max(256) }).strict();

export const qrBatchSchema = z
  .object({
    scope: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('HOSPITAL') }).strict(),
      z.object({ kind: z.enum(['BUILDING', 'FLOOR', 'WARD', 'ROOM']), id: uuid }).strict(),
      z.object({ kind: z.literal('BEDS'), bedIds: z.array(uuid).min(1).max(300) }).strict(),
    ]),
    replaceExisting: z.boolean().default(false),
  })
  .strict();
