import { z } from 'zod';
import {
  atLeastOneField,
  booleanQuerySchema,
  codeSchema,
  hasFields,
  nameSchema,
} from '../../common/validation.js';

export const departmentFilterSchema = z.object({ active: booleanQuerySchema }).strict();

export const createDepartmentSchema = z.object({ code: codeSchema, name: nameSchema }).strict();

export const updateDepartmentSchema = z
  .object({
    code: codeSchema.optional(),
    name: nameSchema.optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine(hasFields, atLeastOneField);

export type DepartmentFilter = z.infer<typeof departmentFilterSchema>;
export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;
