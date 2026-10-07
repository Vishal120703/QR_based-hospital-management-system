import { randomBytes } from 'node:crypto';
import {
  Prisma,
  type PrismaClient,
  type RequestEventType,
  type RequestStatus,
  type ServiceRequest,
} from '@prisma/client';
import {
  ConflictError,
  ForbiddenError,
  InvalidInputError,
  NotFoundError,
  UnauthorizedError,
} from '../../common/errors/app-error.js';
import { recordStaffAudit } from '../audit/audit-log.js';
import { canAccessLocation, type StaffContext } from '../auth/auth.service.js';
import { type GuestContext } from '../bed-sessions/guest-session.service.js';
import { snapshotService } from '../catalog/service-snapshot.js';
import { hospitalAccessSelect, hospitalIsOpen } from '../hospitals/hospital-access.js';
import { findEligibleStaff } from '../staff/eligibility.js';
import { visibleRequestsWhere } from './request-scope.js';

type Command =
  'assign' | 'accept' | 'start' | 'complete' | 'close' | 'cancel' | 'reject' | 'transfer';
type CommandInput = {
  readonly expectedVersion: number;
  readonly assigneeId?: string;
  readonly reason?: string;
};

const transitions: Record<
  Command,
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

const commandPermissions: Record<Command, string> = {
  assign: 'request.assign',
  accept: 'request.accept',
  start: 'request.start',
  complete: 'request.complete',
  close: 'request.close',
  cancel: 'request.cancel',
  reject: 'request.reject',
  transfer: 'request.transfer',
};

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

const activeRequestStatuses: RequestStatus[] = ['SUBMITTED', 'ASSIGNED', 'ACCEPTED', 'IN_PROGRESS'];

// Public responses never expose internal tenant, bed, session, assignee,
// department, routing, or policy identifiers.
function toPublicRequest(request: ServiceRequest) {
  return {
    publicId: request.publicId,
    serviceId: request.serviceId,
    serviceName: request.serviceName,
    status: request.status,
    priority: request.priority,
    submittedAt: request.submittedAt,
    assignedAt: request.assignedAt,
    acceptedAt: request.acceptedAt,
    startedAt: request.startedAt,
    completedAt: request.completedAt,
    closedAt: request.closedAt,
    cancelledAt: request.cancelledAt,
    rejectedAt: request.rejectedAt,
    version: request.version,
  };
}

export class RequestService {
  public constructor(private readonly database: PrismaClient) {}

  // Every open request in the caller's area, plus the 100 most recent finished
  // ones, so a long history never hides work that still needs attention.
  public async list(context: StaffContext) {
    if (!context.permissions.has('request.read')) throw new ForbiddenError();
    const where = visibleRequestsWhere(context);
    if (!where) return [];
    const query = {
      include: {
        bed: { select: { code: true, displayName: true } },
        assignee: { select: { user: { select: { displayName: true } } } },
      },
      orderBy: [{ submittedAt: 'desc' as const }, { id: 'desc' as const }],
    };
    const [open, finished] = await Promise.all([
      this.database.serviceRequest.findMany({
        ...query,
        where: { ...where, status: { in: [...activeRequestStatuses, 'COMPLETED'] } },
        take: 500,
      }),
      this.database.serviceRequest.findMany({
        ...query,
        where: { ...where, status: { in: ['CLOSED', 'CANCELLED', 'REJECTED'] } },
        take: 100,
      }),
    ]);
    return [...open, ...finished].map(({ bed, assignee, ...request }) => ({
      ...request,
      bed: { code: bed.code, displayName: bed.displayName },
      assigneeName: assignee?.user.displayName ?? null,
    }));
  }

  // Core creation use case; the public adapter below adds retry behavior while
  // keeping this single transactional path for new request persistence.
  public async submit(guest: GuestContext, serviceId: string, correlationId?: string) {
    try {
      return await this.database.$transaction(async (transaction) => {
        const now = new Date();
        await this.assertActiveGuest(transaction, guest, now);
        const snapshot = await snapshotService(transaction, guest.hospitalId, serviceId, now);
        if (!snapshot) throw new NotFoundError('The requested service is unavailable.');
        const created = await transaction.serviceRequest.create({
          data: {
            publicId: `CR-${randomBytes(8).toString('hex').toUpperCase()}`,
            hospitalId: guest.hospitalId,
            bedId: guest.bedId,
            bedSessionId: guest.bedSessionId,
            serviceId,
            serviceName: snapshot.serviceName,
            categoryName: snapshot.categoryName,
            departmentId: snapshot.departmentId,
            priority: snapshot.priority,
            slaPolicyId: snapshot.slaPolicyId,
            slaPolicyVersionId: snapshot.slaPolicyVersionId,
            slaPolicyVersion: snapshot.slaPolicyVersion,
            acceptMinutes: snapshot.acceptMinutes,
            completeMinutes: snapshot.completeMinutes,
            escalationPolicyId: snapshot.escalationPolicyId,
            acceptDueAt: snapshot.acceptDueAt,
            completeDueAt: snapshot.completeDueAt,
            submittedAt: now,
          },
        });
        await transaction.requestEvent.create({
          data: {
            hospitalId: guest.hospitalId,
            requestId: created.id,
            type: 'SUBMITTED',
            resultingStatus: 'SUBMITTED',
            actorType: 'GUEST',
            actorId: guest.guestSessionId,
            occurredAt: now,
            requestVersion: created.version,
            correlationId: correlationId ?? null,
          },
        });
        return created;
      });
    } catch (error) {
      if (isUniqueConflict(error)) {
        throw new ConflictError(
          'An active request for this service already exists for this bed session.',
        );
      }
      throw error;
    }
  }

  // Public retries return the existing active request, including when two
  // submissions raced on the database's partial unique index.
  public async submitForGuest(guest: GuestContext, serviceId: string, correlationId: string) {
    const existing = await this.findActiveForGuest(guest, serviceId);
    if (existing) return { serviceRequest: toPublicRequest(existing), created: false };
    try {
      const created = await this.submit(guest, serviceId, correlationId);
      return { serviceRequest: toPublicRequest(created), created: true };
    } catch (error) {
      if (error instanceof ConflictError) {
        const winner = await this.findActiveForGuest(guest, serviceId);
        if (winner) return { serviceRequest: toPublicRequest(winner), created: false };
      }
      throw error;
    }
  }

  public async listForGuest(guest: GuestContext) {
    return this.database.$transaction(async (transaction) => {
      await this.assertActiveGuest(transaction, guest, new Date());
      const requests = await transaction.serviceRequest.findMany({
        where: {
          hospitalId: guest.hospitalId,
          bedId: guest.bedId,
          bedSessionId: guest.bedSessionId,
        },
        orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
        take: 100,
      });
      return requests.map(toPublicRequest);
    });
  }

  public async cancelForGuest(
    guest: GuestContext,
    publicId: string,
    reason: string,
    correlationId: string,
  ) {
    if (!reason.trim()) throw new InvalidInputError('A reason is required.');
    return this.database.$transaction(async (transaction) => {
      await this.assertActiveGuest(transaction, guest, new Date());
      const current = await transaction.serviceRequest.findUnique({ where: { publicId } });
      if (
        !current ||
        current.hospitalId !== guest.hospitalId ||
        current.bedId !== guest.bedId ||
        current.bedSessionId !== guest.bedSessionId
      ) {
        throw new NotFoundError();
      }
      if (!transitions.cancel.from.includes(current.status)) {
        throw new ConflictError('This request can no longer be cancelled.');
      }
      const now = new Date();
      const updated = await transaction.serviceRequest.updateMany({
        where: {
          hospitalId: guest.hospitalId,
          id: current.id,
          version: current.version,
          status: current.status,
        },
        data: { status: 'CANCELLED', cancelledAt: now, version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new ConflictError('The request changed during cancellation.');
      await transaction.requestEvent.create({
        data: {
          hospitalId: guest.hospitalId,
          requestId: current.id,
          type: 'CANCELLED',
          previousStatus: current.status,
          resultingStatus: 'CANCELLED',
          actorType: 'GUEST',
          actorId: guest.guestSessionId,
          occurredAt: now,
          reason: reason.trim(),
          requestVersion: current.version + 1,
          correlationId,
        },
      });
      const cancelled = await transaction.serviceRequest.findUniqueOrThrow({
        where: { hospitalId_id: { hospitalId: guest.hospitalId, id: current.id } },
      });
      return toPublicRequest(cancelled);
    });
  }

  private async findActiveForGuest(guest: GuestContext, serviceId: string) {
    return this.database.$transaction(async (transaction) => {
      await this.assertActiveGuest(transaction, guest, new Date());
      return transaction.serviceRequest.findFirst({
        where: {
          hospitalId: guest.hospitalId,
          bedId: guest.bedId,
          bedSessionId: guest.bedSessionId,
          serviceId,
          status: { in: activeRequestStatuses },
        },
      });
    });
  }

  private async assertActiveGuest(
    transaction: Prisma.TransactionClient,
    guest: GuestContext,
    now: Date,
  ): Promise<void> {
    // A shared lock serializes request operations with BedSession.close.
    const activeSession = await transaction.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT "id" FROM "BedSession"
      WHERE "hospitalId" = ${guest.hospitalId}::uuid
        AND "bedId" = ${guest.bedId}::uuid
        AND "id" = ${guest.bedSessionId}::uuid
        AND "status" = 'ACTIVE'
      FOR SHARE
    `);
    if (activeSession.length !== 1) throw new UnauthorizedError();
    // QR rotation/revocation updates GuestSession rows. Lock this credential
    // too, so neither operation can revoke it between our check and commit.
    const activeGuest = await transaction.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT "id" FROM "GuestSession"
      WHERE "id" = ${guest.guestSessionId}::uuid
        AND "hospitalId" = ${guest.hospitalId}::uuid
        AND "bedId" = ${guest.bedId}::uuid
        AND "bedSessionId" = ${guest.bedSessionId}::uuid
        AND "revokedAt" IS NULL
      FOR SHARE
    `);
    if (activeGuest.length !== 1) throw new UnauthorizedError();
    const session = await transaction.guestSession.findUnique({
      where: { id: guest.guestSessionId },
      include: {
        hospital: { select: hospitalAccessSelect },
        bedSession: { include: { bed: { select: { active: true, status: true } } } },
      },
    });
    if (
      !session ||
      session.hospitalId !== guest.hospitalId ||
      session.bedId !== guest.bedId ||
      session.bedSessionId !== guest.bedSessionId ||
      session.revokedAt ||
      session.expiresAt <= now ||
      !hospitalIsOpen(session.hospital) ||
      session.bedSession.status !== 'ACTIVE' ||
      !session.bedSession.bed.active ||
      session.bedSession.bed.status !== 'OCCUPIED'
    ) {
      throw new UnauthorizedError();
    }
  }

  public async get(context: StaffContext, id: string) {
    if (!context.permissions.has('request.read')) throw new ForbiddenError();
    const where = visibleRequestsWhere(context);
    const request = where
      ? await this.database.serviceRequest.findFirst({ where: { AND: [where, { id }] } })
      : null;
    if (!request) {
      throw new NotFoundError();
    }
    return request;
  }

  public async events(context: StaffContext, id: string) {
    await this.get(context, id);
    return this.database.requestEvent.findMany({
      where: { hospitalId: context.tenant.hospitalId, requestId: id },
      orderBy: { requestVersion: 'asc' },
    });
  }

  public assign(context: StaffContext, id: string, input: CommandInput, correlationId: string) {
    return this.command(context, id, 'assign', input, correlationId);
  }
  public accept(context: StaffContext, id: string, input: CommandInput, correlationId: string) {
    return this.command(context, id, 'accept', input, correlationId);
  }
  public start(context: StaffContext, id: string, input: CommandInput, correlationId: string) {
    return this.command(context, id, 'start', input, correlationId);
  }
  public complete(context: StaffContext, id: string, input: CommandInput, correlationId: string) {
    return this.command(context, id, 'complete', input, correlationId);
  }
  public close(context: StaffContext, id: string, input: CommandInput, correlationId: string) {
    return this.command(context, id, 'close', input, correlationId);
  }
  public cancel(context: StaffContext, id: string, input: CommandInput, correlationId: string) {
    return this.command(context, id, 'cancel', input, correlationId);
  }
  public reject(context: StaffContext, id: string, input: CommandInput, correlationId: string) {
    return this.command(context, id, 'reject', input, correlationId);
  }
  public transfer(context: StaffContext, id: string, input: CommandInput, correlationId: string) {
    return this.command(context, id, 'transfer', input, correlationId);
  }

  private async command(
    context: StaffContext,
    id: string,
    action: Command,
    input: CommandInput,
    correlationId: string,
  ): Promise<ServiceRequest> {
    if (!context.permissions.has(commandPermissions[action])) throw new ForbiddenError();
    const hospitalId = context.tenant.hospitalId;
    return this.database.$transaction(async (transaction) => {
      const current = await transaction.serviceRequest.findUnique({
        where: { hospitalId_id: { hospitalId, id } },
        include: { bed: { select: { wardId: true, ward: { select: { floorId: true } } } } },
      });
      if (
        !current ||
        !canAccessLocation(context, commandPermissions[action], {
          wardId: current.bed.wardId,
          floorId: current.bed.ward.floorId,
          departmentId: current.departmentId,
        })
      ) {
        throw new NotFoundError();
      }
      if (
        current.version !== input.expectedVersion ||
        !transitions[action].from.includes(current.status)
      ) {
        throw new ConflictError('The request has changed or this transition is not allowed.');
      }
      if (current.assignmentMode !== 'MANUAL') {
        throw new ConflictError('This assignment mode is not available yet.');
      }
      if (
        ['accept', 'start', 'complete', 'reject'].includes(action) &&
        current.assigneeId !== context.membershipId
      ) {
        throw new ForbiddenError();
      }
      if (
        (action === 'reject' || action === 'cancel' || action === 'transfer') &&
        !input.reason?.trim()
      ) {
        throw new InvalidInputError('A reason is required.');
      }
      if (action === 'assign' || action === 'transfer') {
        if (!input.assigneeId) throw new InvalidInputError('An assignee is required.');
        if (action === 'transfer' && input.assigneeId === current.assigneeId) {
          throw new InvalidInputError('Transfer requires a different assignee.');
        }
        const eligible = await findEligibleStaff(transaction, hospitalId, {
          bedId: current.bedId,
          departmentId: current.departmentId,
        });
        if (!eligible.some((staff) => staff.membershipId === input.assigneeId)) {
          throw new InvalidInputError(
            'The selected staff member is not eligible for this request.',
          );
        }
      }
      if (action === 'accept') {
        const eligible = await findEligibleStaff(transaction, hospitalId, {
          bedId: current.bedId,
          departmentId: current.departmentId,
        });
        if (!eligible.some((staff) => staff.membershipId === context.membershipId)) {
          throw new ForbiddenError();
        }
      }
      const now = new Date();
      const data: Prisma.ServiceRequestUncheckedUpdateManyInput = {
        status: transitions[action].to,
        version: { increment: 1 },
      };
      if (action === 'assign' || action === 'transfer') {
        data.assigneeId = input.assigneeId ?? null;
        data.assignedAt = now;
      }
      if (action === 'accept') data.acceptedAt = current.acceptedAt ?? now;
      if (action === 'start') data.startedAt = current.startedAt ?? now;
      if (action === 'complete') data.completedAt = now;
      if (action === 'close') data.closedAt = now;
      if (action === 'cancel') data.cancelledAt = now;
      if (action === 'reject') data.rejectedAt = now;

      const updated = await transaction.serviceRequest.updateMany({
        where: { hospitalId, id, version: current.version, status: current.status },
        data,
      });
      if (updated.count !== 1) throw new ConflictError('The request changed during this command.');

      const metadata: Prisma.InputJsonObject = {
        ...(action === 'assign' || action === 'transfer'
          ? { assigneeId: input.assigneeId ?? null }
          : {}),
        ...(action === 'transfer' ? { previousAssigneeId: current.assigneeId } : {}),
      };
      await transaction.requestEvent.create({
        data: {
          hospitalId,
          requestId: id,
          type: transitions[action].event,
          previousStatus: current.status,
          resultingStatus: transitions[action].to,
          actorType: 'STAFF',
          actorId: context.membershipId,
          occurredAt: now,
          reason: input.reason?.trim() || null,
          metadata,
          requestVersion: current.version + 1,
          correlationId,
        },
      });
      if (['assign', 'transfer', 'cancel', 'reject'].includes(action)) {
        await recordStaffAudit(transaction, context, correlationId, {
          action: `request.${action}`,
          targetType: 'ServiceRequest',
          targetId: id,
          metadata: {
            previousStatus: current.status,
            status: transitions[action].to,
            ...metadata,
            ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}),
          },
        });
      }
      return transaction.serviceRequest.findUniqueOrThrow({
        where: { hospitalId_id: { hospitalId, id } },
      });
    });
  }
}
