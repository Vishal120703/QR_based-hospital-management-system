import { randomBytes } from 'node:crypto';
import { Prisma, type PrismaClient, type ServiceRequest } from '@prisma/client';
import {
  ConflictError,
  InvalidInputError,
  NotFoundError,
  UnauthorizedError,
} from '../../common/errors/app-error.js';
import { bedTakesPatients, type GuestContext } from '../bed-sessions/index.js';
import { snapshotService } from '../catalog/index.js';
import { hospitalIsOpen } from '../hospitals/index.js';
import { activeRequestStatuses, transitions } from './request-transitions.js';
import { type RequestRepository } from './request.repository.js';

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

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

// What a patient does with their own requests during their bed stay: submit,
// list, and cancel. Every step first locks and rechecks the guest session, so
// closing the stay or replacing the QR cannot race a patient's change.
export class PatientRequestService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly requests: RequestRepository,
  ) {}

  // Core creation use case; the public adapter below adds retry behavior while
  // keeping this single transactional path for new request persistence.
  public async submit(guest: GuestContext, serviceId: string, correlationId?: string) {
    try {
      return await this.database.$transaction(async (transaction) => {
        const now = new Date();
        await this.assertActiveGuest(transaction, guest, now);
        const snapshot = await snapshotService(transaction, guest.hospitalId, serviceId, now);
        if (!snapshot) throw new NotFoundError('The requested service is unavailable.');
        const created = await this.requests.create(transaction, {
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
        });
        await this.requests.addEvent(transaction, {
          hospitalId: guest.hospitalId,
          requestId: created.id,
          type: 'SUBMITTED',
          resultingStatus: 'SUBMITTED',
          actorType: 'GUEST',
          actorId: guest.guestSessionId,
          occurredAt: now,
          requestVersion: created.version,
          correlationId: correlationId ?? null,
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
      const requests = await this.requests.listForBedSession(
        transaction,
        guest.hospitalId,
        guest.bedId,
        guest.bedSessionId,
      );
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
      const current = await this.requests.findByPublicId(transaction, publicId);
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
      const updated = await this.requests.updateIfUnchanged(
        transaction,
        guest.hospitalId,
        current.id,
        current,
        { status: 'CANCELLED', cancelledAt: now, version: { increment: 1 } },
      );
      if (updated !== 1) throw new ConflictError('The request changed during cancellation.');
      await this.requests.addEvent(transaction, {
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
      });
      const cancelled = await this.requests.findById(transaction, guest.hospitalId, current.id);
      return toPublicRequest(cancelled);
    });
  }

  private async findActiveForGuest(guest: GuestContext, serviceId: string) {
    return this.database.$transaction(async (transaction) => {
      await this.assertActiveGuest(transaction, guest, new Date());
      return this.requests.findFirst(transaction, {
        hospitalId: guest.hospitalId,
        bedId: guest.bedId,
        bedSessionId: guest.bedSessionId,
        serviceId,
        status: { in: activeRequestStatuses },
      });
    });
  }

  private async assertActiveGuest(
    transaction: Prisma.TransactionClient,
    guest: GuestContext,
    now: Date,
  ): Promise<void> {
    // A shared lock serializes request operations with BedSession.close.
    if (!(await this.requests.lockActiveBedSession(transaction, guest))) {
      throw new UnauthorizedError();
    }
    // QR rotation/revocation updates GuestSession rows. Lock this credential
    // too, so neither operation can revoke it between our check and commit.
    if (!(await this.requests.lockActiveGuestSession(transaction, guest))) {
      throw new UnauthorizedError();
    }
    const session = await this.requests.findGuestSession(transaction, guest.guestSessionId);
    if (
      !session ||
      session.hospitalId !== guest.hospitalId ||
      session.bedId !== guest.bedId ||
      session.bedSessionId !== guest.bedSessionId ||
      session.revokedAt ||
      session.expiresAt <= now ||
      !hospitalIsOpen(session.hospital) ||
      session.bedSession.status !== 'ACTIVE' ||
      !bedTakesPatients(session.bedSession.bed, session.hospital.bedOccupancyEnabled)
    ) {
      throw new UnauthorizedError();
    }
  }
}
