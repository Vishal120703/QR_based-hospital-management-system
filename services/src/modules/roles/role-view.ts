import { builtInRoles, lockedRoleKey } from './built-in-roles.js';
import { type RoleRow } from './role.repository.js';

// API presentation stays separate from role mutation rules. Adding fields to
// the stored role no longer makes the service methods harder to scan.
export function toRoleView({ rolePermissions, _count, ...role }: RoleRow) {
  return {
    ...role,
    permissionKeys: rolePermissions.map((item) => item.permissionKey).sort(),
    // Kept for older clients that read the raw relation.
    rolePermissions,
    memberCount: _count.userRoles,
    builtIn: role.systemKey !== null,
    locked: role.systemKey === lockedRoleKey,
  };
}

export function roleSnapshot(role: RoleRow) {
  return {
    name: role.name,
    description: role.description,
    active: role.active,
    scopeLevel: role.scopeLevel,
    permissionKeys: role.rolePermissions.map((item) => item.permissionKey),
  };
}

export function sortRolesForDisplay(roles: readonly RoleRow[]): RoleRow[] {
  const rank = (role: RoleRow) => {
    const index = builtInRoles.findIndex((item) => item.key === role.systemKey);
    return index < 0 ? builtInRoles.length : index;
  };
  return [...roles].sort(
    (left, right) => rank(left) - rank(right) || left.name.localeCompare(right.name),
  );
}
