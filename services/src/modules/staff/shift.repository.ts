import { type Db } from '../../database/client.js';

const listLimit = 200;

// Scheduled work periods.
export class ShiftRepository {
  // Shifts overlapping [from, to), earliest first, at most 200.
  public list(
    db: Db,
    hospitalId: string,
    filter: { membershipId?: string | undefined; from?: Date | undefined; to?: Date | undefined },
  ) {
    return db.shift.findMany({
      where: {
        hospitalId,
        ...(filter.membershipId !== undefined ? { membershipId: filter.membershipId } : {}),
        ...(filter.from !== undefined ? { endsAt: { gt: filter.from } } : {}),
        ...(filter.to !== undefined ? { startsAt: { lt: filter.to } } : {}),
      },
      orderBy: { startsAt: 'asc' },
      take: listLimit,
    });
  }

  public findMemberDepartments(db: Db, hospitalId: string, membershipId: string) {
    return db.hospitalMembership.findUnique({
      where: { hospitalId_id: { hospitalId, id: membershipId } },
      select: { id: true, departments: { select: { departmentId: true } } },
    });
  }

  public countOverlapping(
    db: Db,
    hospitalId: string,
    membershipId: string,
    period: { startsAt: Date; endsAt: Date },
  ) {
    return db.shift.count({
      where: {
        hospitalId,
        membershipId,
        startsAt: { lt: period.endsAt },
        endsAt: { gt: period.startsAt },
      },
    });
  }

  public create(
    db: Db,
    data: {
      hospitalId: string;
      membershipId: string;
      departmentId: string | null;
      startsAt: Date;
      endsAt: Date;
      createdByMembershipId: string;
    },
  ) {
    return db.shift.create({ data });
  }

  public findById(db: Db, hospitalId: string, id: string) {
    return db.shift.findUnique({ where: { hospitalId_id: { hospitalId, id } } });
  }

  public async delete(db: Db, hospitalId: string, id: string): Promise<void> {
    await db.shift.delete({ where: { hospitalId_id: { hospitalId, id } } });
  }
}
