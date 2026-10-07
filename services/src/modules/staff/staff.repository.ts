import { type DutyStatus, type MembershipStatus, type Prisma } from '@prisma/client';
import { type Db } from '../../database/client.js';

// A staff member is a HospitalMembership; the User is the global identity.
export const staffSelect = {
  id: true,
  status: true,
  dutyStatus: true,
  dutyChangedAt: true,
  createdAt: true,
  user: { select: { id: true, email: true, displayName: true, status: true } },
  departments: { select: { departmentId: true }, orderBy: { createdAt: 'asc' } },
  locationScopes: {
    select: { id: true, scopeType: true, floorId: true, wardId: true },
    orderBy: { createdAt: 'asc' },
  },
  userRoles: {
    select: { roleId: true, scopes: { select: { scopeType: true, scopeId: true } } },
  },
} satisfies Prisma.HospitalMembershipSelect;

export type StaffRow = Prisma.HospitalMembershipGetPayload<{ select: typeof staffSelect }>;

// Staff accounts and memberships, their departments and coverage, and the
// lookups behind "who can respond".
export class StaffRepository {
  public list(
    db: Db,
    hospitalId: string,
    filter: {
      status?: MembershipStatus | undefined;
      dutyStatus?: DutyStatus | undefined;
      departmentId?: string | undefined;
    },
  ) {
    return db.hospitalMembership.findMany({
      where: {
        hospitalId,
        ...(filter.status !== undefined ? { status: filter.status } : {}),
        ...(filter.dutyStatus !== undefined ? { dutyStatus: filter.dutyStatus } : {}),
        ...(filter.departmentId !== undefined
          ? { departments: { some: { departmentId: filter.departmentId } } }
          : {}),
      },
      select: staffSelect,
      orderBy: { user: { displayName: 'asc' } },
    });
  }

  public findMember(db: Db, hospitalId: string, id: string) {
    return db.hospitalMembership.findUnique({
      where: { hospitalId_id: { hospitalId, id } },
      select: staffSelect,
    });
  }

  public findUserByEmail(db: Db, email: string) {
    return db.user.findUnique({ where: { email } });
  }

  public createUser(db: Db, data: { email: string; displayName: string; passwordHash: string }) {
    return db.user.create({ data });
  }

  public createMembership(db: Db, data: { hospitalId: string; userId: string }) {
    return db.hospitalMembership.create({ data });
  }

  public async updateMembership(
    db: Db,
    hospitalId: string,
    id: string,
    data: { status?: MembershipStatus; dutyStatus?: DutyStatus; dutyChangedAt?: Date },
  ): Promise<void> {
    await db.hospitalMembership.update({ where: { hospitalId_id: { hospitalId, id } }, data });
  }

  // The person's active roles with their permissions (for "who may change whom").
  public findActiveRoles(db: Db, hospitalId: string, membershipId: string) {
    return db.userRole.findMany({
      where: { hospitalId, membershipId, role: { active: true } },
      select: {
        role: {
          select: { systemKey: true, rolePermissions: { select: { permissionKey: true } } },
        },
      },
    });
  }

  public countOtherActiveHolders(
    db: Db,
    hospitalId: string,
    systemKey: string,
    exceptMembershipId: string,
  ) {
    return db.userRole.count({
      where: {
        hospitalId,
        role: { systemKey },
        membershipId: { not: exceptMembershipId },
        membership: { status: 'ACTIVE' },
      },
    });
  }

  public findDepartment(db: Db, hospitalId: string, id: string) {
    return db.department.findUnique({ where: { hospitalId_id: { hospitalId, id } } });
  }

  public async addDepartment(
    db: Db,
    hospitalId: string,
    membershipId: string,
    departmentId: string,
  ): Promise<void> {
    await db.staffDepartment.create({ data: { hospitalId, membershipId, departmentId } });
  }

  public async removeDepartment(
    db: Db,
    hospitalId: string,
    membershipId: string,
    departmentId: string,
  ): Promise<number> {
    return (
      await db.staffDepartment.deleteMany({ where: { hospitalId, membershipId, departmentId } })
    ).count;
  }

  public findFloor(db: Db, hospitalId: string, id: string) {
    return db.floor.findUnique({ where: { hospitalId_id: { hospitalId, id } } });
  }

  public findWard(db: Db, hospitalId: string, id: string) {
    return db.ward.findUnique({ where: { hospitalId_id: { hospitalId, id } } });
  }

  public addCoverage(
    db: Db,
    data: {
      hospitalId: string;
      membershipId: string;
      scopeType: 'HOSPITAL' | 'FLOOR' | 'WARD';
      floorId: string | null;
      wardId: string | null;
    },
  ) {
    return db.staffLocationScope.create({ data });
  }

  public async removeCoverage(
    db: Db,
    hospitalId: string,
    membershipId: string,
    id: string,
  ): Promise<number> {
    return (await db.staffLocationScope.deleteMany({ where: { hospitalId, membershipId, id } }))
      .count;
  }

  // The ward and floor of a bed.
  public findBedPlace(db: Db, hospitalId: string, bedId: string) {
    return db.bed.findUnique({
      where: { hospitalId_id: { hospitalId, id: bedId } },
      select: { wardId: true, ward: { select: { floorId: true } } },
    });
  }

  // Active, on-duty members of the department whose coverage includes the
  // bed's ward or floor (or the whole hospital).
  public findEligibleMembers(
    db: Db,
    hospitalId: string,
    query: { departmentId: string; wardId: string; floorId: string },
  ) {
    return db.hospitalMembership.findMany({
      where: {
        hospitalId,
        status: 'ACTIVE',
        dutyStatus: 'ON_DUTY',
        user: { status: 'ACTIVE' },
        departments: { some: { departmentId: query.departmentId } },
        locationScopes: {
          some: {
            OR: [
              { scopeType: 'HOSPITAL' },
              { scopeType: 'FLOOR', floorId: query.floorId },
              { scopeType: 'WARD', wardId: query.wardId },
            ],
          },
        },
      },
      select: { id: true, dutyChangedAt: true, user: { select: { displayName: true } } },
      orderBy: { user: { displayName: 'asc' } },
    });
  }
}
