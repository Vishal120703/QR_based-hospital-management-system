import { type BedType, type RoomType } from '@prisma/client';

// Creates many beds in one ward at once, either as numbered beds or as
// numbered rooms that each hold the same number of beds.
export type BulkBedsInput =
  | {
      readonly mode: 'BEDS';
      readonly roomId?: string | undefined;
      readonly codePrefix: string;
      readonly namePrefix: string;
      readonly start: number;
      readonly count: number;
      readonly bedType: BedType;
    }
  | {
      readonly mode: 'ROOMS';
      readonly roomPrefix: string;
      readonly start: number;
      readonly count: number;
      readonly roomType: RoomType;
      readonly bedsPerRoom: number;
      readonly bedType: BedType;
    };

export const maxBulkBeds = 300;

// The rooms and beds a bulk request would create. Kept pure so the numbering
// rule is easy to test and identical to the preview shown in the browser.
export function planBulkBeds(input: BulkBedsInput): {
  rooms: { code: string; name: string }[];
  beds: { roomCode: string | null; code: string; displayName: string }[];
} {
  const last = input.start + input.count - 1;
  const width = Math.max(2, String(last).length);
  const numbers = Array.from({ length: input.count }, (_, index) => input.start + index);
  if (input.mode === 'BEDS') {
    return {
      rooms: [],
      beds: numbers.map((number) => {
        const label = String(number).padStart(width, '0');
        return {
          roomCode: null,
          code: `${input.codePrefix}${label}`.toUpperCase(),
          displayName: `${input.namePrefix} ${label}`.trim(),
        };
      }),
    };
  }
  // Floor prefix "2" with rooms 1–3 gives 201, 202, 203.
  const rooms = numbers.map((number) => {
    const code = `${input.roomPrefix}${String(number).padStart(width, '0')}`.toUpperCase();
    return { code, name: `Room ${code}` };
  });
  return {
    rooms,
    beds: rooms.flatMap((room) =>
      input.bedsPerRoom === 1
        ? [{ roomCode: room.code, code: room.code, displayName: `Room ${room.code}` }]
        : Array.from({ length: input.bedsPerRoom }, (_, index) => {
            const code = `${room.code}-${String.fromCharCode(65 + index)}`;
            return { roomCode: room.code, code, displayName: `Bed ${code}` };
          }),
    ),
  };
}
