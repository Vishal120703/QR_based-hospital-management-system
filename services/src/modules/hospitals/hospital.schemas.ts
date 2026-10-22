import { z } from 'zod';
import { atLeastOneField, hasFields, lineSchema, timezoneSchema } from '../../common/validation.js';
import { patientLanguages, staffNotificationTypes } from './hospital-settings.js';

export const updateHospitalSchema = z
  .object({
    name: lineSchema(2, 200).optional(),
    timezone: timezoneSchema.optional(),
  })
  .strict()
  .refine(hasFields, atLeastOneField);

const distinct = (values: readonly string[]) => new Set(values).size === values.length;

export const updateSettingsSchema = z
  .object({
    patientRequestsPaused: z.boolean().optional(),
    escalationsPaused: z.boolean().optional(),
    mutedNotificationTypes: z
      .array(z.enum(staffNotificationTypes))
      .refine(distinct, { message: 'Each notification type may be listed once.' })
      .optional(),
    patientLanguages: z
      .array(z.enum(patientLanguages))
      .refine(distinct, { message: 'Each language may be listed once.' })
      .refine((values) => values.includes('en'), { message: 'English is always offered.' })
      .optional(),
  })
  .strict()
  .refine(hasFields, atLeastOneField);

export const logoParamsSchema = z.object({ publicId: z.string().uuid() }).strict();

export type UpdateHospitalInput = z.infer<typeof updateHospitalSchema>;
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
