import { Router } from 'express';
import { z } from 'zod';
import {
  atLeastOneField,
  emptySchema,
  hasFields,
  nameSchema,
  uuidSchema,
} from '../../common/validation.js';
import { registerResource } from '../../routes/resource-router.js';
import { type EscalationPolicyService } from './escalation-policy.service.js';
import { type SlaPolicyService } from './sla-policy.service.js';

const acceptMinutesSchema = z.number().int().min(1).max(1440);
const completeMinutesSchema = z.number().int().min(1).max(10_080);

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

// Mounted under /admin. Reading policies needs only service.read, because the
// catalog screens show them; changing them needs sla.manage.
export function createSlaRouter(
  slaPolicies: SlaPolicyService,
  escalationPolicies: EscalationPolicyService,
): Router {
  const router = Router();

  registerResource(router, {
    path: '/sla-policies',
    singular: 'slaPolicy',
    plural: 'slaPolicies',
    readPermission: 'service.read',
    managePermission: 'sla.manage',
    filterSchema: emptySchema,
    createSchema: z
      .object({
        name: nameSchema,
        acceptMinutes: acceptMinutesSchema,
        completeMinutes: completeMinutesSchema,
      })
      .strict(),
    updateSchema: z
      .object({
        name: nameSchema.optional(),
        acceptMinutes: acceptMinutesSchema.optional(),
        completeMinutes: completeMinutesSchema.optional(),
      })
      .strict()
      .refine(hasFields, atLeastOneField),
    list: (context) => slaPolicies.list(context),
    get: (context, id) => slaPolicies.get(context, id),
    create: (context, input, requestId) => slaPolicies.create(context, input, requestId),
    update: (context, id, input, requestId) => slaPolicies.update(context, id, input, requestId),
    remove: (context, id, requestId) => slaPolicies.delete(context, id, requestId),
  });

  registerResource(router, {
    path: '/escalation-policies',
    singular: 'escalationPolicy',
    plural: 'escalationPolicies',
    readPermission: 'service.read',
    managePermission: 'sla.manage',
    filterSchema: emptySchema,
    createSchema: z.object({ name: nameSchema, levels: levelsSchema }).strict(),
    updateSchema: z
      .object({ name: nameSchema.optional(), levels: levelsSchema.optional() })
      .strict()
      .refine(hasFields, atLeastOneField),
    list: (context) => escalationPolicies.list(context),
    get: (context, id) => escalationPolicies.get(context, id),
    create: (context, input, requestId) => escalationPolicies.create(context, input, requestId),
    update: (context, id, input, requestId) =>
      escalationPolicies.update(context, id, input, requestId),
    remove: (context, id, requestId) => escalationPolicies.delete(context, id, requestId),
  });

  return router;
}
