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
export const nameSchema = z.string().trim().min(1).max(120);

export const booleanQuerySchema = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')
  .optional();

export const hasFields = (value: object) => Object.keys(value).length > 0;
export const atLeastOneField = { message: 'At least one field is required.' };
