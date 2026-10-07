import { z } from 'zod';
import {
  atLeastOneField,
  booleanQuerySchema as activeQuerySchema,
  codeSchema,
  hasFields,
  nameSchema,
  uuidSchema,
} from '../../common/validation.js';

const wardTypeSchema = z.enum([
  'GENERAL',
  'PRIVATE',
  'SEMI_PRIVATE',
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
  'ISOLATION',
  'PEDIATRIC_COT',
  'DAY_CARE_CHAIR',
  'DIALYSIS_CHAIR',
  'EMERGENCY_TROLLEY',
  'LABOUR',
  'OTHER',
]);
const levelSchema = z.number().int().min(-10).max(200);
// A prefix may be empty ("101") or end in a separator ("GW-", "GW ").
const prefixSchema = z
  .string()
  .trim()
  .max(16)
  .regex(/^([A-Za-z0-9][A-Za-z0-9._-]*)?$/);

// Buildings
export const buildingFilterSchema = z.object({ active: activeQuerySchema }).strict();
export const createBuildingSchema = z.object({ code: codeSchema, name: nameSchema }).strict();
export const updateBuildingSchema = z
  .object({
    code: codeSchema.optional(),
    name: nameSchema.optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine(hasFields, atLeastOneField);

// Floors
export const floorFilterSchema = z
  .object({ buildingId: uuidSchema.optional(), active: activeQuerySchema })
  .strict();
export const createFloorSchema = z
  .object({
    buildingId: uuidSchema.optional(),
    code: codeSchema,
    name: nameSchema,
    level: levelSchema.optional(),
  })
  .strict();
export const updateFloorSchema = z
  .object({
    code: codeSchema.optional(),
    name: nameSchema.optional(),
    level: levelSchema.nullable().optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine(hasFields, atLeastOneField);

// Wards (units)
export const wardFilterSchema = z
  .object({ floorId: uuidSchema.optional(), active: activeQuerySchema })
  .strict();
export const createWardSchema = z
  .object({
    floorId: uuidSchema,
    code: codeSchema,
    name: nameSchema,
    unitType: wardTypeSchema.optional(),
  })
  .strict();
export const updateWardSchema = z
  .object({
    code: codeSchema.optional(),
    name: nameSchema.optional(),
    unitType: wardTypeSchema.optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine(hasFields, atLeastOneField);

// Rooms
export const roomFilterSchema = z
  .object({ wardId: uuidSchema.optional(), active: activeQuerySchema })
  .strict();
export const createRoomSchema = z
  .object({
    wardId: uuidSchema,
    code: codeSchema,
    name: nameSchema,
    roomType: roomTypeSchema.optional(),
  })
  .strict();
export const updateRoomSchema = z
  .object({
    code: codeSchema.optional(),
    name: nameSchema.optional(),
    roomType: roomTypeSchema.optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine(hasFields, atLeastOneField);

// Beds. OCCUPIED is set only by bed sessions, never by hand.
export const bedFilterSchema = z
  .object({
    wardId: uuidSchema.optional(),
    roomId: uuidSchema.optional(),
    status: z.enum(['AVAILABLE', 'OCCUPIED', 'MAINTENANCE', 'INACTIVE']).optional(),
    active: activeQuerySchema,
  })
  .strict();
export const createBedSchema = z
  .object({
    wardId: uuidSchema,
    roomId: uuidSchema.optional(),
    code: codeSchema,
    displayName: nameSchema,
    bedType: bedTypeSchema.optional(),
  })
  .strict();
export const updateBedSchema = z
  .object({
    code: codeSchema.optional(),
    displayName: nameSchema.optional(),
    bedType: bedTypeSchema.optional(),
    status: z.enum(['AVAILABLE', 'MAINTENANCE', 'INACTIVE']).optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine(hasFields, atLeastOneField);

export const bulkBedsSchema = z.discriminatedUnion('mode', [
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

export type BuildingFilter = z.infer<typeof buildingFilterSchema>;
export type CreateBuildingInput = z.infer<typeof createBuildingSchema>;
export type UpdateBuildingInput = z.infer<typeof updateBuildingSchema>;
export type FloorFilter = z.infer<typeof floorFilterSchema>;
export type CreateFloorInput = z.infer<typeof createFloorSchema>;
export type UpdateFloorInput = z.infer<typeof updateFloorSchema>;
export type WardFilter = z.infer<typeof wardFilterSchema>;
export type CreateWardInput = z.infer<typeof createWardSchema>;
export type UpdateWardInput = z.infer<typeof updateWardSchema>;
export type RoomFilter = z.infer<typeof roomFilterSchema>;
export type CreateRoomInput = z.infer<typeof createRoomSchema>;
export type UpdateRoomInput = z.infer<typeof updateRoomSchema>;
export type BedFilter = z.infer<typeof bedFilterSchema>;
export type CreateBedInput = z.infer<typeof createBedSchema>;
export type UpdateBedInput = z.infer<typeof updateBedSchema>;
