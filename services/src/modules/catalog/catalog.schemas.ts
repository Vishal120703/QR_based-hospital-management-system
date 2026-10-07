import { z } from 'zod';
import {
  atLeastOneField,
  booleanQuerySchema,
  hasFields,
  nameSchema,
  uuidSchema,
} from '../../common/validation.js';

const descriptionSchema = z.string().trim().max(500).nullable().optional();
const sortOrderSchema = z.number().int().min(0).max(1000).optional();
const prioritySchema = z.enum(['NORMAL', 'HIGH', 'URGENT']);

const categoryFields = {
  name: nameSchema,
  description: descriptionSchema,
  sortOrder: sortOrderSchema,
  emergencyNotice: z.boolean().optional(),
};

// A service must name its department and SLA policy.
const serviceFields = {
  categoryId: uuidSchema,
  departmentId: uuidSchema,
  slaPolicyId: uuidSchema,
  escalationPolicyId: uuidSchema.nullable().optional(),
  name: nameSchema,
  description: descriptionSchema,
  priority: prioritySchema.optional(),
  sortOrder: sortOrderSchema,
};

export const categoryFilterSchema = z.object({ active: booleanQuerySchema }).strict();
export const createCategorySchema = z.object(categoryFields).strict();
export const updateCategorySchema = z
  .object({ ...categoryFields, name: nameSchema.optional(), active: z.boolean().optional() })
  .strict()
  .refine(hasFields, atLeastOneField);

export const serviceItemFilterSchema = z
  .object({
    categoryId: uuidSchema.optional(),
    departmentId: uuidSchema.optional(),
    active: booleanQuerySchema,
  })
  .strict();
export const createServiceItemSchema = z.object(serviceFields).strict();
export const updateServiceItemSchema = z
  .object(serviceFields)
  .partial()
  .extend({ active: z.boolean().optional() })
  .strict()
  .refine(hasFields, atLeastOneField);

export type CategoryFilter = z.infer<typeof categoryFilterSchema>;
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type ServiceItemFilter = z.infer<typeof serviceItemFilterSchema>;
export type CreateServiceItemInput = z.infer<typeof createServiceItemSchema>;
export type UpdateServiceItemInput = z.infer<typeof updateServiceItemSchema>;
