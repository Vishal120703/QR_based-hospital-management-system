import { z } from 'zod';
import {
  atLeastOneField,
  emptySchema,
  hasFields,
  nameSchema,
  uuidSchema,
} from '../../common/validation.js';

const acceptMinutesSchema = z.number().int().min(1).max(1440);
const completeMinutesSchema = z.number().int().min(1).max(10_080);

export const slaFilterSchema = emptySchema;

export const createSlaPolicySchema = z
  .object({
    name: nameSchema,
    acceptMinutes: acceptMinutesSchema,
    completeMinutes: completeMinutesSchema,
  })
  .strict();

export const updateSlaPolicySchema = z
  .object({
    name: nameSchema.optional(),
    acceptMinutes: acceptMinutesSchema.optional(),
    completeMinutes: completeMinutesSchema.optional(),
  })
  .strict()
  .refine(hasFields, atLeastOneField);

const levelSchema = z.discriminatedUnion('targetType', [
  z
    .object({ targetType: z.literal('ASSIGNEE'), afterMinutes: z.number().int().min(0).max(1440) })
    .strict(),
  z
    .object({
      targetType: z.literal('ROLE'),
      roleId: uuidSchema,
      afterMinutes: z.number().int().min(0).max(1440),
    })
    .strict(),
]);

// Each level must fire later than the one before it.
const levelsSchema = z
  .array(levelSchema)
  .min(1)
  .max(10)
  .refine(
    (levels) =>
      levels
        .slice(1)
        .every((level, index) => level.afterMinutes > (levels[index]?.afterMinutes ?? -1)),
    { message: 'Each escalation level must start later than the previous one.' },
  );

export const createEscalationPolicySchema = z
  .object({ name: nameSchema, levels: levelsSchema })
  .strict();

export const updateEscalationPolicySchema = z
  .object({ name: nameSchema.optional(), levels: levelsSchema.optional() })
  .strict()
  .refine(hasFields, atLeastOneField);

export type CreateSlaPolicyInput = z.infer<typeof createSlaPolicySchema>;
export type UpdateSlaPolicyInput = z.infer<typeof updateSlaPolicySchema>;
export type EscalationLevelInput = z.infer<typeof levelSchema>;
export type CreateEscalationPolicyInput = z.infer<typeof createEscalationPolicySchema>;
export type UpdateEscalationPolicyInput = z.infer<typeof updateEscalationPolicySchema>;
