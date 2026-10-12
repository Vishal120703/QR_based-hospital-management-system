import { z } from 'zod';
import { booleanQuerySchema } from '../../common/validation.js';

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

// The work screens' three lists, and the statuses each one shows.
export const queueStatuses = {
  open: ['SUBMITTED', 'ASSIGNED', 'ACCEPTED', 'IN_PROGRESS'],
  completed: ['COMPLETED'],
  history: ['CLOSED', 'CANCELLED', 'REJECTED'],
} as const;
export type QueueView = keyof typeof queueStatuses;

// One page of a list (?view=open&page=2), optionally only one status or only
// overdue work.
export const requestQueueQuerySchema = z
  .object({
    id: z.string().uuid().optional(),
    view: z.enum(['open', 'completed', 'history']).default('open'),
    status: z
      .enum([
        'SUBMITTED',
        'ASSIGNED',
        'ACCEPTED',
        'IN_PROGRESS',
        'COMPLETED',
        'CLOSED',
        'CANCELLED',
        'REJECTED',
      ])
      .optional(),
    overdue: booleanQuerySchema,
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict()
  .refine(
    (query) =>
      !query.status || (queueStatuses[query.view] as readonly string[]).includes(query.status),
    { message: 'That status is not in this list.', path: ['status'] },
  )
  .refine((query) => !query.overdue || query.view === 'open', {
    message: 'Only open requests can be overdue.',
    path: ['overdue'],
  });
export type RequestQueueQuery = z.infer<typeof requestQueueQuerySchema>;

export const submitRequestSchema = z.object({ serviceId: z.string().uuid() }).strict();

export const publicIdParamsSchema = z
  .object({ publicId: z.string().regex(/^CR-[A-F0-9]{16}$/) })
  .strict();

export const guestCancelSchema = z.object({ reason }).strict();
