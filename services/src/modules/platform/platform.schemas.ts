import { z } from 'zod';
import {
  atLeastOneField,
  emailSchema,
  hasFields,
  lineSchema,
  loginPasswordSchema,
  newPasswordSchema,
  timezoneSchema,
} from '../../common/validation.js';

const person = {
  managerName: lineSchema(2, 120),
  managerEmail: emailSchema,
  managerPassword: newPasswordSchema,
};
const code = z
  .string()
  .trim()
  .min(2)
  .max(32)
  .regex(/^[A-Za-z0-9-]+$/);
const contact = {
  contactName: lineSchema(1, 120),
  contactEmail: emailSchema,
  contactPhone: z
    .string()
    .trim()
    .min(3)
    .max(40)
    .regex(/^[0-9+()\-. ]+$/),
};

export const platformLoginSchema = z
  .object({ email: emailSchema, password: loginPasswordSchema })
  .strict();

const newClientSchema = z
  .object({
    name: lineSchema(2, 200),
    code,
    contactName: contact.contactName.optional(),
    contactEmail: contact.contactEmail.optional(),
    contactPhone: contact.contactPhone.optional(),
  })
  .strict();

// A hospital for an existing client (clientId), for a new client (client),
// or, with neither, as its own new client.
export const createHospitalSchema = z
  .object({
    name: lineSchema(2, 200),
    code,
    timezone: timezoneSchema,
    ...person,
    clientId: z.string().uuid().optional(),
    client: newClientSchema.optional(),
  })
  .strict()
  .refine((value) => !(value.clientId && value.client), 'Choose an existing client or a new one.');

export const updateHospitalSchema = z
  .object({
    name: lineSchema(2, 200).optional(),
    timezone: timezoneSchema.optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
    clientId: z.string().uuid().optional(),
  })
  .strict()
  .refine(hasFields, atLeastOneField);

// Contact fields accept null to clear them.
export const updateClientSchema = z
  .object({
    name: lineSchema(2, 200).optional(),
    contactName: contact.contactName.nullable().optional(),
    contactEmail: contact.contactEmail.nullable().optional(),
    contactPhone: contact.contactPhone.nullable().optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  })
  .strict()
  .refine(hasFields, atLeastOneField);

export const addManagerSchema = z
  .object({
    displayName: person.managerName,
    email: person.managerEmail,
    password: person.managerPassword,
  })
  .strict();

export type CreateHospitalInput = z.infer<typeof createHospitalSchema>;
export type UpdateHospitalInput = z.infer<typeof updateHospitalSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
export type AddManagerInput = z.infer<typeof addManagerSchema>;
