import { type Prisma } from '@prisma/client';
import { ConflictError, ForbiddenError, NotFoundError } from '../../common/errors/app-error.js';
import { type Db } from '../../database/client.js';
import { type StaffContext } from '../auth/index.js';
import { lockedRoleKey } from '../roles/index.js';
import { type StaffRepository, type StaffRow } from './staff.repository.js';

type Transaction = Prisma.TransactionClient;

export async function requireStaffMember(
  staff: StaffRepository,
  db: Db,
  context: StaffContext,
  membershipId: string,
): Promise<StaffRow> {
  const member = await staff.findMember(db, context.tenant.hospitalId, membershipId);
  if (!member) throw new NotFoundError();
  return member;
}

// A staff manager may act on someone only if they hold every permission that
// person has. Returning the roles lets the caller apply additional safety rules.
export async function requireNoGreaterPowers(
  staff: StaffRepository,
  transaction: Transaction,
  context: StaffContext,
  membershipId: string,
) {
  const roles = await staff.findActiveRoles(transaction, context.tenant.hospitalId, membershipId);
  const permissionKeys = roles.flatMap(({ role }) =>
    role.rolePermissions.map((item) => item.permissionKey),
  );
  if (permissionKeys.some((key) => !context.hospitalPermissions.has(key))) {
    throw new ForbiddenError();
  }
  return roles;
}

// Status changes cannot remove the hospital's final active Hospital Manager.
export async function requireSafeStatusChange(
  staff: StaffRepository,
  transaction: Transaction,
  context: StaffContext,
  membershipId: string,
  deactivating: boolean,
): Promise<void> {
  const roles = await requireNoGreaterPowers(staff, transaction, context, membershipId);
  if (!deactivating || !roles.some(({ role }) => role.systemKey === lockedRoleKey)) return;

  const otherManagers = await staff.countOtherActiveHolders(
    transaction,
    context.tenant.hospitalId,
    lockedRoleKey,
    membershipId,
  );
  if (otherManagers === 0) {
    throw new ConflictError('A hospital must keep at least one active Hospital Manager.');
  }
}

export function requireActiveStaffLocation(
  location: { active: boolean } | null,
  label: 'floor' | 'ward',
): void {
  if (!location) throw new NotFoundError(`The referenced ${label} was not found.`);
  if (!location.active) throw new ConflictError(`The ${label} is inactive.`);
}
