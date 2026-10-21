import { type Prisma, type PrismaClient, type RequestStatus } from '@prisma/client';
import { ForbiddenError, NotFoundError } from '../../common/errors/app-error.js';
import { dayIn, startOfDay } from '../../common/time-zone.js';
import { type StaffContext } from '../auth/index.js';
import { type EscalationRepository } from './escalation.repository.js';
import { visibleRequestsWhere } from './request-scope.js';
import { overdueWhere } from './request-transitions.js';
import { type RequestRepository } from './request.repository.js';
import { queueStatuses, type QueueView, type RequestQueueQuery } from './request.schemas.js';

const oldestFirst: Prisma.ServiceRequestOrderByWithRelationInput[] = [
  { submittedAt: 'asc' },
  { id: 'asc' },
];
const queueOrder: Record<QueueView, Prisma.ServiceRequestOrderByWithRelationInput[]> = {
  open: oldestFirst,
  // Waiting longest to be closed first.
  completed: [{ completedAt: 'asc' }, { id: 'asc' }],
  history: [{ submittedAt: 'desc' }, { id: 'desc' }],
};

const emptyCounts = {
  open: 0,
  waiting: 0,
  overdue: 0,
  completed: 0,
  history: 0,
  completedToday: 0,
};

// What staff read: the work lists with their counts, alerts, one request, and
// its history. Everything is limited to the requests the caller may see.
export class RequestQueryService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly requests: RequestRepository,
    private readonly escalationSteps: EscalationRepository,
  ) {}

  // One page of a work list in the caller's area, with every list's count.
  // Open work comes overdue first, then the rest, oldest first within each,
  // so no outstanding request hides behind newer ones however many there are.
  public async list(context: StaffContext, query: RequestQueueQuery, now = new Date()) {
    if (!context.permissions.has('request.read')) throw new ForbiddenError();
    const { view, status, overdue, page, pageSize } = query;
    const visible = visibleRequestsWhere(context);
    if (!visible) {
      return { serviceRequests: [], page, pageSize, total: 0, counts: emptyCounts };
    }
    const inView: Prisma.ServiceRequestWhereInput = {
      AND: [
        visible,
        ...(query.id
          ? [{ id: query.id }]
          : [{ status: { in: status ? [status] : [...queueStatuses[view]] } }]),
        ...(overdue ? [overdueWhere(now)] : []),
      ],
    };
    const skip = (page - 1) * pageSize;
    const db = this.database;
    const pageOf = (where: Prisma.ServiceRequestWhereInput, from: number, take: number) =>
      this.requests.pageWithBed(db, where, queueOrder[view], from, take);

    let total: number;
    let rows: Awaited<ReturnType<typeof pageOf>>;
    if (view === 'open' && !overdue) {
      const late = { AND: [inView, overdueWhere(now)] };
      const onTime = { AND: [inView, { NOT: overdueWhere(now) }] };
      const [lateCount, onTimeCount] = await Promise.all([
        this.requests.count(db, late),
        this.requests.count(db, onTime),
      ]);
      total = lateCount + onTimeCount;
      const first = skip < lateCount ? await pageOf(late, skip, pageSize) : [];
      const left = pageSize - first.length;
      const rest = left > 0 ? await pageOf(onTime, Math.max(0, skip - lateCount), left) : [];
      rows = [...first, ...rest];
    } else {
      [total, rows] = await Promise.all([
        this.requests.count(db, inView),
        pageOf(inView, skip, pageSize),
      ]);
    }
    return {
      serviceRequests: rows.map(({ bed, assignee, ...request }) => ({
        ...request,
        bed: { code: bed.code, displayName: bed.displayName },
        assigneeName: assignee?.user.displayName ?? null,
      })),
      page,
      pageSize,
      total,
      counts: await this.queueCounts(visible, context.tenant.timezone, now),
    };
  }

  // What needs this person's attention now, newest first in each kind: new
  // requests waiting for someone to be assigned (only people who assign see
  // these), overdue work they can see, and escalations sent to them (a role
  // they hold, or work assigned to them) that still apply. Each alert has a
  // stable key, so the screen alerts once per new item. At most 20 per kind;
  // the counts are complete.
  public async alerts(context: StaffContext, now = new Date()) {
    if (!context.permissions.has('request.read')) throw new ForbiddenError();
    const visible = visibleRequestsWhere(context);
    if (!visible) return { counts: { waiting: 0, overdue: 0, escalated: 0 }, alerts: [] };
    const db = this.database;
    const take = 20;
    const waitingWhere: Prisma.ServiceRequestWhereInput = {
      AND: [visible, { status: 'SUBMITTED' }],
    };
    const overdueVisible: Prisma.ServiceRequestWhereInput = { AND: [visible, overdueWhere(now)] };
    const [waiting, waitingCount, overdue, overdueCount, [escalations, escalatedCount]] =
      await Promise.all([
        this.requests.pageWithBed(db, waitingWhere, queueOrder.history, 0, take),
        this.requests.count(db, waitingWhere),
        this.requests.pageWithBed(db, overdueVisible, oldestFirst, 0, take),
        this.requests.count(db, overdueVisible),
        this.escalationSteps.findCurrentFor(
          db,
          context.tenant.hospitalId,
          visible,
          { membershipId: context.membershipId, roleIds: context.roleIds },
          take,
        ),
      ]);
    const waitingOnAccept = (status: RequestStatus) =>
      status === 'SUBMITTED' || status === 'ASSIGNED';
    return {
      counts: { waiting: waitingCount, overdue: overdueCount, escalated: escalatedCount },
      alerts: [
        ...escalations.map((step) => ({
          key: `escalated:${step.id}`,
          kind: 'escalated' as const,
          requestId: step.request.id,
          publicId: step.request.publicId,
          serviceName: step.request.serviceName,
          bed: step.request.bed.displayName,
          at: step.createdAt,
          deadline: step.stage === 'ACCEPT' ? ('accept' as const) : ('complete' as const),
          level: step.level,
        })),
        ...overdue.map((request) => {
          const deadline = waitingOnAccept(request.status) ? 'accept' : 'complete';
          return {
            key: `overdue:${request.id}:${deadline}`,
            kind: 'overdue' as const,
            requestId: request.id,
            publicId: request.publicId,
            serviceName: request.serviceName,
            bed: request.bed.displayName,
            at: deadline === 'accept' ? request.acceptDueAt : request.completeDueAt,
            deadline,
            level: null,
          };
        }),
        ...waiting.map((request) => ({
          key: `new:${request.id}`,
          kind: 'new' as const,
          requestId: request.id,
          publicId: request.publicId,
          serviceName: request.serviceName,
          bed: request.bed.displayName,
          at: request.submittedAt,
          deadline: null,
          level: null,
        })),
      ],
    };
  }

  public async get(context: StaffContext, id: string) {
    if (!context.permissions.has('request.read')) throw new ForbiddenError();
    const where = visibleRequestsWhere(context);
    const request = where
      ? await this.requests.findFirst(this.database, { AND: [where, { id }] })
      : null;
    if (!request) {
      throw new NotFoundError();
    }
    return request;
  }

  public async events(context: StaffContext, id: string) {
    await this.get(context, id);
    return this.requests.listEvents(this.database, context.tenant.hospitalId, id);
  }

  // How many requests each list holds, how many are overdue or waiting for
  // someone to be assigned, and how many were completed today (hospital day).
  private async queueCounts(visible: Prisma.ServiceRequestWhereInput, timeZone: string, now: Date) {
    const db = this.database;
    const [byStatus, overdue, completedToday] = await Promise.all([
      this.requests.countByStatus(db, visible),
      this.requests.count(db, { AND: [visible, overdueWhere(now)] }),
      this.requests.count(db, {
        AND: [visible, { completedAt: { gte: startOfDay(dayIn(now, timeZone), timeZone) } }],
      }),
    ]);
    const sum = (statuses: readonly RequestStatus[]) =>
      statuses.reduce((total, status) => total + (byStatus.get(status) ?? 0), 0);
    return {
      open: sum(queueStatuses.open),
      waiting: sum(['SUBMITTED']),
      overdue,
      completed: sum(queueStatuses.completed),
      history: sum(queueStatuses.history),
      completedToday,
    };
  }
}
