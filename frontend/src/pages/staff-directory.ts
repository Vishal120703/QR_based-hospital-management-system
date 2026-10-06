import {
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

export function nameOf(items: { id: string; name: string }[], id: string): string {
  return items.find((item) => item.id === id)?.name ?? 'Unknown';
}

export function coverageLabel(scope: Coverage, directory: Directory): string {
  if (scope.scopeType === 'HOSPITAL') return 'Whole hospital';
  if (scope.scopeType === 'FLOOR') return `Floor: ${nameOf(directory.floors, scope.floorId ?? '')}`;
  return `Ward: ${nameOf(directory.wards, scope.wardId ?? '')}`;
}
