import { z } from 'zod';
import { atLeastOneField, hasFields, lineSchema, timezoneSchema } from '../../common/validation.js';

export const updateHospitalSchema = z
  .object({
    name: lineSchema(2, 200).optional(),
    timezone: timezoneSchema.optional(),
  })
  .strict()
  .refine(hasFields, atLeastOneField);

export const logoParamsSchema = z.object({ publicId: z.string().uuid() }).strict();

export type UpdateHospitalInput = z.infer<typeof updateHospitalSchema>;
