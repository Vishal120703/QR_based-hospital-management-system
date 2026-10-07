import { NotFoundError } from '../../common/errors/app-error.js';
import { type Db } from '../../database/client.js';
import { StaffRepository } from './staff.repository.js';

const repository = new StaffRepository();

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
  client: Db,
  hospitalId: string,
  query: { bedId: string; departmentId: string },
): Promise<EligibleStaff[]> {
  const bed = await repository.findBedPlace(client, hospitalId, query.bedId);
  if (!bed) {
    throw new NotFoundError('The referenced bed was not found.');
  }
  const department = await repository.findDepartment(client, hospitalId, query.departmentId);
  if (!department) {
    throw new NotFoundError('The referenced department was not found.');
  }
  if (!department.active) {
    return [];
  }

  const members = await repository.findEligibleMembers(client, hospitalId, {
    departmentId: query.departmentId,
    wardId: bed.wardId,
    floorId: bed.ward.floorId,
  });
  return members.map((member) => ({
    membershipId: member.id,
    displayName: member.user.displayName,
    dutyChangedAt: member.dutyChangedAt,
  }));
}
