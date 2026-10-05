import { Router } from 'express';
import { z } from 'zod';
import {
  atLeastOneField,
  booleanQuerySchema as activeQuerySchema,
  codeSchema,
  hasFields,
  nameSchema,
  uuidSchema,
} from '../../common/validation.js';
import { registerResource } from '../../routes/resource-router.js';
import { type LocationService } from './location.service.js';

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
