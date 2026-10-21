import { type Bed, type Coverage, type Floor, type StaffMember, type Ward } from '../../api';

// Where a bed is, so coverage can be compared with it.
export interface BedPlace {
  id: string;
  name: string;
  active: boolean;
  wardId: string;
  wardName: string;
  floorId: string;
  floorName: string;
}

export interface BedGroup {
  label: string;
  beds: BedPlace[];
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

// Beds grouped by floor (lowest first) and ward, so a long list stays easy to scan.
export function groupBeds(beds: Bed[], wards: Ward[], floors: Floor[]): BedGroup[] {
  const groups = new Map<string, BedGroup & { level: number; floorName: string }>();
  for (const bed of beds) {
    const ward = wards.find((item) => item.id === bed.wardId);
    const floor = floors.find((item) => item.id === ward?.floorId);
    const place: BedPlace = {
      id: bed.id,
      name: bed.displayName,
      active: bed.active,
      wardId: bed.wardId,
      wardName: ward?.name ?? 'Unknown ward',
      floorId: floor?.id ?? '',
      floorName: floor?.name ?? 'Unknown floor',
    };
    const key = `${place.floorId}/${place.wardId}`;
    const group = groups.get(key) ?? {
      label: `${place.floorName} · ${place.wardName}`,
      beds: [],
      level: floor?.level ?? Number.MAX_SAFE_INTEGER,
      floorName: place.floorName,
    };
    group.beds.push(place);
    groups.set(key, group);
  }
  return [...groups.values()]
    .sort(
      (a, b) => a.level - b.level || byName(a.floorName, b.floorName) || byName(a.label, b.label),
    )
    .map(({ label, beds: places }) => ({
      label,
      beds: places.sort((a, b) => byName(a.name, b.name)),
    }));
}

// The coverage entry that puts this bed in someone's area, if any.
export function coverageFor(member: StaffMember, bed: BedPlace): Coverage | undefined {
  return (
    member.coverage.find((scope) => scope.scopeType === 'HOSPITAL') ??
    member.coverage.find((scope) => scope.scopeType === 'FLOOR' && scope.floorId === bed.floorId) ??
    member.coverage.find((scope) => scope.scopeType === 'WARD' && scope.wardId === bed.wardId)
  );
}

export function coverageText(scope: Coverage, bed: BedPlace): string {
  if (scope.scopeType === 'HOSPITAL') return 'Covers the whole hospital';
  return scope.scopeType === 'FLOOR' ? `Covers ${bed.floorName}` : `Covers ${bed.wardName}`;
}

export type Blocker = 'SUSPENDED' | 'INACTIVE' | 'OFF_DUTY' | 'NOT_COVERING';

// Why someone in the department cannot take a request at this bed. The server
// (services/src/modules/staff/eligibility.ts) decides who is eligible; this
// only explains everyone else with the same four checks.
export function blockersFor(member: StaffMember, bed: BedPlace): Blocker[] {
  const blockers: Blocker[] = [];
  if (member.status === 'SUSPENDED') blockers.push('SUSPENDED');
  else if (member.status !== 'ACTIVE') blockers.push('INACTIVE');
  if (member.dutyStatus !== 'ON_DUTY') blockers.push('OFF_DUTY');
  if (!coverageFor(member, bed)) blockers.push('NOT_COVERING');
  return blockers;
}

export function blockerText(blocker: Blocker, bed: BedPlace): string {
  switch (blocker) {
    case 'SUSPENDED':
      return 'Account suspended';
    case 'INACTIVE':
      return 'Account inactive';
    case 'OFF_DUTY':
      return 'Off duty';
    case 'NOT_COVERING':
      return `Doesn’t cover ${bed.wardName} (${bed.floorName})`;
  }
}

export function initials(name: string): string {
  const words = name
    .replace(/^(Dr|Mr|Mrs|Ms)\.?\s+/i, '')
    .split(/\s+/)
    .filter(Boolean);
  return (
    (words[0]?.[0] ?? '') + (words.length > 1 ? (words.at(-1)?.[0] ?? '') : '')
  ).toUpperCase();
}
