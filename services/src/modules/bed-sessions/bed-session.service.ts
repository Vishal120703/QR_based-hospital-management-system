import { type BedSessionStatus, type Prisma, type PrismaClient } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../common/errors/app-error.js';
import { recordStaffAudit } from '../audit/audit-log.js';
import { type StaffContext } from '../auth/auth.service.js';
import { occupyBed, releaseBed } from '../locations/bed-occupancy.js';
import { areaFilters } from '../locations/location.service.js';
import { type GuestSessionService } from './guest-session.service.js';

const listLimit = 100;

export interface BedSessionFilter {
  readonly bedId?: string | undefined;
  readonly status?: BedSessionStatus | undefined;
}

export class BedSessionService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly guestSessions: GuestSessionService,
  ) {}

  // Newest first, at most 100; filter by bed or status for more specific views.
  public list(context: StaffContext, filter: BedSessionFilter) {
    return this.database.bedSession.findMany({
      where: {
        hospitalId: context.tenant.hospitalId,
        ...(filter.bedId !== undefined ? { bedId: filter.bedId } : {}),
        ...(filter.status !== undefined ? { status: filter.status } : {}),
        bed: { ward: areaFilters(context, 'bed.read').ward },
      },
      orderBy: { startedAt: 'desc' },
      take: listLimit,
    });
  }

  public start(context: StaffContext, bedId: string, requestId: string) {
    const hospitalId = context.tenant.hospitalId;
    return this.database.$transaction(async (transaction) => {
      await this.requireBedInArea(transaction, context, bedId);
      // Moves the bed AVAILABLE -> OCCUPIED atomically; the partial unique
      // index on BedSession is the database-level backstop.
      await occupyBed(transaction, hospitalId, bedId);
      const session = await transaction.bedSession.create({
        data: { hospitalId, bedId, startedByMembershipId: context.membershipId },
      });
      await recordStaffAudit(transaction, context, requestId, {
        action: 'bedSession.start',
        targetType: 'BedSession',
        targetId: session.id,
        metadata: { bedId },
      });
      return session;
    });
  }

  public close(context: StaffContext, id: string, requestId: string) {
    const hospitalId = context.tenant.hospitalId;
    return this.database.$transaction(async (transaction) => {
      const session = await transaction.bedSession.findUnique({
        where: { hospitalId_id: { hospitalId, id } },
      });
      if (!session) {
        throw new NotFoundError();
      }
      await this.requireBedInArea(transaction, context, session.bedId);
      const closed = await transaction.bedSession.updateMany({
        where: { hospitalId, id, status: 'ACTIVE' },
        data: { status: 'CLOSED', endedAt: new Date(), closedByMembershipId: context.membershipId },
      });
      if (closed.count !== 1) {
        throw new ConflictError('This bed session is already closed.');
      }
      await releaseBed(transaction, hospitalId, session.bedId);
      const revokedGuestSessions = await this.guestSessions.revokeForBedSession(
        transaction,
        hospitalId,
        id,
      );
      await recordStaffAudit(transaction, context, requestId, {
        action: 'bedSession.close',
        targetType: 'BedSession',
        targetId: id,
        metadata: { bedId: session.bedId, revokedGuestSessions },
      });
      return transaction.bedSession.findUniqueOrThrow({
        where: { hospitalId_id: { hospitalId, id } },
      });
    });
  }

  // Floor and ward managers admit and discharge only in their own area.
  private async requireBedInArea(
    transaction: Prisma.TransactionClient,
    context: StaffContext,
    bedId: string,
  ): Promise<void> {
    const bed = await transaction.bed.findFirst({
      where: {
        hospitalId: context.tenant.hospitalId,
        id: bedId,
        ward: areaFilters(context, 'bedSession.manage').ward,
      },
      select: { id: true },
    });
    if (!bed) throw new NotFoundError('The referenced bed was not found.');
  }
}
