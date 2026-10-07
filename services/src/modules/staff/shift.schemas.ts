import { z } from 'zod';
import {
  dateRangeShape,
  rangeInOrder,
  rangeInOrderMessage,
  uuidSchema,
} from '../../common/validation.js';

const maxShiftMs = 24 * 60 * 60 * 1000;

export const shiftQuerySchema = z
  .object({ membershipId: uuidSchema.optional(), ...dateRangeShape })
  .strict()
  .refine(rangeInOrder, rangeInOrderMessage);

export const createShiftSchema = z
  .object({
    membershipId: uuidSchema,
    departmentId: uuidSchema.optional(),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
  })
  .strict()
  .refine((shift) => shift.endsAt > shift.startsAt, {
    message: 'A shift must end after it starts.',
  })
  .refine((shift) => shift.endsAt.getTime() - shift.startsAt.getTime() <= maxShiftMs, {
    message: 'A shift can be at most 24 hours.',
  });

export type ShiftFilter = z.infer<typeof shiftQuerySchema>;
export type CreateShiftInput = z.infer<typeof createShiftSchema>;
