import { type QrIssue } from './qr-code.js';

export const maxBatchLabels = 300;

export interface QrBatchIssue extends QrIssue {
  readonly bedId: string;
  readonly bedName: string;
  readonly bedCode: string;
  readonly location: string;
}

export interface QrBatchResult {
  readonly issues: QrBatchIssue[];
  readonly totalBeds: number;
  readonly replaced: number;
  readonly skippedActive: number;
  readonly skippedInactive: number;
}

interface LocatedBed {
  readonly code: string;
  readonly room: { readonly code: string; readonly name?: string } | null;
  readonly ward: {
    readonly code: string;
    readonly name?: string;
    readonly floor: {
      readonly code: string;
      readonly name?: string;
      readonly level: number | null;
      readonly building: { readonly code: string; readonly name?: string } | null;
    };
  };
}

const naturally = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

// Building, floor level, ward, room, then bed, with "Bed 2" before "Bed 10".
export function sortBedsForLabels<T extends LocatedBed>(beds: readonly T[]): T[] {
  const levelOf = (bed: LocatedBed) => bed.ward.floor.level ?? Number.MAX_SAFE_INTEGER;
  const compare = (left: LocatedBed, right: LocatedBed) =>
    naturally.compare(
      left.ward.floor.building?.code ?? '~',
      right.ward.floor.building?.code ?? '~',
    ) ||
    levelOf(left) - levelOf(right) ||
    naturally.compare(left.ward.floor.code, right.ward.floor.code) ||
    naturally.compare(left.ward.code, right.ward.code) ||
    naturally.compare(left.room?.code ?? '', right.room?.code ?? '') ||
    naturally.compare(left.code, right.code);

  return [...beds].sort(compare);
}

export function bedLocationLabel(bed: LocatedBed): string {
  const floor = bed.ward.floor;
  return [floor.building?.name, floor.name, bed.ward.name, bed.room?.name]
    .filter(Boolean)
    .join(' · ');
}
