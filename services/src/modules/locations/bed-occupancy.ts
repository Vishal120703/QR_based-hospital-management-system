import { type Prisma } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../common/errors/app-error.js';

// OCCUPIED is set and cleared only here, by the bed-sessions module inside its
// own transaction. The conditional update makes concurrent starts race-free:
// exactly one transaction can move a bed from AVAILABLE to OCCUPIED.
export async function occupyBed(
  transaction: Prisma.TransactionClient,
  hospitalId: string,
  bedId: string,
): Promise<void> {
  const updated = await transaction.bed.updateMany({
    where: { hospitalId, id: bedId, active: true, status: 'AVAILABLE' },
    data: { status: 'OCCUPIED' },
  });
  if (updated.count === 1) {
    return;
  }
  const bed = await transaction.bed.findUnique({
    where: { hospitalId_id: { hospitalId, id: bedId } },
  });
  if (!bed) {
    throw new NotFoundError('The referenced bed was not found.');
  }
  throw new ConflictError(
    bed.status === 'OCCUPIED'
      ? 'This bed already has an active session.'
      : 'Only an active bed with status AVAILABLE can start a session.',
  );
}

export async function releaseBed(
  transaction: Prisma.TransactionClient,
  hospitalId: string,
  bedId: string,
): Promise<void> {
  await transaction.bed.updateMany({
    where: { hospitalId, id: bedId, status: 'OCCUPIED' },
    data: { status: 'AVAILABLE' },
  });
}
