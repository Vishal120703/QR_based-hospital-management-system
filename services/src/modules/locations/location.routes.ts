import { Router } from 'express';
import { z } from 'zod';
import {
  atLeastOneField,
  booleanQuerySchema as activeQuerySchema,
  codeSchema,
  hasFields,
  idParamsSchema,
  nameSchema,
  uuidSchema,
} from '../../common/validation.js';
import { ForbiddenError } from '../../common/errors/app-error.js';
import { getRequestId } from '../../middleware/request-id.js';
import { getStaffContext, requirePermission } from '../../middleware/staff-auth.js';
import { registerResource } from '../../routes/resource-router.js';
import { type LocationService } from './location.service.js';

const wardTypeSchema = z.enum([
  'GENERAL',
  'PRIVATE',
  'SEMI_PRIVATE',
  'ICU',
  'HDU',
  'CCU',
  'NICU',
  'PICU',
  'EMERGENCY',
  'DAY_CARE',
  'MATERNITY',
  'LABOUR_ROOM',
  'PEDIATRIC',
  'ISOLATION',
  'BURNS',
  'DIALYSIS',
  'RECOVERY',
  'PSYCHIATRY',
  'OTHER',
]);
const roomTypeSchema = z.enum([
  'GENERAL',
  'PRIVATE',
  'SEMI_PRIVATE',
  'DELUXE',
  'SUITE',
  'ISOLATION',
  'OTHER',
]);
const bedTypeSchema = z.enum([
  'STANDARD',
  'ICU',
  'VENTILATOR',
  'ISOLATION',
  'PEDIATRIC_COT',
  'NEONATAL',
  'DAY_CARE_CHAIR',
  'DIALYSIS_CHAIR',
  'EMERGENCY_TROLLEY',
  'LABOUR',
  'OTHER',
]);
const levelSchema = z.number().int().min(-10).max(200);
// A prefix may be empty ("101") or end in a separator ("ICU-", "GW ").
const prefixSchema = z
  .string()
  .trim()
  .max(16)
  .regex(/^([A-Za-z0-9][A-Za-z0-9._-]*)?$/);
const bulkBedsSchema = z.discriminatedUnion('mode', [
  z
    .object({
      mode: z.literal('BEDS'),
      roomId: uuidSchema.optional(),
      codePrefix: prefixSchema,
      namePrefix: z.string().trim().max(60),
      start: z.number().int().min(0).max(99_999),
      count: z.number().int().min(1).max(300),
      bedType: bedTypeSchema,
    })
    .strict(),
  z
    .object({
      mode: z.literal('ROOMS'),
      roomPrefix: prefixSchema,
      start: z.number().int().min(0).max(99_999),
      count: z.number().int().min(1).max(100),
      roomType: roomTypeSchema,
      bedsPerRoom: z.number().int().min(1).max(12),
      bedType: bedTypeSchema,
    })
    .strict(),
]);

const locationUpdateSchema = z
  .object({
    code: codeSchema.optional(),
    name: nameSchema.optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine(hasFields, atLeastOneField);

export function createLocationRouter(locations: LocationService): Router {
  const router = Router();

  registerResource(router, {
    path: '/buildings',
    readAnyScope: true,
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
    readAnyScope: true,
    singular: 'floor',
    plural: 'floors',
    readPermission: 'location.read',
    managePermission: 'location.manage',
    filterSchema: z
      .object({ buildingId: uuidSchema.optional(), active: activeQuerySchema })
      .strict(),
    createSchema: z
      .object({
        buildingId: uuidSchema.optional(),
        code: codeSchema,
        name: nameSchema,
        level: levelSchema.optional(),
      })
      .strict(),
    updateSchema: z
      .object({
        code: codeSchema.optional(),
        name: nameSchema.optional(),
        level: levelSchema.nullable().optional(),
        active: z.boolean().optional(),
      })
      .strict()
      .refine(hasFields, atLeastOneField),
    list: (context, filter) => locations.listFloors(context, filter),
    get: (context, id) => locations.getFloor(context, id),
    create: (context, input, requestId) => locations.createFloor(context, input, requestId),
    update: (context, id, input, requestId) => locations.updateFloor(context, id, input, requestId),
    remove: (context, id, requestId) => locations.deleteFloor(context, id, requestId),
  });

  registerResource(router, {
    path: '/wards',
    readAnyScope: true,
    singular: 'ward',
    plural: 'wards',
    readPermission: 'location.read',
    managePermission: 'location.manage',
    filterSchema: z.object({ floorId: uuidSchema.optional(), active: activeQuerySchema }).strict(),
    createSchema: z
      .object({
        floorId: uuidSchema,
        code: codeSchema,
        name: nameSchema,
        unitType: wardTypeSchema.optional(),
      })
      .strict(),
    updateSchema: z
      .object({
        code: codeSchema.optional(),
        name: nameSchema.optional(),
        unitType: wardTypeSchema.optional(),
        active: z.boolean().optional(),
      })
      .strict()
      .refine(hasFields, atLeastOneField),
    list: (context, filter) => locations.listWards(context, filter),
    get: (context, id) => locations.getWard(context, id),
    create: (context, input, requestId) => locations.createWard(context, input, requestId),
    update: (context, id, input, requestId) => locations.updateWard(context, id, input, requestId),
    remove: (context, id, requestId) => locations.deleteWard(context, id, requestId),
  });

  registerResource(router, {
    path: '/rooms',
    readAnyScope: true,
    singular: 'room',
    plural: 'rooms',
    readPermission: 'location.read',
    managePermission: 'location.manage',
    filterSchema: z.object({ wardId: uuidSchema.optional(), active: activeQuerySchema }).strict(),
    createSchema: z
      .object({
        wardId: uuidSchema,
        code: codeSchema,
        name: nameSchema,
        roomType: roomTypeSchema.optional(),
      })
      .strict(),
    updateSchema: z
      .object({
        code: codeSchema.optional(),
        name: nameSchema.optional(),
        roomType: roomTypeSchema.optional(),
        active: z.boolean().optional(),
      })
      .strict()
      .refine(hasFields, atLeastOneField),
    list: (context, filter) => locations.listRooms(context, filter),
    get: (context, id) => locations.getRoom(context, id),
    create: (context, input, requestId) => locations.createRoom(context, input, requestId),
    update: (context, id, input, requestId) => locations.updateRoom(context, id, input, requestId),
    remove: (context, id, requestId) => locations.deleteRoom(context, id, requestId),
  });

  const manualBedStatusSchema = z.enum(['AVAILABLE', 'MAINTENANCE', 'INACTIVE']);
  registerResource(router, {
    path: '/beds',
    readAnyScope: true,
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
        bedType: bedTypeSchema.optional(),
      })
      .strict(),
    updateSchema: z
      .object({
        code: codeSchema.optional(),
        displayName: nameSchema.optional(),
        bedType: bedTypeSchema.optional(),
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

  // Creating rooms as well as beds also needs the location permission.
  router.post(
    '/wards/:id/bulk-beds',
    requirePermission('bed.manage'),
    async (request, response) => {
      const { id } = idParamsSchema.parse(request.params);
      const input = bulkBedsSchema.parse(request.body);
      const context = getStaffContext(request);
      if (input.mode === 'ROOMS' && !context.hospitalPermissions.has('location.manage')) {
        throw new ForbiddenError();
      }
      const created = await locations.bulkCreateBeds(context, id, input, getRequestId(response));
      response.status(201).json(created);
    },
  );

  return router;
}
