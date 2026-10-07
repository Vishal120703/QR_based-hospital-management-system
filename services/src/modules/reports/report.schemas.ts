import { z } from 'zod';
import { InvalidInputError } from '../../common/errors/app-error.js';
import { dateRangeShape } from '../../common/validation.js';
import { type ReportRange } from './report.service.js';

const dayMs = 24 * 60 * 60 * 1000;

export const reportQuerySchema = z.object(dateRangeShape).strict();

export const requestLogQuerySchema = z
  .object({
    ...dateRangeShape,
    outcome: z.enum(['open', 'completed', 'cancelled', 'rejected', 'overdue']).optional(),
    departmentId: z.string().uuid().optional(),
    membershipId: z.string().uuid().optional(),
    search: z.string().trim().max(100).optional(),
  })
  .strict();

// Defaults to the last 7 days; at most a year at a time.
export function reportRange(input: {
  from?: Date | undefined;
  to?: Date | undefined;
}): ReportRange {
  const to = input.to ?? new Date();
  const from = input.from ?? new Date(to.getTime() - 7 * dayMs);
  if (from >= to) throw new InvalidInputError('The start must be before the end.');
  if (to.getTime() - from.getTime() > 366 * dayMs) {
    throw new InvalidInputError('Choose a period of at most one year.');
  }
  return { from, to };
}
