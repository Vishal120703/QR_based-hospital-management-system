import { type RoleScopeLevel, type ScopeType } from '@prisma/client';
import { type StaffContext } from '../auth/index.js';

const scopeTypeByLevel: Record<RoleScopeLevel, ScopeType> = {
  HOSPITAL: 'HOSPITAL',
  FLOOR: 'FLOOR',
  WARD: 'WARD',
  DEPARTMENT: 'DEPARTMENT',
};

export function scopeTypeForLevel(level: RoleScopeLevel): ScopeType {
  return scopeTypeByLevel[level];
}

// Nobody may hand out, change, or take away more power than they hold
// hospital-wide.
export function permissionsExceedCaller(
  context: Pick<StaffContext, 'hospitalPermissions'>,
  permissions: readonly { readonly permissionKey: string }[],
): boolean {
  return permissions.some((item) => !context.hospitalPermissions.has(item.permissionKey));
}
