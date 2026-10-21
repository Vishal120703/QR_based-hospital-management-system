import { type Prisma, type RequestStatus } from '@prisma/client';
import { type ReportRepository } from './report.repository.js';

// One fact per request, rebuilt from its append-only event history, so reports
// show who actually assigned, accepted, and completed work, even after a
// transfer, and why anything was not completed. Pure: no database access.

export type Outcome = 'open' | 'completed' | 'cancelled' | 'rejected';

export interface Actor {
  readonly type: 'GUEST' | 'STAFF' | 'SYSTEM';
  readonly membershipId: string | null;
  readonly name: string;
}

export interface TimelineEvent {
  readonly type: string;
  readonly at: Date;
  readonly actor: Actor;
  readonly reason: string | null;
  readonly assigneeId: string | null;
  readonly assigneeName: string | null;
  readonly previousAssigneeId: string | null;
  readonly previousAssigneeName: string | null;
}

export interface RequestFacts {
  readonly id: string;
  readonly publicId: string;
  readonly serviceName: string;
  readonly departmentId: string;
  readonly departmentName: string;
  readonly priority: string;
  readonly location: string;
  readonly bedName: string;
  readonly status: RequestStatus;
  readonly outcome: Outcome;
  readonly submittedAt: Date;
  readonly acceptDueAt: Date;
  readonly completeDueAt: Date;
  readonly assigneeId: string | null;
  readonly assigneeName: string | null;
  readonly assignedBy: string | null;
  readonly acceptedBy: string | null;
  readonly acceptedAt: Date | null;
  readonly completedBy: string | null;
  readonly completedAt: Date | null;
  readonly closedBy: string | null;
  readonly closedAt: Date | null;
  readonly endedBy: string | null;
  readonly endedByType: Actor['type'] | null;
  readonly endedAt: Date | null;
  readonly endReason: string | null;
  readonly acceptedOnTime: boolean | null;
  readonly completedOnTime: boolean | null;
  readonly overdueMinutes: number | null;
  readonly minutesToAccept: number | null;
  readonly minutesToComplete: number | null;
  readonly involved: readonly string[];
  readonly events: readonly TimelineEvent[];
}

// A request as the report query loads it, with its bed, place, and events.
export type RequestWithHistory = Awaited<
  ReturnType<ReportRepository['findRequestsWithHistory']>
>[number];

// Looks up a staff member's name; null for no ID.
export type NameOf = (id: string | null | undefined) => string | null;

const openStatuses: RequestStatus[] = ['SUBMITTED', 'ASSIGNED', 'ACCEPTED', 'IN_PROGRESS'];

export const minutes = (from: Date, to: Date) =>
  Math.round((to.getTime() - from.getTime()) / 60_000);

function metadataId(metadata: Prisma.JsonValue, key: string): string | null {
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    const value = metadata[key];
    return typeof value === 'string' ? value : null;
  }
  return null;
}

// Everyone mentioned: staff actors, assignees, and transfer sources.
export function mentionedPeople(requests: readonly RequestWithHistory[]): string[] {
  const membershipIds = new Set<string>();
  for (const request of requests) {
    if (request.assigneeId) membershipIds.add(request.assigneeId);
    for (const event of request.events) {
      if (event.actorType === 'STAFF' && event.actorId) membershipIds.add(event.actorId);
      for (const key of ['assigneeId', 'previousAssigneeId']) {
        const id = metadataId(event.metadata, key);
        if (id) membershipIds.add(id);
      }
    }
  }
  return [...membershipIds];
}

// The request's outcome, who assigned, accepted, completed, closed, or ended
// it, whether each step was on time, how overdue it is now, and its timeline.
export function toRequestFacts(
  request: RequestWithHistory,
  nameOf: NameOf,
  now: Date,
): RequestFacts {
  const events: TimelineEvent[] = request.events.map((event) => ({
    type: event.type,
    at: event.occurredAt,
    actor: {
      type: event.actorType,
      membershipId: event.actorType === 'STAFF' ? event.actorId : null,
      name:
        event.actorType === 'GUEST'
          ? 'Patient'
          : event.actorType === 'SYSTEM'
            ? 'System'
            : (nameOf(event.actorId) ?? 'Staff'),
    },
    reason: event.reason,
    assigneeId: metadataId(event.metadata, 'assigneeId'),
    assigneeName: nameOf(metadataId(event.metadata, 'assigneeId')),
    previousAssigneeId: metadataId(event.metadata, 'previousAssigneeId'),
    previousAssigneeName: nameOf(metadataId(event.metadata, 'previousAssigneeId')),
  }));
  const last = (...types: string[]) =>
    [...events].reverse().find((event) => types.includes(event.type));
  const assigned = last('ASSIGNED', 'TRANSFERRED');
  const accepted = last('ACCEPTED');
  const completed = last('COMPLETED');
  const closed = last('CLOSED');
  const ended = last('CANCELLED', 'REJECTED');
  const outcome: Outcome = openStatuses.includes(request.status)
    ? 'open'
    : request.status === 'CANCELLED'
      ? 'cancelled'
      : request.status === 'REJECTED'
        ? 'rejected'
        : 'completed';
  const deadline =
    request.status === 'SUBMITTED' || request.status === 'ASSIGNED'
      ? request.acceptDueAt
      : request.completeDueAt;
  const location = [
    request.bed.ward.floor.building?.name,
    request.bed.ward.floor.name,
    request.bed.ward.name,
    request.bed.room?.name,
    request.bed.displayName,
  ]
    .filter(Boolean)
    .join(' · ');
  const involved = new Set<string>();
  for (const event of events) {
    if (event.actor.membershipId) involved.add(event.actor.membershipId);
  }
  if (request.assigneeId) involved.add(request.assigneeId);
  for (const event of request.events) {
    const id = metadataId(event.metadata, 'assigneeId');
    if (id) involved.add(id);
  }
  return {
    id: request.id,
    publicId: request.publicId,
    serviceName: request.serviceName,
    departmentId: request.departmentId,
    departmentName: request.department.name,
    priority: request.priority,
    location,
    bedName: request.bed.displayName,
    status: request.status,
    outcome,
    submittedAt: request.submittedAt,
    acceptDueAt: request.acceptDueAt,
    completeDueAt: request.completeDueAt,
    assigneeId: request.assigneeId,
    assigneeName: nameOf(request.assigneeId),
    assignedBy: assigned?.actor.name ?? null,
    acceptedBy: accepted?.actor.name ?? null,
    acceptedAt: request.acceptedAt,
    completedBy: completed?.actor.name ?? null,
    completedAt: request.completedAt,
    closedBy: closed?.actor.name ?? null,
    closedAt: request.closedAt,
    endedBy: ended?.actor.name ?? null,
    endedByType: ended?.actor.type ?? null,
    endedAt: request.cancelledAt ?? request.rejectedAt,
    endReason: ended?.reason ?? null,
    acceptedOnTime: request.acceptedAt ? request.acceptedAt <= request.acceptDueAt : null,
    completedOnTime: request.completedAt ? request.completedAt <= request.completeDueAt : null,
    overdueMinutes: outcome === 'open' && now > deadline ? minutes(deadline, now) : null,
    minutesToAccept: request.acceptedAt ? minutes(request.submittedAt, request.acceptedAt) : null,
    minutesToComplete: request.completedAt
      ? minutes(request.submittedAt, request.completedAt)
      : null,
    involved: [...involved],
    events,
  };
}
