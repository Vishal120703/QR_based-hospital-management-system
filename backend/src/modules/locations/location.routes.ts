import { Router } from 'express';
import { z } from 'zod';
import { getRequestId } from '../../middleware/request-id.js';
import { getStaffContext, requirePermission } from '../../middleware/staff-auth.js';
import { type StaffContext } from '../auth/auth.service.js';
import { type PermissionKey } from '../roles/permissions.js';
import { type LocationService } from './location.service.js';

const uuidSchema = z.string().uuid();
const idParamsSchema = z.object({ id: uuidSchema }).strict();
const emptyQuerySchema = z.object({}).strict();
const emptyBodySchema = z.object({}).strict();

// Codes are case-insensitive identifiers printed on signage, stored uppercase.
const codeSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
  .transform((value) => value.toUpperCase());
const nameSchema = z.string().trim().min(1).max(120);
const activeQuerySchema = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')
  .optional();
const hasFields = (value: object) => Object.keys(value).length > 0;
const atLeastOneField = { message: 'At least one field is required.' };

const locationUpdateSchema = z
  .object({
    code: codeSchema.optional(),
    name: nameSchema.optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine(hasFields, atLeastOneField);

interface ResourceDefinition<Filter, Create, Update> {
  readonly path: string;
  readonly singular: string;
  readonly plural: string;
  readonly readPermission: PermissionKey;
  readonly managePermission: PermissionKey;
  readonly filterSchema: z.ZodType<Filter, z.ZodTypeDef, unknown>;
  readonly createSchema: z.ZodType<Create, z.ZodTypeDef, unknown>;
  readonly updateSchema: z.ZodType<Update, z.ZodTypeDef, unknown>;
  list(context: StaffContext, filter: Filter): Promise<unknown>;
  get(context: StaffContext, id: string): Promise<unknown>;
  create(context: StaffContext, input: Create, requestId: string): Promise<unknown>;
  update(context: StaffContext, id: string, input: Update, requestId: string): Promise<unknown>;
  remove(context: StaffContext, id: string, requestId: string): Promise<void>;
}

function registerResource<Filter, Create, Update>(
  router: Router,
  resource: ResourceDefinition<Filter, Create, Update>,
): void {
  const itemPath = `${resource.path}/:id`;
  const canRead = requirePermission(resource.readPermission);
  const canManage = requirePermission(resource.managePermission);

  router.get(resource.path, canRead, async (request, response) => {
    const filter = resource.filterSchema.parse(request.query);
    const items = await resource.list(getStaffContext(request), filter);
    response.status(200).json({ [resource.plural]: items });
  });

  router.get(itemPath, canRead, async (request, response) => {
    const { id } = idParamsSchema.parse(request.params);
    emptyQuerySchema.parse(request.query);
    const item = await resource.get(getStaffContext(request), id);
    response.status(200).json({ [resource.singular]: item });
  });

  router.post(resource.path, canManage, async (request, response) => {
    const input = resource.createSchema.parse(request.body);
    const item = await resource.create(getStaffContext(request), input, getRequestId(response));
    response.status(201).json({ [resource.singular]: item });
  });

  router.patch(itemPath, canManage, async (request, response) => {
    const { id } = idParamsSchema.parse(request.params);
    const input = resource.updateSchema.parse(request.body);
    const item = await resource.update(getStaffContext(request), id, input, getRequestId(response));
    response.status(200).json({ [resource.singular]: item });
  });

  router.delete(itemPath, canManage, async (request, response) => {
    const { id } = idParamsSchema.parse(request.params);
    emptyBodySchema.parse(request.body ?? {});
    await resource.remove(getStaffContext(request), id, getRequestId(response));
    response.status(204).send();
  });
}

export function createLocationRouter(locations: LocationService): Router {
  const router = Router();

  registerResource(router, {
    path: '/buildings',
    singular: 'building',
    plural: 'buildings',
    readPermission: 'location.read',
    managePermission: 'location.manage',
    filterSchema: z.object({ active: activeQuerySchema }).strict(),
    createSchema: z.object({ code: codeSchema, name: nameSchema }).strict(),
    updateSchema: locationUpdateSchema,
    list: (context, filter) => locations.listBuildings(context, filter),
    get: (context, id) => locations.getBuilding(context, id),
    create: (context, input, requestId) => locations.createBuilding(context, input, requestId),
    update: (context, id, input, requestId) =>
      locations.updateBuilding(context, id, input, requestId),
    remove: (context, id, requestId) => locations.deleteBuilding(context, id, requestId),
  });

  registerResource(router, {
    path: '/floors',
    singular: 'floor',
    plural: 'floors',
    readPermission: 'location.read',
    managePermission: 'location.manage',
    filterSchema: z
      .object({ buildingId: uuidSchema.optional(), active: activeQuerySchema })
      .strict(),
    createSchema: z
      .object({ buildingId: uuidSchema.optional(), code: codeSchema, name: nameSchema })
      .strict(),
    updateSchema: locationUpdateSchema,
    list: (context, filter) => locations.listFloors(context, filter),
    get: (context, id) => locations.getFloor(context, id),
    create: (context, input, requestId) => locations.createFloor(context, input, requestId),
    update: (context, id, input, requestId) => locations.updateFloor(context, id, input, requestId),
    remove: (context, id, requestId) => locations.deleteFloor(context, id, requestId),
  });

  registerResource(router, {
    path: '/wards',
    singular: 'ward',
    plural: 'wards',
    readPermission: 'location.read',
    managePermission: 'location.manage',
    filterSchema: z.object({ floorId: uuidSchema.optional(), active: activeQuerySchema }).strict(),
    createSchema: z.object({ floorId: uuidSchema, code: codeSchema, name: nameSchema }).strict(),
    updateSchema: locationUpdateSchema,
    list: (context, filter) => locations.listWards(context, filter),
    get: (context, id) => locations.getWard(context, id),
    create: (context, input, requestId) => locations.createWard(context, input, requestId),
    update: (context, id, input, requestId) => locations.updateWard(context, id, input, requestId),
    remove: (context, id, requestId) => locations.deleteWard(context, id, requestId),
  });

  registerResource(router, {
    path: '/rooms',
    singular: 'room',
    plural: 'rooms',
    readPermission: 'location.read',
    managePermission: 'location.manage',
    filterSchema: z.object({ wardId: uuidSchema.optional(), active: activeQuerySchema }).strict(),
    createSchema: z.object({ wardId: uuidSchema, code: codeSchema, name: nameSchema }).strict(),
    updateSchema: locationUpdateSchema,
    list: (context, filter) => locations.listRooms(context, filter),
    get: (context, id) => locations.getRoom(context, id),
    create: (context, input, requestId) => locations.createRoom(context, input, requestId),
    update: (context, id, input, requestId) => locations.updateRoom(context, id, input, requestId),
    remove: (context, id, requestId) => locations.deleteRoom(context, id, requestId),
  });

  const manualBedStatusSchema = z.enum(['AVAILABLE', 'MAINTENANCE', 'INACTIVE']);
  registerResource(router, {
    path: '/beds',
    singular: 'bed',
    plural: 'beds',
    readPermission: 'bed.read',
    managePermission: 'bed.manage',
    filterSchema: z
      .object({
        wardId: uuidSchema.optional(),
        roomId: uuidSchema.optional(),
        status: z.enum(['AVAILABLE', 'OCCUPIED', 'MAINTENANCE', 'INACTIVE']).optional(),
        active: activeQuerySchema,
      })
      .strict(),
    createSchema: z
      .object({
        wardId: uuidSchema,
        roomId: uuidSchema.optional(),
        code: codeSchema,
        displayName: nameSchema,
      })
      .strict(),
    updateSchema: z
      .object({
        code: codeSchema.optional(),
        displayName: nameSchema.optional(),
        status: manualBedStatusSchema.optional(),
        active: z.boolean().optional(),
      })
      .strict()
      .refine(hasFields, atLeastOneField),
    list: (context, filter) => locations.listBeds(context, filter),
    get: (context, id) => locations.getBed(context, id),
    create: (context, input, requestId) => locations.createBed(context, input, requestId),
    update: (context, id, input, requestId) => locations.updateBed(context, id, input, requestId),
    remove: (context, id, requestId) => locations.deleteBed(context, id, requestId),
  });

  return router;
}
