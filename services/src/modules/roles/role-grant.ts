import { type Prisma, type RoleScopeLevel, type ScopeType } from '@prisma/client';
import {
  ConflictError,
  ForbiddenError,
  InvalidInputError,
  NotFoundError,
} from '../../common/errors/app-error.js';
import type { StaffContext } from '../auth/index.js';
import { RoleRepository } from './role.repository.js';

type Transaction = Prisma.TransactionClient;
const repository = new RoleRepository();
const scopeTypeFor: Record<RoleScopeLevel, ScopeType> = {
  HOSPITAL: 'HOSPITAL',
  FLOOR: 'FLOOR',
  WARD: 'WARD',
  DEPARTMENT: 'DEPARTMENT',
};

// Resolves and authorizes a role grant that will be committed by the caller's
// transaction. Shared by ordinary assignment and atomic bulk onboarding.
export async function resolveRoleGrant(
  transaction: Transaction,
  context: StaffContext,
  roleId: string,
  scopeId: string | undefined,
): Promise<{ roleId: string; scopeType: ScopeType; scopeId: string }> {
  const hospitalId = context.tenant.hospitalId;
  const role = await repository.findActiveWithPermissions(transaction, hospitalId, roleId);
  if (!role) throw new NotFoundError('The selected role was not found.');
  if (
    role.rolePermissions.some(
      ({ permissionKey }) => !context.hospitalPermissions.has(permissionKey),
    )
  ) {
    throw new ForbiddenError();
  }
  if (role.scopeLevel === 'HOSPITAL') {
    if (scopeId && scopeId !== hospitalId) {
      throw new InvalidInputError('A hospital-wide role must not specify a role scope.');
    }
    return { roleId, scopeType: 'HOSPITAL', scopeId: hospitalId };
  }
  if (!scopeId) {
    throw new InvalidInputError(
      `Choose the ${role.scopeLevel.toLowerCase()} for the selected role.`,
    );
  }
  const place = await repository.findPlace(transaction, hospitalId, role.scopeLevel, scopeId);
  if (!place) {
    throw new NotFoundError(`The selected ${role.scopeLevel.toLowerCase()} was not found.`);
  }
  if (!place.active) {
    throw new ConflictError(`The selected ${role.scopeLevel.toLowerCase()} is inactive.`);
  }
  return { roleId, scopeType: scopeTypeFor[role.scopeLevel], scopeId };
}
