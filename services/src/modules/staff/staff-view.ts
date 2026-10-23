import { type StaffRow } from './staff.repository.js';

// The repository row contains storage relationships; the API view keeps the
// stable, client-facing shape in one place as staff features grow.
export function toStaffView(row: StaffRow) {
  return {
    id: row.id,
    userId: row.user.id,
    email: row.user.email,
    displayName: row.user.displayName,
    userStatus: row.user.status,
    status: row.status,
    dutyStatus: row.dutyStatus,
    dutyChangedAt: row.dutyChangedAt,
    createdAt: row.createdAt,
    departmentIds: row.departments.map((item) => item.departmentId),
    coverage: row.locationScopes,
    roleIds: row.userRoles.map((item) => item.roleId),
    // Where each role applies: the hospital, or specific floors, wards, or departments.
    roleAssignments: row.userRoles.map((item) => ({
      roleId: item.roleId,
      scopes: item.scopes.map((scope) => ({ type: scope.scopeType, id: scope.scopeId })),
    })),
  };
}

export type StaffView = ReturnType<typeof toStaffView>;
