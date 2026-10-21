import { type Prisma, type PrismaClient } from '@prisma/client';
import { AppError, ConflictError, NotFoundError } from '../../common/errors/app-error.js';
import { recordStaffAudit } from '../audit/index.js';
import { type StaffContext } from '../auth/index.js';
import { areaFilters, occupyBed, releaseAllBeds, releaseBed } from '../locations/index.js';
import { BedSessionRepository } from './bed-session.repository.js';
import { type BedSessionFilter } from './bed-session.schemas.js';
import { type GuestSessionService } from './guest-session.service.js';

class BedOccupancyOffError extends AppError {
  public constructor() {
    super(
      409,
      'BED_OCCUPANCY_OFF',
      'Bed occupancy management is turned off for this hospital, so patients are not admitted or discharged. A hospital manager can turn it on in Profile & settings.',
    );
  }
}

export interface BedOccupancyChange {
  readonly enabled: boolean;
  // Turning it off: beds that showed as occupied (their patients keep access).
  readonly releasedBeds: number;
  // Turning it on: stays opened by QR scans that ended, and the patient
  // connections that ended with them.
  readonly closedStays: number;
  readonly revokedGuestSessions: number;
}

// Admitting (start) and discharging (close) patients. A bed session has no
// patient identity; closing it also ends the patient's QR access. A hospital
// can turn bed occupancy management off and use QR codes without admissions.
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
      await this.requireOccupancyManaged(transaction, hospitalId);
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
      await this.requireOccupancyManaged(transaction, hospitalId);
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

  // Turning it off keeps admitted patients' QR access; their beds stop showing
  // as occupied. Turning it on ends the stays opened by QR scans, so patients
  // use their QR again once they are admitted.
  public setOccupancyManagement(
    context: StaffContext,
    enabled: boolean,
    requestId: string,
  ): Promise<BedOccupancyChange> {
    const hospitalId = context.tenant.hospitalId;
    return this.database.$transaction(async (transaction) => {
      const current = await this.bedSessions.lockOccupancySetting(
        transaction,
        hospitalId,
        'FOR NO KEY UPDATE',
      );
      if (current === null) throw new NotFoundError();
      const change = { enabled, releasedBeds: 0, closedStays: 0, revokedGuestSessions: 0 };
      if (current === enabled) return change;
      await this.bedSessions.setOccupancySetting(transaction, hospitalId, enabled);
      if (enabled) {
        const stays = await this.bedSessions.listActiveIds(transaction, hospitalId);
        change.closedStays = await this.bedSessions.closeMany(
          transaction,
          hospitalId,
          stays,
          context.membershipId,
        );
        change.revokedGuestSessions = await this.guestSessions.revokeForBedSessions(
          transaction,
          hospitalId,
          stays,
        );
      } else {
        change.releasedBeds = await releaseAllBeds(transaction, hospitalId);
      }
      await recordStaffAudit(transaction, context, requestId, {
        action: enabled ? 'hospital.bedOccupancy.enable' : 'hospital.bedOccupancy.disable',
        targetType: 'Hospital',
        targetId: hospitalId,
        metadata: {
          releasedBeds: change.releasedBeds,
          closedStays: change.closedStays,
          revokedGuestSessions: change.revokedGuestSessions,
        },
      });
      return change;
    });
  }

  // A shared lock: the setting cannot change until this admission commits.
  private async requireOccupancyManaged(
    transaction: Prisma.TransactionClient,
    hospitalId: string,
  ): Promise<void> {
    if (!(await this.bedSessions.lockOccupancySetting(transaction, hospitalId))) {
      throw new BedOccupancyOffError();
    }
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
