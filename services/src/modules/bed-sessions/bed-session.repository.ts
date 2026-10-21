import { Prisma, type BedSessionStatus, type RequestStatus } from '@prisma/client';
import { type Db } from '../../database/client.js';

const listLimit = 100;
// Requests still being handled (the requests module's active statuses).
const openRequestStatuses: RequestStatus[] = ['SUBMITTED', 'ASSIGNED', 'ACCEPTED', 'IN_PROGRESS'];

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

  // startedByMembershipId is null for a stay opened by a QR scan.
  public create(
    db: Db,
    data: { hospitalId: string; bedId: string; startedByMembershipId: string | null },
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

  public async closeMany(
    db: Db,
    hospitalId: string,
    ids: readonly string[],
    closedByMembershipId: string | null,
  ): Promise<number> {
    return (
      await db.bedSession.updateMany({
        where: { hospitalId, id: { in: [...ids] }, status: 'ACTIVE' },
        data: { status: 'CLOSED', endedAt: new Date(), closedByMembershipId },
      })
    ).count;
  }

  public async listActiveIds(db: Db, hospitalId: string): Promise<string[]> {
    const sessions = await db.bedSession.findMany({
      where: { hospitalId, status: 'ACTIVE' },
      select: { id: true },
    });
    return sessions.map((session) => session.id);
  }

  // Whether someone is using a stay: a patient connected within the guest
  // session lifetime, or one of its requests is still being handled.
  public async inUse(db: Db, hospitalId: string, bedSessionId: string, now: Date) {
    const [guests, requests] = await Promise.all([
      db.guestSession.count({
        where: { hospitalId, bedSessionId, revokedAt: null, expiresAt: { gt: now } },
      }),
      db.serviceRequest.count({
        where: { hospitalId, bedSessionId, status: { in: openRequestStatuses } },
      }),
    ]);
    return guests + requests > 0;
  }

  public findBedInArea(db: Db, hospitalId: string, bedId: string, wardArea: Prisma.WardWhereInput) {
    return db.bed.findFirst({
      where: { hospitalId, id: bedId, ward: wardArea },
      select: { id: true },
    });
  }

  public findBedState(db: Db, hospitalId: string, bedId: string) {
    return db.bed.findUnique({
      where: { hospitalId_id: { hospitalId, id: bedId } },
      select: { active: true, status: true },
    });
  }

  // The hospital's bed occupancy setting, or null if there is no such
  // hospital. Admissions and QR scans read it under a shared lock, and a
  // change takes the row exclusively, so a change waits for those in progress
  // and they never act on a setting that is about to change.
  public async lockOccupancySetting(
    db: Db,
    hospitalId: string,
    lock: 'FOR SHARE' | 'FOR NO KEY UPDATE' = 'FOR SHARE',
  ): Promise<boolean | null> {
    const rows = await db.$queryRaw<{ bedOccupancyEnabled: boolean }[]>(Prisma.sql`
      SELECT "bedOccupancyEnabled" FROM "Hospital"
      WHERE "id" = ${hospitalId}::uuid
      ${Prisma.raw(lock)}
    `);
    return rows[0]?.bedOccupancyEnabled ?? null;
  }

  public async setOccupancySetting(db: Db, hospitalId: string, enabled: boolean): Promise<void> {
    await db.hospital.update({ where: { id: hospitalId }, data: { bedOccupancyEnabled: enabled } });
  }
}
