import { type RoleScopeLevel } from '@prisma/client';
import { permissionCatalog, type PermissionKey } from './permissions.js';

export type BuiltInRoleKey =
  'HOSPITAL_MANAGER' | 'FLOOR_MANAGER' | 'WARD_MANAGER' | 'DEPARTMENT_SUPERVISOR' | 'CARE_STAFF';

export interface BuiltInRole {
  readonly key: BuiltInRoleKey;
  readonly name: string;
  readonly description: string;
  readonly scopeLevel: RoleScopeLevel;
  readonly permissions: readonly PermissionKey[];
}

// Managers below the hospital level handle the requests, admissions, and
// staff availability for their own area only.
const areaManager: readonly PermissionKey[] = [
  'location.read',
  'bed.read',
  'bedSession.manage',
  'staff.read',
  'request.read',
  'request.assign',
  'request.close',
  'request.cancel',
  'request.transfer',
  'analytics.read',
];

// Every hospital gets these roles. The hierarchy is: Hospital Manager, then
// Floor and Ward Managers and Department Supervisors, then Care Staff.
// Migrations 09, 10, and 11 created them for hospitals that existed before; keep them
// in step when changing a permission list (a new migration updates old hospitals).
export const builtInRoles: readonly BuiltInRole[] = [
  {
    key: 'HOSPITAL_MANAGER',
    name: 'Hospital Manager',
    description:
      'Runs the whole hospital: setup, staff, roles and access, QR labels, and requests.',
    scopeLevel: 'HOSPITAL',
    permissions: permissionCatalog.map(([key]) => key),
  },
  {
    key: 'FLOOR_MANAGER',
    name: 'Floor Manager',
    description: 'Admits and discharges patients and assigns requests on one floor.',
    scopeLevel: 'FLOOR',
    permissions: areaManager,
  },
  {
    key: 'WARD_MANAGER',
    name: 'Ward Manager',
    description: 'Admits and discharges patients and assigns requests in one ward or unit.',
    scopeLevel: 'WARD',
    permissions: areaManager,
  },
  {
    key: 'DEPARTMENT_SUPERVISOR',
    name: 'Department Supervisor',
    description: "Assigns and closes one department's requests across the hospital.",
    scopeLevel: 'DEPARTMENT',
    permissions: [
      'staff.read',
      'request.read',
      'request.assign',
      'request.close',
      'request.cancel',
      'request.transfer',
      'analytics.read',
    ],
  },
  {
    key: 'CARE_STAFF',
    name: 'Care Staff',
    description: 'Accepts, starts, and completes the requests assigned to them.',
    scopeLevel: 'HOSPITAL',
    permissions: [
      'request.read',
      'request.accept',
      'request.start',
      'request.complete',
      'request.reject',
    ],
  },
];

export const lockedRoleKey: BuiltInRoleKey = 'HOSPITAL_MANAGER';
