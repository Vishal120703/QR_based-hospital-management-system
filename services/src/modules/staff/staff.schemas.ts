import { z } from 'zod';
import {
  emailSchema,
  lineSchema,
  newPasswordSchema,
  pageQueryShape,
  uuidSchema,
} from '../../common/validation.js';

export const staffListQuerySchema = z
  .object({
    status: z.enum(['ACTIVE', 'SUSPENDED', 'INACTIVE']).optional(),
    dutyStatus: z.enum(['ON_DUTY', 'OFF_DUTY']).optional(),
    departmentId: uuidSchema.optional(),
    search: z.string().trim().max(120).optional(),
    ...pageQueryShape,
  })
  .strict();

export const eligibleQuerySchema = z
  .object({ bedId: uuidSchema, departmentId: uuidSchema })
  .strict();

export const createStaffSchema = z
  .object({
    email: emailSchema,
    displayName: lineSchema(2, 120),
    password: newPasswordSchema,
  })
  .strict();

export const staffStatusSchema = z
  .object({ status: z.enum(['ACTIVE', 'SUSPENDED', 'INACTIVE']) })
  .strict();

// The temporary password an administrator gives someone who forgot theirs.
export const passwordResetSchema = z.object({ temporaryPassword: newPasswordSchema }).strict();

export const dutySchema = z.object({ dutyStatus: z.enum(['ON_DUTY', 'OFF_DUTY']) }).strict();

export const staffDepartmentSchema = z.object({ departmentId: uuidSchema }).strict();

export const coverageSchema = z.discriminatedUnion('scopeType', [
  z.object({ scopeType: z.literal('HOSPITAL') }).strict(),
  z.object({ scopeType: z.literal('FLOOR'), floorId: uuidSchema }).strict(),
  z.object({ scopeType: z.literal('WARD'), wardId: uuidSchema }).strict(),
]);

export const staffDepartmentParamsSchema = z
  .object({ id: uuidSchema, departmentId: uuidSchema })
  .strict();

export const coverageParamsSchema = z.object({ id: uuidSchema, coverageId: uuidSchema }).strict();

export type StaffFilter = z.infer<typeof staffListQuerySchema>;
export type CreateStaffInput = z.infer<typeof createStaffSchema>;
export type CoverageInput = z.infer<typeof coverageSchema>;
