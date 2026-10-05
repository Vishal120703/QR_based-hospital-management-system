import { type PrismaClient, type Shift } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../common/errors/app-error.js';
import { recordStaffAudit } from '../audit/audit-log.js';
import { type StaffContext } from '../auth/auth.service.js';

const listLimit = 200;

export interface ShiftFilter {
  readonly membershipId?: string | undefined;
  readonly from?: Date | undefined;
  readonly to?: Date | undefined;
}

export interface ShiftInput {
  readonly membershipId: string;
  readonly departmentId?: string | undefined;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

const snapshot = (shift: Shift) => ({
  membershipId: shift.membershipId,
  departmentId: shift.departmentId,
  startsAt: shift.startsAt.toISOString(),
  endsAt: shift.endsAt.toISOString(),
});

// Scheduled work periods. Informational in V1: eligibility uses duty status.
export class ShiftService {
  public constructor(private readonly database: PrismaClient) {}

  // Shifts overlapping [from, to), earliest first, at most 200.
  public list(context: StaffContext, filter: ShiftFilter) {
    return this.database.shift.findMany({
      where: {
        hospitalId: context.tenant.hospitalId,
        ...(filter.membershipId !== undefined ? { membershipId: filter.membershipId } : {}),
        ...(filter.from !== undefined ? { endsAt: { gt: filter.from } } : {}),
        ...(filter.to !== undefined ? { startsAt: { lt: filter.to } } : {}),
      },
      orderBy: { startsAt: 'asc' },
      take: listLimit,
    });
  }

  public create(context: StaffContext, input: ShiftInput, requestId: string) {
    const hospitalId = context.tenant.hospitalId;
    // Serializable so two overlapping shifts for one person cannot both commit.
    return this.database.$transaction(
      async (transaction) => {
        const member = await transaction.hospitalMembership.findUnique({
          where: { hospitalId_id: { hospitalId, id: input.membershipId } },
          select: { id: true, departments: { select: { departmentId: true } } },
        });
        if (!member) {
          throw new NotFoundError('The referenced staff member was not found.');
        }
        if (
          input.departmentId !== undefined &&
          !member.departments.some((item) => item.departmentId === input.departmentId)
        ) {
          throw new ConflictError('The staff member does not belong to that department.');
        }
        const overlapping = await transaction.shift.count({
          where: {
            hospitalId,
            membershipId: input.membershipId,
            startsAt: { lt: input.endsAt },
            endsAt: { gt: input.startsAt },
          },
        });
        if (overlapping > 0) {
          throw new ConflictError('This shift overlaps another shift for the same staff member.');
        }
        const shift = await transaction.shift.create({
          data: {
            hospitalId,
            membershipId: input.membershipId,
            departmentId: input.departmentId ?? null,
            startsAt: input.startsAt,
            endsAt: input.endsAt,
            createdByMembershipId: context.membershipId,
          },
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

  public async delete(context: StaffContext, id: string, requestId: string): Promise<void> {
    const hospitalId = context.tenant.hospitalId;
    await this.database.$transaction(async (transaction) => {
      const shift = await transaction.shift.findUnique({
        where: { hospitalId_id: { hospitalId, id } },
      });
      if (!shift) {
        throw new NotFoundError();
      }
      await transaction.shift.delete({ where: { hospitalId_id: { hospitalId, id } } });
      await recordStaffAudit(transaction, context, requestId, {
        action: 'shift.delete',
        targetType: 'Shift',
        targetId: id,
        metadata: { before: snapshot(shift) },
      });
    });
  }
}
