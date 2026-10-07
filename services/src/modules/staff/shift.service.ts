import { type PrismaClient, type Shift } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../common/errors/app-error.js';
import { recordStaffAudit } from '../audit/index.js';
import { type StaffContext } from '../auth/index.js';
import { ShiftRepository } from './shift.repository.js';
import { type CreateShiftInput, type ShiftFilter } from './shift.schemas.js';

const snapshot = (shift: Shift) => ({
  membershipId: shift.membershipId,
  departmentId: shift.departmentId,
  startsAt: shift.startsAt.toISOString(),
  endsAt: shift.endsAt.toISOString(),
});

// Scheduled work periods. Informational in V1: eligibility uses duty status.
export class ShiftService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly shifts = new ShiftRepository(),
  ) {}

  public list(context: StaffContext, filter: ShiftFilter) {
    return this.shifts.list(this.database, context.tenant.hospitalId, filter);
  }

  public create(context: StaffContext, input: CreateShiftInput, requestId: string) {
    const hospitalId = context.tenant.hospitalId;
    // Serializable so two overlapping shifts for one person cannot both commit.
    return this.database.$transaction(
      async (transaction) => {
        const member = await this.shifts.findMemberDepartments(
          transaction,
          hospitalId,
          input.membershipId,
        );
        if (!member) {
          throw new NotFoundError('The referenced staff member was not found.');
        }
        if (
          input.departmentId !== undefined &&
          !member.departments.some((item) => item.departmentId === input.departmentId)
        ) {
          throw new ConflictError('The staff member does not belong to that department.');
        }
        const overlapping = await this.shifts.countOverlapping(
          transaction,
          hospitalId,
          input.membershipId,
          input,
        );
        if (overlapping > 0) {
          throw new ConflictError('This shift overlaps another shift for the same staff member.');
        }
        const shift = await this.shifts.create(transaction, {
          hospitalId,
          membershipId: input.membershipId,
          departmentId: input.departmentId ?? null,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          createdByMembershipId: context.membershipId,
        });
        await recordStaffAudit(transaction, context, requestId, {
          action: 'shift.create',
          targetType: 'Shift',
          targetId: shift.id,
          metadata: { after: snapshot(shift) },
        });
        return shift;
      },
      { isolationLevel: 'Serializable' },
    );
  }

  public async remove(context: StaffContext, id: string, requestId: string): Promise<void> {
    const hospitalId = context.tenant.hospitalId;
    await this.database.$transaction(async (transaction) => {
      const shift = await this.shifts.findById(transaction, hospitalId, id);
      if (!shift) {
        throw new NotFoundError();
      }
      await this.shifts.delete(transaction, hospitalId, id);
      await recordStaffAudit(transaction, context, requestId, {
        action: 'shift.delete',
        targetType: 'Shift',
        targetId: id,
        metadata: { before: snapshot(shift) },
      });
    });
  }
}
