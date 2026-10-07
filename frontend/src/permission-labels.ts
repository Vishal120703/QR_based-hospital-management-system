import type { RoleScopeLevel } from './api';

// Plain-language names for every permission, grouped as a hospital manager
// thinks about them. Keys match services/src/modules/roles/permissions.ts.
export const permissionGroups: {
  title: string;
  permissions: { key: string; label: string }[];
}[] = [
  {
    title: 'Patient requests',
    permissions: [
      { key: 'request.read', label: 'See requests' },
      { key: 'request.assign', label: 'Assign requests to staff' },
      { key: 'request.accept', label: 'Accept their own assigned work' },
      { key: 'request.start', label: 'Start work' },
      { key: 'request.complete', label: 'Mark work complete' },
      { key: 'request.close', label: 'Close completed requests' },
      { key: 'request.cancel', label: 'Cancel requests' },
      { key: 'request.reject', label: 'Turn down assigned work' },
      { key: 'request.transfer', label: 'Hand work to someone else' },
    ],
  },
  {
    title: 'Beds and admissions',
    permissions: [
      { key: 'bed.read', label: 'See beds' },
      { key: 'bedSession.manage', label: 'Admit and discharge patients' },
      { key: 'bed.manage', label: 'Add and edit beds' },
      { key: 'location.read', label: 'See the hospital layout' },
      { key: 'location.manage', label: 'Change the hospital layout' },
    ],
  },
  {
    title: 'QR codes',
    permissions: [
      { key: 'qr.generate', label: 'Create and print QR labels' },
      { key: 'qr.rotate', label: 'Replace QR labels' },
      { key: 'qr.revoke', label: 'Disable QR labels' },
    ],
  },
  {
    title: 'People',
    permissions: [
      { key: 'staff.read', label: 'See staff and who can respond' },
      { key: 'staff.manage', label: 'Add staff, departments, duty, and coverage' },
      { key: 'role.read', label: 'See roles' },
      { key: 'role.manage', label: 'Create roles and give them to people' },
    ],
  },
  {
    title: 'Services',
    permissions: [
      { key: 'service.read', label: 'See the service catalog' },
      { key: 'service.manage', label: 'Change services' },
      { key: 'sla.manage', label: 'Change response-time targets' },
    ],
  },
  {
    title: 'Hospital',
    permissions: [
      { key: 'hospital.read', label: 'See hospital details' },
      { key: 'hospital.manage', label: 'Change hospital profile and logo' },
      { key: 'audit.read', label: 'See the audit log of every change' },
      {
        key: 'analytics.read',
        label: 'See reports: requests, who handled them, delays, and reasons',
      },
      { key: 'routing.manage', label: 'Change routing rules (coming later)' },
    ],
  },
];

export const levelLabels: Record<RoleScopeLevel, { name: string; help: string }> = {
  HOSPITAL: { name: 'Whole hospital', help: 'Applies everywhere in the hospital.' },
  FLOOR: { name: 'One floor', help: 'Chosen per person: they only see that floor.' },
  WARD: { name: 'One ward or unit', help: 'Chosen per person: they only see that ward.' },
  DEPARTMENT: {
    name: 'One department',
    help: "Chosen per person: they only see that department's requests.",
  },
};

export function permissionLabel(key: string): string {
  for (const group of permissionGroups) {
    const found = group.permissions.find((permission) => permission.key === key);
    if (found) return found.label;
  }
  return key;
}
