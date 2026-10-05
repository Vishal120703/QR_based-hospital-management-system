import {
  staffApi,
  type Coverage,
  type Department,
  type Floor,
  type Role,
  type StaffMember,
  type Ward,
} from '../api';

// Everything the staff screens need to show names instead of IDs.
export interface Directory {
  staff: StaffMember[];
  departments: Department[];
  roles: Role[];
  floors: Floor[];
  wards: Ward[];
}

export async function loadDirectory(token: string, canReadRoles: boolean): Promise<Directory> {
  const [staff, departments, roles, floors, wards] = await Promise.all([
    staffApi.list<StaffMember>(token, 'staff'),
    staffApi.list<Department>(token, 'departments'),
    canReadRoles ? staffApi.list<Role>(token, 'roles') : Promise.resolve([]),
    staffApi.list<Floor>(token, 'floors'),
    staffApi.list<Ward>(token, 'wards'),
  ]);
  return { staff, departments, roles, floors, wards };
}

export function nameOf(items: { id: string; name: string }[], id: string): string {
  return items.find((item) => item.id === id)?.name ?? 'Unknown';
}

export function coverageLabel(scope: Coverage, directory: Directory): string {
  if (scope.scopeType === 'HOSPITAL') return 'Whole hospital';
  if (scope.scopeType === 'FLOOR') return `Floor: ${nameOf(directory.floors, scope.floorId ?? '')}`;
  return `Ward: ${nameOf(directory.wards, scope.wardId ?? '')}`;
}
