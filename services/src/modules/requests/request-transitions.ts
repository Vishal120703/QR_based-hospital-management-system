import { type Prisma, type RequestEventType, type RequestStatus } from '@prisma/client';
import { requestCommands, type RequestCommand } from './request.schemas.js';

// The request state machine, shared by staff commands, patient cancellation,
// and the SLA worker.

export type CommandInput = {
  readonly expectedVersion: number;
  readonly assigneeId?: string;
  readonly reason?: string;
};

// Which statuses each command starts from, the status it leads to, and the
// event it records.
export const transitions: Record<
  RequestCommand,
  { from: readonly RequestStatus[]; to: RequestStatus; event: RequestEventType }
> = {
  assign: { from: ['SUBMITTED'], to: 'ASSIGNED', event: 'ASSIGNED' },
  accept: { from: ['ASSIGNED'], to: 'ACCEPTED', event: 'ACCEPTED' },
  start: { from: ['ACCEPTED'], to: 'IN_PROGRESS', event: 'STARTED' },
  complete: { from: ['IN_PROGRESS'], to: 'COMPLETED', event: 'COMPLETED' },
  close: { from: ['COMPLETED'], to: 'CLOSED', event: 'CLOSED' },
  cancel: { from: ['SUBMITTED', 'ASSIGNED'], to: 'CANCELLED', event: 'CANCELLED' },
  reject: { from: ['ASSIGNED'], to: 'REJECTED', event: 'REJECTED' },
  transfer: { from: ['ACCEPTED', 'IN_PROGRESS'], to: 'ASSIGNED', event: 'TRANSFERRED' },
};

// The permission each command needs, as declared with its route.
export const commandPermissions = Object.fromEntries(
  requestCommands.map((command) => [command.name, command.permission]),
) as Record<RequestCommand, string>;

export const activeRequestStatuses: RequestStatus[] = [
  'SUBMITTED',
  'ASSIGNED',
  'ACCEPTED',
  'IN_PROGRESS',
];

// Open requests past the target that applies now: accept, then complete.
export function overdueWhere(now: Date): Prisma.ServiceRequestWhereInput {
  return {
    OR: [
      { status: { in: ['SUBMITTED', 'ASSIGNED'] }, acceptDueAt: { lt: now } },
      { status: { in: ['ACCEPTED', 'IN_PROGRESS'] }, completeDueAt: { lt: now } },
    ],
  };
}
