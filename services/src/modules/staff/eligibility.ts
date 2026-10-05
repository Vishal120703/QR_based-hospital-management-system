import { type Prisma, type PrismaClient } from '@prisma/client';
import { NotFoundError } from '../../common/errors/app-error.js';

export interface EligibleStaff {
  readonly membershipId: string;
  readonly displayName: string;
  readonly dutyChangedAt: Date | null;
}

// Who may receive a request for `departmentId` at `bedId`. A staff member is
// eligible only when ALL of these hold:
//   1. active membership in this hospital, and an active user account
//   2. member of the department, and the department is active
//   3. coverage includes the bed: HOSPITAL, the bed's FLOOR, or the bed's WARD
//   4. currently ON_DUTY
// Scheduled shifts do not affect eligibility in V1.
export async function findEligibleStaff(
  client: PrismaClient | Prisma.TransactionClient,
  hospitalId: string,
  query: { bedId: string; departmentId: string },
): Promise<EligibleStaff[]> {
  const bed = await client.bed.findUnique({
    where: { hospitalId_id: { hospitalId, id: query.bedId } },
    select: { wardId: true, ward: { select: { floorId: true } } },
  });
  if (!bed) {
    throw new NotFoundError('The referenced bed was not found.');
  }
  const department = await client.department.findUnique({
    where: { hospitalId_id: { hospitalId, id: query.departmentId } },
    select: { active: true },
  });
  if (!department) {
    throw new NotFoundError('The referenced department was not found.');
  }
  if (!department.active) {
    return [];
  }

  const members = await client.hospitalMembership.findMany({
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
            { scopeType: 'FLOOR', floorId: bed.ward.floorId },
            { scopeType: 'WARD', wardId: bed.wardId },
          ],
        },
      },
    },
    select: { id: true, dutyChangedAt: true, user: { select: { displayName: true } } },
    orderBy: { user: { displayName: 'asc' } },
  });
  return members.map((member) => ({
    membershipId: member.id,
    displayName: member.user.displayName,
    dutyChangedAt: member.dutyChangedAt,
  }));
}
