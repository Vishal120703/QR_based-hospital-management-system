import { z } from 'zod';
import { InvalidInputError } from '../../common/errors/app-error.js';
import { addDays, dayIn, periodEnd, periodStart, startOfDay } from '../../common/time-zone.js';
import { periodShape } from '../../common/validation.js';
import { type ReportRange } from './report.service.js';

const dayMs = 24 * 60 * 60 * 1000;

export const reportQuerySchema = z.object(periodShape).strict();

export const requestLogQuerySchema = z
  .object({
    ...periodShape,
    outcome: z.enum(['open', 'completed', 'cancelled', 'rejected', 'overdue']).optional(),
    departmentId: z.string().uuid().optional(),
    membershipId: z.string().uuid().optional(),
    search: z.string().trim().max(100).optional(),
  })
  .strict();

// Days are the hospital's own (its time zone); the end day is included.
// Defaults to the last 7 days (today and the 6 before); at most a year at a
// time. A period in the future is allowed and simply has no requests.
export function reportRange(
  input: { from?: string | undefined; to?: string | undefined },
  timeZone: string,
  now = new Date(),
): ReportRange {
  const to = input.to ? periodEnd(input.to, timeZone) : now;
  const from = input.from
    ? periodStart(input.from, timeZone)
    : startOfDay(addDays(dayIn(now, timeZone), -6), timeZone);
  if (from >= to) throw new InvalidInputError('The start must be before the end.');
  if (to.getTime() - from.getTime() > 366 * dayMs) {
    throw new InvalidInputError('Choose a period of at most one year.');
  }
  return { from, to };
}
