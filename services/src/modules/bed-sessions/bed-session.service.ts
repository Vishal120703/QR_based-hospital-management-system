import { type Prisma, type PrismaClient } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../common/errors/app-error.js';
import { recordStaffAudit } from '../audit/index.js';
import { type StaffContext } from '../auth/index.js';
import { areaFilters, occupyBed, releaseBed } from '../locations/index.js';
import { BedSessionRepository } from './bed-session.repository.js';
import { type BedSessionFilter } from './bed-session.schemas.js';
import { type GuestSessionService } from './guest-session.service.js';

// Admitting (start) and discharging (close) patients. A bed session has no
// patient identity; closing it also ends the patient's QR access.
export class BedSessionService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly guestSessions: GuestSessionService,
    private readonly bedSessions = new BedSessionRepository(),
  ) {}

  // Newest first, at most 100; filter by bed or status for more specific views.
  public list(context: StaffContext, filter: BedSessionFilter) {
    return this.bedSessions.list(this.database, context.tenant.hospitalId, {
      ...filter,
      wardArea: areaFilters(context, 'bed.read').ward,
    });
  }

  public start(context: StaffContext, bedId: string, requestId: string) {
    const hospitalId = context.tenant.hospitalId;
    return this.database.$transaction(async (transaction) => {
      await this.requireBedInArea(transaction, context, bedId);
      // Moves the bed AVAILABLE -> OCCUPIED atomically; the partial unique
      // index on BedSession is the database-level backstop.
      await occupyBed(transaction, hospitalId, bedId);
      const session = await this.bedSessions.create(transaction, {
        hospitalId,
        bedId,
        startedByMembershipId: context.membershipId,
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
      const session = await this.bedSessions.findById(transaction, hospitalId, id);
      if (!session) {
        throw new NotFoundError();
      }
      await this.requireBedInArea(transaction, context, session.bedId);
      if ((await this.bedSessions.close(transaction, hospitalId, id, context.membershipId)) !== 1) {
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
      return (await this.bedSessions.findById(transaction, hospitalId, id))!;
    });
  }

  // Floor and ward managers admit and discharge only in their own area.
  private async requireBedInArea(
    transaction: Prisma.TransactionClient,
    context: StaffContext,
    bedId: string,
  ): Promise<void> {
    const bed = await this.bedSessions.findBedInArea(
      transaction,
      context.tenant.hospitalId,
      bedId,
      areaFilters(context, 'bedSession.manage').ward,
    );
    if (!bed) throw new NotFoundError('The referenced bed was not found.');
  }
}
