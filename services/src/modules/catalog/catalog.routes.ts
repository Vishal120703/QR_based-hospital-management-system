import { Router } from 'express';
import { z } from 'zod';
import {
  atLeastOneField,
  booleanQuerySchema,
  emptySchema,
  hasFields,
  nameSchema,
  uuidSchema,
} from '../../common/validation.js';
import { getGuestContext, requireGuestSession } from '../../middleware/guest-auth.js';
import { registerResource } from '../../routes/resource-router.js';
import { type GuestSessionService } from '../bed-sessions/guest-session.service.js';
import { type CategoryService } from './category.service.js';
import { type ServiceItemService } from './service-item.service.js';

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

// Mounted under /admin.
export function createCatalogRouter(
  categories: CategoryService,
  services: ServiceItemService,
): Router {
  const router = Router();

  registerResource(router, {
    path: '/service-categories',
    singular: 'serviceCategory',
    plural: 'serviceCategories',
    readPermission: 'service.read',
    managePermission: 'service.manage',
    filterSchema: z.object({ active: booleanQuerySchema }).strict(),
    createSchema: z.object(categoryFields).strict(),
    updateSchema: z
      .object({ ...categoryFields, name: nameSchema.optional(), active: z.boolean().optional() })
      .strict()
      .refine(hasFields, atLeastOneField),
    list: (context, filter) => categories.list(context, filter),
    get: (context, id) => categories.get(context, id),
    create: (context, input, requestId) => categories.create(context, input, requestId),
    update: (context, id, input, requestId) => categories.update(context, id, input, requestId),
    remove: (context, id, requestId) => categories.delete(context, id, requestId),
  });

  registerResource(router, {
    path: '/services',
    singular: 'service',
    plural: 'services',
    readPermission: 'service.read',
    managePermission: 'service.manage',
    filterSchema: z
      .object({
        categoryId: uuidSchema.optional(),
        departmentId: uuidSchema.optional(),
        active: booleanQuerySchema,
      })
      .strict(),
    createSchema: z.object(serviceFields).strict(),
    updateSchema: z
      .object(serviceFields)
      .partial()
      .extend({ active: z.boolean().optional() })
      .strict()
      .refine(hasFields, atLeastOneField),
    list: (context, filter) => services.list(context, filter),
    get: (context, id) => services.get(context, id),
    create: (context, input, requestId) => services.create(context, input, requestId),
    update: (context, id, input, requestId) => services.update(context, id, input, requestId),
    remove: (context, id, requestId) => services.delete(context, id, requestId),
  });

  return router;
}

// Mounted under /public: the service buttons a patient sees.
export function createPublicCatalogRouter(
  services: ServiceItemService,
  guestSessions: GuestSessionService,
): Router {
  const router = Router();
  router.get('/services', requireGuestSession(guestSessions), async (request, response) => {
    emptySchema.parse(request.query);
    response.status(200).json({ categories: await services.catalogFor(getGuestContext(request)) });
  });
  return router;
}
