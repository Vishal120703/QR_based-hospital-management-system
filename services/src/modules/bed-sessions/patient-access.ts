import { type BedStatus } from '@prisma/client';

// Whether patients can use a bed's QR right now. With bed occupancy management
// on, only an admitted (occupied) bed can; with it off, any bed in service.
export function bedTakesPatients(
  bed: { readonly active: boolean; readonly status: BedStatus },
  occupancyManaged: boolean,
): boolean {
  return (
    bed.active && (bed.status === 'OCCUPIED' || (!occupancyManaged && bed.status === 'AVAILABLE'))
  );
}
