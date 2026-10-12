import { type Prisma, type PrismaClient } from '@prisma/client';
import { type Logger } from 'pino';
import { NotFoundError } from '../../common/errors/app-error.js';
import { type Db } from '../../database/client.js';
import { canAccessLocation, type StaffContext } from '../auth/index.js';
import { visibleRequestsWhere } from '../requests/index.js';
import { findEligibleStaff } from '../staff/index.js';
import { NotificationRepository, type NotificationSource } from './notification.repository.js';

const messages: Record<string, { title: string; message: string }> = {
  SUBMITTED: {
    title: 'New request needs assignment',
    message: 'New work is waiting in your authorized request queue.',
  },
  ASSIGNED: {
    title: 'Request assigned to you',
    message: 'Open your request queue to review and accept your assigned work.',
  },
  TRANSFERRED: {
    title: 'Request handed over to you',
    message: 'Review your new assignment in the request queue.',
  },
  COMPLETED: {
    title: 'Request ready to close',
    message: 'Completed work needs confirmation from an authorized manager.',
  },
  CANCELLED: {
    title: 'Request cancelled',
    message: 'A request in your area was cancelled. Review your queue before acting.',
  },
  REJECTED: {
    title: 'Request needs manager attention',
    message: 'Assigned work was declined. Review the request and decide the next step.',
  },
  ESCALATED: {
    title: 'Overdue request escalated',
    message: 'A configured SLA escalation needs your attention.',
  },
};
const metadataId = (metadata: Prisma.JsonValue, key: string) => {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  return typeof metadata[key] === 'string' ? metadata[key] : null;
};

export class NotificationService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly logger: Logger,
    private readonly repository = new NotificationRepository(),
  ) {}

  // Only trusted membership/role records are used. Existing permission scope
  // helpers enforce the same responsibilities as the request module.
  private async recipients(
    db: Db,
    request: NonNullable<Awaited<ReturnType<NotificationRepository['request']>>>,
    type: string,
    assignedTo: string | null,
    roleId: string | null,
    assigneeTarget: boolean,
  ) {
    const candidates = await this.repository.candidates(db, request.hospitalId);
    const place = {
      wardId: request.bed.wardId,
      floorId: request.bed.ward.floorId,
      departmentId: request.departmentId,
    };
    const eligible =
      ['ASSIGNED', 'TRANSFERRED'].includes(type) || (type === 'ESCALATED' && assigneeTarget)
        ? new Set(
            (
              await findEligibleStaff(db, request.hospitalId, {
                bedId: request.bedId,
                departmentId: request.departmentId,
              })
            ).map((person) => person.membershipId),
          )
        : null;
    return candidates
      .filter((member) => {
        const permissionScopes = new Map<
          string,
          { type: 'HOSPITAL' | 'FLOOR' | 'WARD' | 'DEPARTMENT'; id: string }[]
        >();
        for (const entry of member.userRoles) {
          for (const permission of entry.role.rolePermissions) {
            permissionScopes.set(permission.permissionKey, [
              ...(permissionScopes.get(permission.permissionKey) ?? []),
              ...entry.scopes.map((scope) => ({ type: scope.scopeType, id: scope.scopeId })),
            ]);
          }
        }
        // canAccessLocation reads only tenant and permissionScopes.
        const context = { tenant: { hospitalId: request.hospitalId }, permissionScopes };
        const can = (permission: string) => canAccessLocation(context, permission, place);
        if (!can('request.read')) return false;
        const manager = can('request.assign');
        const owner = member.id === request.assigneeId;
        if (type === 'SUBMITTED') return request.status === 'SUBMITTED' && manager;
        if (type === 'ASSIGNED' || type === 'TRANSFERRED') {
          return (
            owner &&
            member.id === assignedTo &&
            request.status === 'ASSIGNED' &&
            eligible?.has(member.id) &&
            can('request.accept')
          );
        }
        if (type === 'ESCALATED') {
          if (assigneeTarget) return owner && eligible?.has(member.id);
          return (
            manager &&
            member.userRoles.some(
              (entry) =>
                entry.roleId === roleId &&
                entry.role.rolePermissions.some(
                  (permission) => permission.permissionKey === 'request.read',
                ) &&
                entry.scopes.some(
                  (scope) =>
                    (scope.scopeType === 'HOSPITAL' && scope.scopeId === request.hospitalId) ||
                    (scope.scopeType === 'FLOOR' && scope.scopeId === place.floorId) ||
                    (scope.scopeType === 'WARD' && scope.scopeId === place.wardId) ||
                    (scope.scopeType === 'DEPARTMENT' && scope.scopeId === place.departmentId),
                ),
            )
          );
        }
        if (type === 'COMPLETED') return manager && can('request.close');
        if (type === 'REJECTED') return manager;
        return manager || owner; // cancellation outcome
      })
      .map((member) => member.id);
  }

  public async process(source: NotificationSource): Promise<void> {
    const result = await this.database.$transaction(async (db) => {
      // A DB lock serializes competing workers; receipts/notifications commit
      // together. A crash rolls both back and the durable source is retried.
      await this.repository.lockSource(db, source.sourceKey);
      const receipt = await this.repository.receipt(db, source.sourceKey);
      if (
        receipt &&
        (receipt.outcome !== 'RETRY' ||
          (receipt.nextAttemptAt && receipt.nextAttemptAt > new Date()))
      )
        return null;
      const event = source.kind === 'event' ? await this.repository.event(db, source.id) : null;
      const escalation =
        source.kind === 'escalation' ? await this.repository.escalation(db, source.id) : null;
      const input = event ?? escalation;
      if (!input) return null;
      const type = event?.type ?? 'ESCALATED';
      const request = await this.repository.request(db, input.hospitalId, input.requestId);
      let recipients: string[] = [];
      const currentEscalation =
        !escalation ||
        (escalation.stage === 'ACCEPT'
          ? ['SUBMITTED', 'ASSIGNED'].includes(request?.status ?? '')
          : ['ACCEPTED', 'IN_PROGRESS'].includes(request?.status ?? ''));
      const assignedTo = event
        ? metadataId(event.metadata, 'assigneeId')
        : (request?.assigneeId ?? null);
      const supported = Boolean(messages[type]);
      const actionable =
        supported &&
        currentEscalation &&
        (type !== 'SUBMITTED' || request?.status === 'SUBMITTED') &&
        (!['ASSIGNED', 'TRANSFERRED'].includes(type) ||
          (request?.status === 'ASSIGNED' && request.assigneeId === assignedTo)) &&
        (type !== 'COMPLETED' || request?.status === 'COMPLETED');
      if (
        request &&
        request.hospital.status === 'ACTIVE' &&
        request.hospital.client.status === 'ACTIVE' &&
        actionable
      ) {
        recipients = await this.recipients(
          db,
          request,
          type,
          assignedTo,
          escalation?.roleId ?? null,
          escalation?.targetType === 'ASSIGNEE',
        );
        if (event?.actorType === 'STAFF')
          recipients = recipients.filter((id) => id !== event.actorId);
        await this.repository.create(
          db,
          [...new Set(recipients)].map((membershipId) => ({
            hospitalId: request.hospitalId,
            membershipId,
            sourceKey: source.sourceKey,
            type,
            priority: request.priority,
            ...messages[type]!,
            entityId: request.id,
          })),
        );
      }
      const outcome = !actionable
        ? 'NOT_ACTIONABLE'
        : recipients.length
          ? 'CREATED'
          : 'NO_RECIPIENT';
      await this.repository.finish(db, {
        sourceKey: source.sourceKey,
        recipients: recipients.length,
        outcome,
      });
      return { sourceKey: source.sourceKey, outcome, recipients: recipients.length };
    });
    if (result?.outcome === 'NO_RECIPIENT')
      this.logger.warn(
        result,
        'No eligible on-duty notification recipient; review staffing and scopes',
      );
  }

  public async run(limit = 100): Promise<void> {
    for (const source of await this.repository.pendingSources(this.database, limit)) {
      try {
        await this.process(source);
      } catch {
        try {
          await this.database.$transaction(async (db) => {
            await this.repository.lockSource(db, source.sourceKey);
            await this.repository.retrySource(db, source.sourceKey);
          });
        } catch {
          /* An unavailable DB leaves the committed source untouched. */
        }
        this.logger.error(
          { sourceKey: source.sourceKey },
          'Notification processing failed; durable source will be retried with backoff',
        );
      }
    }
  }

  private own(context: StaffContext) {
    return { hospitalId: context.tenant.hospitalId, membershipId: context.membershipId };
  }
  public unreadCount(context: StaffContext) {
    return this.repository.count(this.database, { ...this.own(context), readAt: null });
  }
  public async list(
    context: StaffContext,
    query: { limit: number; before?: string | undefined; unread?: string | undefined },
  ) {
    const own = this.own(context);
    const cursor = query.before
      ? await this.repository.find(this.database, { ...own, id: query.before })
      : null;
    if (query.before && !cursor) throw new NotFoundError();
    const rows = await this.repository.list(
      this.database,
      {
        ...own,
        ...(query.unread === 'true'
          ? { readAt: null }
          : query.unread === 'false'
            ? { readAt: { not: null } }
            : {}),
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      query.limit + 1,
    );
    const visible = visibleRequestsWhere(context);
    const requests = visible
      ? await this.repository.visibleRequests(
          this.database,
          visible,
          rows.map((row) => row.entityId),
        )
      : [];
    const allowed = new Map(requests.map((request) => [request.id, request.publicId]));
    const items = rows.slice(0, query.limit).map(({ entityId, ...row }) => ({
      ...row,
      requestId: allowed.has(entityId) ? entityId : null,
      requestReference: allowed.get(entityId) ?? null,
    }));
    return {
      items,
      nextCursor: rows.length > query.limit ? (items.at(-1)?.id ?? null) : null,
      unreadCount: await this.unreadCount(context),
    };
  }
  public async read(context: StaffContext, id: string) {
    const where = { ...this.own(context), id };
    if (!(await this.repository.find(this.database, where))) throw new NotFoundError();
    await this.repository.read(this.database, where);
    return { unreadCount: await this.unreadCount(context) };
  }
}
