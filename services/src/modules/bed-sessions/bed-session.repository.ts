import { type BedSessionStatus, type Prisma } from '@prisma/client';
import { type Db } from '../../database/client.js';

const listLimit = 100;

// Bed sessions: one admission (patient stay) of a bed, with no patient identity.
export class BedSessionRepository {
  // Newest first, at most 100.
  public list(
    db: Db,
    hospitalId: string,
    filter: {
      bedId?: string | undefined;
      status?: BedSessionStatus | undefined;
      wardArea: Prisma.WardWhereInput;
    },
  ) {
    return db.bedSession.findMany({
      where: {
        hospitalId,
        ...(filter.bedId !== undefined ? { bedId: filter.bedId } : {}),
        ...(filter.status !== undefined ? { status: filter.status } : {}),
        bed: { ward: filter.wardArea },
      },
      orderBy: { startedAt: 'desc' },
      take: listLimit,
    });
  }

  public findById(db: Db, hospitalId: string, id: string) {
    return db.bedSession.findUnique({ where: { hospitalId_id: { hospitalId, id } } });
  }

  public findActiveForBed(db: Db, hospitalId: string, bedId: string) {
    return db.bedSession.findFirst({ where: { hospitalId, bedId, status: 'ACTIVE' } });
  }

  public create(
    db: Db,
    data: { hospitalId: string; bedId: string; startedByMembershipId: string },
  ) {
    return db.bedSession.create({ data });
  }

  // Closes an active session; returns how many changed (0 or 1).
  public async close(
    db: Db,
    hospitalId: string,
    id: string,
    closedByMembershipId: string,
  ): Promise<number> {
    return (
      await db.bedSession.updateMany({
        where: { hospitalId, id, status: 'ACTIVE' },
        data: { status: 'CLOSED', endedAt: new Date(), closedByMembershipId },
      })
    ).count;
  }

  public findBedInArea(db: Db, hospitalId: string, bedId: string, wardArea: Prisma.WardWhereInput) {
    return db.bed.findFirst({
      where: { hospitalId, id: bedId, ward: wardArea },
      select: { id: true },
    });
  }
}
