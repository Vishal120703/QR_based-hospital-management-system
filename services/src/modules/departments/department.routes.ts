import { Router } from 'express';
import { z } from 'zod';
import {
  atLeastOneField,
  booleanQuerySchema,
  codeSchema,
  hasFields,
  nameSchema,
} from '../../common/validation.js';
import { registerResource } from '../../routes/resource-router.js';
import { type DepartmentService } from './department.service.js';

// Mounted under /admin. Departments are staff organization, so they use the
// staff permissions.
export function createDepartmentRouter(departments: DepartmentService): Router {
  const router = Router();
  registerResource(router, {
    path: '/departments',
    singular: 'department',
    plural: 'departments',
    readPermission: 'staff.read',
    managePermission: 'staff.manage',
    filterSchema: z.object({ active: booleanQuerySchema }).strict(),
    createSchema: z.object({ code: codeSchema, name: nameSchema }).strict(),
    updateSchema: z
      .object({
        code: codeSchema.optional(),
        name: nameSchema.optional(),
        active: z.boolean().optional(),
      })
      .strict()
      .refine(hasFields, atLeastOneField),
    list: (context, filter) => departments.list(context, filter),
    get: (context, id) => departments.get(context, id),
    create: (context, input, requestId) => departments.create(context, input, requestId),
    update: (context, id, input, requestId) => departments.update(context, id, input, requestId),
    remove: (context, id, requestId) => departments.delete(context, id, requestId),
  });
  return router;
}
