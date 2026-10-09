import { type Prisma, type PrismaClient, type RequestStatus } from '@prisma/client';
import { NotFoundError } from '../../common/errors/app-error.js';
import { type StaffContext } from '../auth/index.js';
import { requestAreaWhere } from '../requests/index.js';
import { ReportRepository } from './report.repository.js';

// Reports are rebuilt from each request's append-only event history, so they
// show who actually assigned, accepted, and completed work, even after a
// transfer, and why anything was not completed.

export interface ReportRange {
  readonly from: Date;
  readonly to: Date;
}

export interface LogFilter {
  readonly outcome?: 'open' | 'completed' | 'cancelled' | 'rejected' | 'overdue' | undefined;
  readonly departmentId?: string | undefined;
  readonly membershipId?: string | undefined;
  readonly search?: string | undefined;
}

const maxRequests = 20_000;
const maxLogRows = 2_000;
const openStatuses: RequestStatus[] = ['SUBMITTED', 'ASSIGNED', 'ACCEPTED', 'IN_PROGRESS'];

type Outcome = 'open' | 'completed' | 'cancelled' | 'rejected';

interface Actor {
  readonly type: 'GUEST' | 'STAFF' | 'SYSTEM';
  readonly membershipId: string | null;
  readonly name: string;
}

interface TimelineEvent {
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

const minutes = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / 60_000);
const average = (values: number[]) =>
  values.length === 0
    ? null
    : Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
const percent = (part: number, whole: number) =>
  whole === 0 ? null : Math.round((part / whole) * 1000) / 10;

function metadataId(metadata: Prisma.JsonValue, key: string): string | null {
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    const value = metadata[key];
    return typeof value === 'string' ? value : null;
  }
  return null;
}

export class ReportService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly reports = new ReportRepository(),
  ) {}

  // Requests submitted in the range, in the caller's report area, with their
  // full history and the names of everyone involved.
  public async requestFacts(
    context: StaffContext,
    range: ReportRange,
    now = new Date(),
  ): Promise<{ facts: RequestFacts[]; truncated: boolean }> {
    const area = requestAreaWhere(context, 'analytics.read');
    if (!area) return { facts: [], truncated: false };
    const where: Prisma.ServiceRequestWhereInput = {
      hospitalId: context.tenant.hospitalId,
      submittedAt: { gte: range.from, lt: range.to },
      ...(Object.keys(area).length > 0 ? { AND: [area] } : {}),
    };
    const rows = await this.reports.findRequestsWithHistory(this.database, where, maxRequests + 1);
    const truncated = rows.length > maxRequests;
    const requests = rows.slice(0, maxRequests);

    // Everyone mentioned: staff actors, assignees, and transfer sources.
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
    const people = await this.reports.findMemberNames(this.database, context.tenant.hospitalId, [
      ...membershipIds,
    ]);
    const nameOf = (id: string | null | undefined) =>
      id ? (people.find((person) => person.id === id)?.user.displayName ?? 'Former staff') : null;

    const facts = requests.map((request): RequestFacts => {
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
        minutesToAccept: request.acceptedAt
          ? minutes(request.submittedAt, request.acceptedAt)
          : null,
        minutesToComplete: request.completedAt
          ? minutes(request.submittedAt, request.completedAt)
          : null,
        involved: [...involved],
        events,
      };
    });
    return { facts, truncated };
  }

  public async requestReport(context: StaffContext, range: ReportRange, now = new Date()) {
    const { facts, truncated } = await this.requestFacts(context, range, now);
    const count = (predicate: (fact: RequestFacts) => boolean) => facts.filter(predicate).length;
    const accepted = facts.filter((fact) => fact.acceptedOnTime !== null);
    const completed = facts.filter((fact) => fact.completedOnTime !== null);

    const groupBy = (
      key: (fact: RequestFacts) => string,
      label: (fact: RequestFacts) => string,
    ) => {
      const groups = new Map<string, RequestFacts[]>();
      for (const fact of facts) groups.set(key(fact), [...(groups.get(key(fact)) ?? []), fact]);
      return [...groups.values()]
        .map((items) => ({
          id: key(items[0]!),
          name: label(items[0]!),
          total: items.length,
          completed: items.filter((fact) => fact.outcome === 'completed').length,
          open: items.filter((fact) => fact.outcome === 'open').length,
          cancelled: items.filter((fact) => fact.outcome === 'cancelled').length,
          rejected: items.filter((fact) => fact.outcome === 'rejected').length,
          overdue: items.filter((fact) => fact.overdueMinutes !== null).length,
          averageMinutesToComplete: average(
            items.flatMap((fact) =>
              fact.minutesToComplete === null ? [] : [fact.minutesToComplete],
            ),
          ),
        }))
        .sort((left, right) => right.total - left.total);
    };

    return {
      range,
      truncated,
      summary: {
        total: facts.length,
        open: count((fact) => fact.outcome === 'open'),
        completed: count((fact) => fact.outcome === 'completed'),
        cancelled: count((fact) => fact.outcome === 'cancelled'),
        cancelledByPatient: count(
          (fact) => fact.outcome === 'cancelled' && fact.endedByType === 'GUEST',
        ),
        rejected: count((fact) => fact.outcome === 'rejected'),
        overdueOpen: count((fact) => fact.overdueMinutes !== null),
        acceptedOnTimePercent: percent(
          accepted.filter((fact) => fact.acceptedOnTime).length,
          accepted.length,
        ),
        completedOnTimePercent: percent(
          completed.filter((fact) => fact.completedOnTime).length,
          completed.length,
        ),
        averageMinutesToAccept: average(
          facts.flatMap((fact) => (fact.minutesToAccept === null ? [] : [fact.minutesToAccept])),
        ),
        averageMinutesToComplete: average(
          facts.flatMap((fact) =>
            fact.minutesToComplete === null ? [] : [fact.minutesToComplete],
          ),
        ),
      },
      byDepartment: groupBy(
        (fact) => fact.departmentId,
        (fact) => fact.departmentName,
      ),
      byService: groupBy(
        (fact) => fact.serviceName,
        (fact) => fact.serviceName,
      ),
      byStaff: staffPerformance(facts).rows,
      notCompleted: facts
        .filter(
          (fact) =>
            fact.outcome === 'cancelled' ||
            fact.outcome === 'rejected' ||
            fact.overdueMinutes !== null,
        )
        .slice(0, 200)
        .map((fact) => ({
          id: fact.id,
          publicId: fact.publicId,
          serviceName: fact.serviceName,
          location: fact.location,
          status: fact.status,
          outcome: fact.overdueMinutes !== null ? 'overdue' : fact.outcome,
          submittedAt: fact.submittedAt,
          endedAt: fact.endedAt,
          endedBy: fact.endedBy,
          reason: fact.endReason,
          assigneeName: fact.assigneeName,
          overdueMinutes: fact.overdueMinutes,
        })),
    };
  }

  public async requestLog(
    context: StaffContext,
    range: ReportRange,
    filter: LogFilter,
    now = new Date(),
  ) {
    const { facts, truncated } = await this.requestFacts(context, range, now);
    const search = filter.search?.trim().toLowerCase();
    const rows = facts.filter(
      (fact) =>
        (!filter.outcome ||
          (filter.outcome === 'overdue'
            ? fact.overdueMinutes !== null
            : fact.outcome === filter.outcome)) &&
        (!filter.departmentId || fact.departmentId === filter.departmentId) &&
        (!filter.membershipId || fact.involved.includes(filter.membershipId)) &&
        (!search ||
          `${fact.publicId} ${fact.serviceName} ${fact.location}`.toLowerCase().includes(search)),
    );
    return {
      truncated: truncated || rows.length > maxLogRows,
      requests: rows.slice(0, maxLogRows).map(({ events, involved, ...row }) => {
        void events;
        void involved;
        return row;
      }),
    };
  }

  // One person's work in the period: the same figures as their row in the
  // hospital report, the hospital-wide averages to compare with, and every
  // action they took or that was given to them, newest first.
  public async personReport(
    context: StaffContext,
    membershipId: string,
    range: ReportRange,
    now = new Date(),
  ) {
    const { facts, truncated } = await this.requestFacts(context, range, now);
    const performance = staffPerformance(facts);
    let work = performance.rows.find((row) => row.membershipId === membershipId);
    if (!work) {
      // No work in this period: still a valid person of this hospital?
      const [member] = await this.reports.findMemberNames(
        this.database,
        context.tenant.hospitalId,
        [membershipId],
      );
      if (!member) throw new NotFoundError();
      work = emptyWork(membershipId, member.user.displayName);
    }
    return {
      range,
      truncated,
      person: { membershipId, name: work.name },
      work,
      hospital: performance.overall,
      people: performance.rows
        .map((row) => ({ membershipId: row.membershipId, name: row.name }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      activity: personActivity(facts, membershipId),
    };
  }

  // One request's full history, if it is in the caller's report area.
  public async requestTimeline(context: StaffContext, id: string, now = new Date()) {
    const area = requestAreaWhere(context, 'analytics.read');
    const request = area
      ? await this.reports.findSubmittedAt(this.database, {
          hospitalId: context.tenant.hospitalId,
          id,
          ...(Object.keys(area).length > 0 ? { AND: [area] } : {}),
        })
      : null;
    if (!request) throw new NotFoundError();
    const at = request.submittedAt;
    const { facts } = await this.requestFacts(
      context,
      { from: at, to: new Date(at.getTime() + 1) },
      now,
    );
    const fact = facts.find((item) => item.id === id);
    if (!fact) throw new NotFoundError();
    const { involved, ...rest } = fact;
    void involved;
    return rest;
  }
}

// Per person: work assigned to them and what they did with it, plus the
// assignments and closures they made as a manager. Counted by staff ID.
// `overall` is the same measures across everyone, for comparison.
function staffPerformance(facts: readonly RequestFacts[]) {
  interface Row {
    membershipId: string;
    name: string;
    assigned: number;
    accepted: number;
    completed: number;
    completedOnTime: number;
    rejected: number;
    transferredAway: number;
    openNow: number;
    assignmentsMade: number;
    closed: number;
    cancelled: number;
    acceptMinutes: number[];
    workMinutes: number[];
    rejectReasons: string[];
  }
  const rows = new Map<string, Row>();
  const row = (membershipId: string, name: string | null): Row => {
    let found = rows.get(membershipId);
    if (!found) {
      found = {
        membershipId,
        name: name ?? 'Former staff',
        assigned: 0,
        accepted: 0,
        completed: 0,
        completedOnTime: 0,
        rejected: 0,
        transferredAway: 0,
        openNow: 0,
        assignmentsMade: 0,
        closed: 0,
        cancelled: 0,
        acceptMinutes: [],
        workMinutes: [],
        rejectReasons: [],
      };
      rows.set(membershipId, found);
    }
    return found;
  };

  for (const fact of facts) {
    let assignedAt: Date | null = null;
    let acceptedAt: Date | null = null;
    for (const event of fact.events) {
      const actor = event.actor.membershipId
        ? row(event.actor.membershipId, event.actor.name)
        : null;
      switch (event.type) {
        case 'ASSIGNED':
        case 'TRANSFERRED':
          assignedAt = event.at;
          acceptedAt = null;
          if (actor) actor.assignmentsMade += 1;
          if (event.assigneeId) row(event.assigneeId, event.assigneeName).assigned += 1;
          if (event.type === 'TRANSFERRED' && event.previousAssigneeId) {
            row(event.previousAssigneeId, event.previousAssigneeName).transferredAway += 1;
          }
          break;
        case 'ACCEPTED':
          acceptedAt = event.at;
          if (actor) {
            actor.accepted += 1;
            if (assignedAt) actor.acceptMinutes.push(minutes(assignedAt, event.at));
          }
          break;
        case 'COMPLETED':
          if (actor) {
            actor.completed += 1;
            if (event.at <= fact.completeDueAt) actor.completedOnTime += 1;
            if (acceptedAt) actor.workMinutes.push(minutes(acceptedAt, event.at));
          }
          break;
        case 'REJECTED':
          if (actor) {
            actor.rejected += 1;
            if (event.reason) actor.rejectReasons.push(event.reason);
          }
          break;
        case 'CLOSED':
          if (actor) actor.closed += 1;
          break;
        case 'CANCELLED':
          if (actor) actor.cancelled += 1;
          break;
      }
    }
    if (fact.outcome === 'open' && fact.assigneeId) {
      row(fact.assigneeId, fact.assigneeName).openNow += 1;
    }
  }
  const everyone = [...rows.values()];
  const completedAll = everyone.reduce((sum, item) => sum + item.completed, 0);
  const overall = {
    averageMinutesToAccept: average(everyone.flatMap((item) => item.acceptMinutes)),
    averageMinutesOfWork: average(everyone.flatMap((item) => item.workMinutes)),
    completedOnTimePercent: percent(
      everyone.reduce((sum, item) => sum + item.completedOnTime, 0),
      completedAll,
    ),
  };
  return {
    overall,
    rows: everyone
      .map(({ acceptMinutes, workMinutes, rejectReasons, ...item }) => ({
        ...item,
        averageMinutesToAccept: average(acceptMinutes),
        averageMinutesOfWork: average(workMinutes),
        completedOnTimePercent: percent(item.completedOnTime, item.completed),
        rejectReasons: [...new Set(rejectReasons)].slice(0, 5),
      }))
      .sort(
        (left, right) =>
          right.assigned + right.assignmentsMade - (left.assigned + left.assignmentsMade) ||
          left.name.localeCompare(right.name),
      ),
  };
}

type StaffWork = ReturnType<typeof staffPerformance>['rows'][number];

function emptyWork(membershipId: string, name: string): StaffWork {
  return {
    membershipId,
    name,
    assigned: 0,
    accepted: 0,
    completed: 0,
    completedOnTime: 0,
    rejected: 0,
    transferredAway: 0,
    openNow: 0,
    assignmentsMade: 0,
    closed: 0,
    cancelled: 0,
    averageMinutesToAccept: null,
    averageMinutesOfWork: null,
    completedOnTimePercent: null,
    rejectReasons: [],
  };
}

export type ActivityKind =
  | 'assignedToThem'
  | 'accepted'
  | 'started'
  | 'completed'
  | 'rejected'
  | 'handedOver'
  | 'assignedOthers'
  | 'closed'
  | 'cancelled';

// Everything one person did, or that was given to them, newest first: what,
// when, on which request, with whom, how long it took, and whether on time.
function personActivity(facts: readonly RequestFacts[], membershipId: string) {
  const items: {
    kind: ActivityKind;
    at: Date;
    requestId: string;
    publicId: string;
    serviceName: string;
    location: string;
    // The other person: who assigned it to them, or whom they gave it to.
    otherName: string | null;
    // Minutes from being assigned to accepting, or from accepting to completing.
    minutes: number | null;
    onTime: boolean | null;
    reason: string | null;
  }[] = [];

  for (const fact of facts) {
    let assignedAt: Date | null = null;
    let acceptedAt: Date | null = null;
    const add = (
      kind: ActivityKind,
      at: Date,
      extra: Partial<Pick<(typeof items)[number], 'otherName' | 'minutes' | 'onTime' | 'reason'>>,
    ) =>
      items.push({
        kind,
        at,
        requestId: fact.id,
        publicId: fact.publicId,
        serviceName: fact.serviceName,
        location: fact.location,
        otherName: extra.otherName ?? null,
        minutes: extra.minutes ?? null,
        onTime: extra.onTime ?? null,
        reason: extra.reason ?? null,
      });

    for (const event of fact.events) {
      const byThem = event.actor.membershipId === membershipId;
      switch (event.type) {
        case 'ASSIGNED':
        case 'TRANSFERRED':
          assignedAt = event.at;
          acceptedAt = null;
          if (event.assigneeId === membershipId) {
            add('assignedToThem', event.at, { otherName: event.actor.name, reason: event.reason });
          }
          if (event.type === 'TRANSFERRED' && event.previousAssigneeId === membershipId) {
            add('handedOver', event.at, { otherName: event.assigneeName, reason: event.reason });
          }
          if (byThem) {
            add('assignedOthers', event.at, {
              otherName: event.assigneeName,
              reason: event.reason,
            });
          }
          break;
        case 'ACCEPTED':
          acceptedAt = event.at;
          if (byThem) {
            add('accepted', event.at, {
              minutes: assignedAt ? minutes(assignedAt, event.at) : null,
              onTime: event.at <= fact.acceptDueAt,
            });
          }
          break;
        case 'STARTED':
          if (byThem) add('started', event.at, {});
          break;
        case 'COMPLETED':
          if (byThem) {
            add('completed', event.at, {
              minutes: acceptedAt ? minutes(acceptedAt, event.at) : null,
              onTime: event.at <= fact.completeDueAt,
            });
          }
          break;
        case 'REJECTED':
          if (byThem) add('rejected', event.at, { reason: event.reason });
          break;
        case 'CLOSED':
          if (byThem) add('closed', event.at, {});
          break;
        case 'CANCELLED':
          if (byThem) add('cancelled', event.at, { reason: event.reason });
          break;
      }
    }
  }
  return items.sort((left, right) => right.at.getTime() - left.at.getTime());
}
