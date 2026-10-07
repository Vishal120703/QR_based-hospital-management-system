import { z } from 'zod';
import { atLeastOneField, hasFields, lineSchema } from '../../common/validation.js';

export const createRoleSchema = z
  .object({
    name: lineSchema(2, 100),
    description: z.string().trim().max(500).nullable().optional(),
    active: z.boolean().optional(),
    scopeLevel: z.enum(['HOSPITAL', 'FLOOR', 'WARD', 'DEPARTMENT']).optional(),
    permissionKeys: z.array(z.string().min(1).max(64)).max(100).optional(),
  })
  .strict();

export const updateRoleSchema = createRoleSchema.partial().refine(hasFields, atLeastOneField);

// scopeId is the floor, ward, or department for roles at those levels.
export const assignRoleSchema = z
  .object({ roleId: z.string().uuid(), scopeId: z.string().uuid().optional() })
  .strict();

export const unassignRoleParamsSchema = z
  .object({
    id: z.string().uuid(),
    roleId: z.string().uuid(),
    scopeId: z.string().uuid().optional(),
  })
  .strict();

export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
