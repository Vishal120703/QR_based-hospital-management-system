import { z } from 'zod';

export const uuidSchema = z.string().uuid();
export const idParamsSchema = z.object({ id: uuidSchema }).strict();
export const emptySchema = z.object({}).strict();

// Codes are case-insensitive identifiers printed on signage, stored uppercase.
export const codeSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
  .transform((value) => value.toUpperCase());
// One line of text such as a name: trimmed, and without control characters
// (they would break printed QR labels and CSV exports).
export const lineSchema = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .regex(/^[^\p{Cc}]*$/u);
export const nameSchema = lineSchema(1, 120);

export const emailSchema = z.string().trim().toLowerCase().email().max(320);
// A new password; sign-in only bounds its length, so older accounts still work.
export const newPasswordSchema = z.string().min(12).max(200);
export const loginPasswordSchema = z.string().min(1).max(1024);

export const booleanQuerySchema = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')
  .optional();

export const hasFields = (value: object) => Object.keys(value).length > 0;
export const atLeastOneField = { message: 'At least one field is required.' };

// Optional reporting period in a query string (?from=…&to=…).
export const dateRangeShape = {
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
};
// Use with .refine() on a schema built from dateRangeShape.
export const rangeInOrder = (value: { from?: Date | undefined; to?: Date | undefined }) =>
  !value.from || !value.to || value.from <= value.to;
export const rangeInOrderMessage = { message: 'The start must be before the end.' };

// An IANA time zone name such as "Asia/Kolkata".
export const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Choose a valid time zone, such as Asia/Kolkata.');
