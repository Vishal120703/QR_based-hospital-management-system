import { z } from 'zod';

const version = z.number().int().positive();
const reason = z.string().trim().min(1).max(500);
const simple = z.object({ expectedVersion: version }).strict();
const withReason = simple.extend({ reason }).strict();
const withAssignee = simple.extend({ assigneeId: z.string().uuid() }).strict();

// Each staff command and the body it takes. Every command names the request
// version it was based on, so a stale screen cannot overwrite newer work.
export const requestCommands = [
  { name: 'assign', permission: 'request.assign', schema: withAssignee },
  { name: 'accept', permission: 'request.accept', schema: simple },
  { name: 'start', permission: 'request.start', schema: simple },
  { name: 'complete', permission: 'request.complete', schema: simple },
  { name: 'close', permission: 'request.close', schema: simple },
  { name: 'cancel', permission: 'request.cancel', schema: withReason },
  { name: 'reject', permission: 'request.reject', schema: withReason },
  {
    name: 'transfer',
    permission: 'request.transfer',
    schema: withAssignee.extend({ reason }).strict(),
  },
] as const;

export type RequestCommand = (typeof requestCommands)[number]['name'];

export const submitRequestSchema = z.object({ serviceId: z.string().uuid() }).strict();

export const publicIdParamsSchema = z
  .object({ publicId: z.string().regex(/^CR-[A-F0-9]{16}$/) })
  .strict();

export const guestCancelSchema = z.object({ reason }).strict();
