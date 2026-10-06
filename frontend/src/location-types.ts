import type { BedType, BulkBedsInput, Floor, RoomType, WardType } from './api';

export interface UnitPreset {
  label: string;
  name: string;
  code: string;
  bedType: BedType;
  // How beds are usually laid out in this kind of unit.
  layout: { mode: 'BEDS' } | { mode: 'ROOMS'; roomType: RoomType; bedsPerRoom: number };
  hint: string;
}

// Common clinical units, so a new hospital can pick a unit type and get
// sensible names, bed types, and bed layout to start from.
export const unitPresets: Record<WardType, UnitPreset> = {
  GENERAL: {
    label: 'General ward',
    name: 'General Ward',
    code: 'GW',
    bedType: 'STANDARD',
    layout: { mode: 'BEDS' },
    hint: 'Open ward with numbered beds.',
  },
  PRIVATE: {
    label: 'Private rooms',
    name: 'Private Ward',
    code: 'PVT',
    bedType: 'STANDARD',
    layout: { mode: 'ROOMS', roomType: 'PRIVATE', bedsPerRoom: 1 },
    hint: 'One patient per room; the QR is named after the room.',
  },
  SEMI_PRIVATE: {
    label: 'Semi-private rooms',
    name: 'Semi-Private Ward',
    code: 'SPW',
    bedType: 'STANDARD',
    layout: { mode: 'ROOMS', roomType: 'SEMI_PRIVATE', bedsPerRoom: 2 },
    hint: 'Two or three patients share a room.',
  },
  ICU: {
    label: 'ICU (intensive care)',
    name: 'Intensive Care Unit',
    code: 'ICU',
    bedType: 'ICU',
    layout: { mode: 'BEDS' },
    hint: 'Critical care beds. Attendants usually use the QR.',
  },
  HDU: {
    label: 'HDU (high dependency)',
    name: 'High Dependency Unit',
    code: 'HDU',
    bedType: 'ICU',
    layout: { mode: 'BEDS' },
    hint: 'Step-down care between ICU and ward.',
  },
  CCU: {
    label: 'CCU / cardiac care',
    name: 'Cardiac Care Unit',
    code: 'CCU',
    bedType: 'ICU',
    layout: { mode: 'BEDS' },
    hint: 'Coronary and cardiac critical care.',
  },
  NICU: {
    label: 'NICU (newborn ICU)',
    name: 'Neonatal ICU',
    code: 'NICU',
    bedType: 'NEONATAL',
    layout: { mode: 'BEDS' },
    hint: 'Incubators and warmers; parents use the QR.',
  },
  PICU: {
    label: 'PICU (children’s ICU)',
    name: 'Pediatric ICU',
    code: 'PICU',
    bedType: 'ICU',
    layout: { mode: 'BEDS' },
    hint: 'Critical care for children.',
  },
  EMERGENCY: {
    label: 'Emergency / casualty',
    name: 'Emergency Department',
    code: 'ER',
    bedType: 'EMERGENCY_TROLLEY',
    layout: { mode: 'BEDS' },
    hint: 'Trolleys and observation bays.',
  },
  DAY_CARE: {
    label: 'Day care',
    name: 'Day Care Unit',
    code: 'DC',
    bedType: 'DAY_CARE_CHAIR',
    layout: { mode: 'BEDS' },
    hint: 'Same-day procedures, chemotherapy, infusions.',
  },
  MATERNITY: {
    label: 'Maternity / postnatal',
    name: 'Maternity Ward',
    code: 'MAT',
    bedType: 'STANDARD',
    layout: { mode: 'BEDS' },
    hint: 'Mothers after delivery.',
  },
  LABOUR_ROOM: {
    label: 'Labour room',
    name: 'Labour Room',
    code: 'LR',
    bedType: 'LABOUR',
    layout: { mode: 'BEDS' },
    hint: 'Labour and delivery beds.',
  },
  PEDIATRIC: {
    label: 'Pediatric ward',
    name: 'Pediatric Ward',
    code: 'PED',
    bedType: 'PEDIATRIC_COT',
    layout: { mode: 'BEDS' },
    hint: 'Children’s beds and cots.',
  },
  ISOLATION: {
    label: 'Isolation',
    name: 'Isolation Ward',
    code: 'ISO',
    bedType: 'ISOLATION',
    layout: { mode: 'ROOMS', roomType: 'ISOLATION', bedsPerRoom: 1 },
    hint: 'Infection control; usually single rooms.',
  },
  BURNS: {
    label: 'Burns unit',
    name: 'Burns Unit',
    code: 'BRN',
    bedType: 'STANDARD',
    layout: { mode: 'BEDS' },
    hint: 'Specialised burns care.',
  },
  DIALYSIS: {
    label: 'Dialysis',
    name: 'Dialysis Unit',
    code: 'DIA',
    bedType: 'DIALYSIS_CHAIR',
    layout: { mode: 'BEDS' },
    hint: 'Dialysis chairs or beds.',
  },
  RECOVERY: {
    label: 'Post-op recovery',
    name: 'Post-Operative Recovery',
    code: 'REC',
    bedType: 'STANDARD',
    layout: { mode: 'BEDS' },
    hint: 'Recovery after surgery.',
  },
  PSYCHIATRY: {
    label: 'Psychiatry',
    name: 'Psychiatry Ward',
    code: 'PSY',
    bedType: 'STANDARD',
    layout: { mode: 'BEDS' },
    hint: 'Mental health inpatient care.',
  },
  OTHER: {
    label: 'Other unit',
    name: '',
    code: '',
    bedType: 'STANDARD',
    layout: { mode: 'BEDS' },
    hint: 'Any other area where patients are cared for.',
  },
};

export const wardTypes = Object.keys(unitPresets) as WardType[];

export const roomTypeLabels: Record<RoomType, string> = {
  GENERAL: 'Shared room',
  PRIVATE: 'Private (1 patient)',
  SEMI_PRIVATE: 'Semi-private',
  DELUXE: 'Deluxe',
  SUITE: 'Suite',
  ISOLATION: 'Isolation',
  OTHER: 'Other',
};

export const bedTypeLabels: Record<BedType, string> = {
  STANDARD: 'Standard bed',
  ICU: 'ICU bed',
  VENTILATOR: 'Ventilator bed',
  ISOLATION: 'Isolation bed',
  PEDIATRIC_COT: 'Pediatric cot',
  NEONATAL: 'Incubator / warmer',
  DAY_CARE_CHAIR: 'Day-care recliner',
  DIALYSIS_CHAIR: 'Dialysis chair',
  EMERGENCY_TROLLEY: 'Emergency trolley',
  LABOUR: 'Labour bed',
  OTHER: 'Other',
};

export function floorLevelLabel(level: number | null): string {
  if (level === null) return '';
  if (level < 0) return `Basement ${-level}`;
  if (level === 0) return 'Ground';
  return `Level ${level}`;
}

// Suggested code and name for a new floor at a level.
export function floorSuggestion(level: number): { code: string; name: string } {
  if (level < 0) return { code: `B${-level}`, name: `Basement ${-level}` };
  if (level === 0) return { code: 'G', name: 'Ground Floor' };
  const ordinals = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth'];
  return { code: `F${level}`, name: `${ordinals[level - 1] ?? `Level ${level}`} Floor` };
}

export function sortFloors(floors: Floor[]): Floor[] {
  return [...floors].sort(
    (left, right) =>
      (left.level ?? Number.MAX_SAFE_INTEGER) - (right.level ?? Number.MAX_SAFE_INTEGER) ||
      left.code.localeCompare(right.code),
  );
}

// Mirrors the server's numbering rule so the preview matches what is created.
export function planBulkBeds(input: BulkBedsInput): {
  rooms: string[];
  beds: { code: string; displayName: string }[];
} {
  const last = input.start + input.count - 1;
  const width = Math.max(2, String(last).length);
  const numbers = Array.from(
    { length: Math.max(0, Math.min(input.count, 300)) },
    (_, index) => input.start + index,
  );
  const pad = (number: number) => String(number).padStart(width, '0');
  if (input.mode === 'BEDS') {
    return {
      rooms: [],
      beds: numbers.map((number) => ({
        code: `${input.codePrefix}${pad(number)}`.toUpperCase(),
        displayName: `${input.namePrefix} ${pad(number)}`.trim(),
      })),
    };
  }
  const rooms = numbers.map((number) => `${input.roomPrefix}${pad(number)}`.toUpperCase());
  return {
    rooms,
    beds: rooms.flatMap((room) =>
      input.bedsPerRoom === 1
        ? [{ code: room, displayName: `Room ${room}` }]
        : Array.from({ length: input.bedsPerRoom }, (_, index) => {
            const code = `${room}-${String.fromCharCode(65 + index)}`;
            return { code, displayName: `Bed ${code}` };
          }),
    ),
  };
}

export function previewList(codes: string[]): string {
  if (codes.length <= 4) return codes.join(', ');
  return `${codes.slice(0, 3).join(', ')}, … ${codes[codes.length - 1]}`;
}
