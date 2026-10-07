import { Prisma, type RequestStatus, type ServiceRequest } from '@prisma/client';
import { type Db } from '../../database/client.js';
import { hospitalAccessSelect } from '../hospitals/index.js';

const withBedAndAssignee = {
  bed: { select: { code: true, displayName: true } },
  assignee: { select: { user: { select: { displayName: true } } } },
} satisfies Prisma.ServiceRequestInclude;

// Service requests and their append-only event history.
export class RequestRepository {
  // Newest first, with the bed and the assignee's name for the work screens.
  public listWithBed(
    db: Db,
    where: Prisma.ServiceRequestWhereInput,
    statuses: readonly RequestStatus[],
    take: number,
  ) {
    return db.serviceRequest.findMany({
      where: { ...where, status: { in: [...statuses] } },
      include: withBedAndAssignee,
      orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
      take,
    });
  }

  public findFirst(db: Db, where: Prisma.ServiceRequestWhereInput) {
    return db.serviceRequest.findFirst({ where });
  }

  public findById(db: Db, hospitalId: string, id: string) {
    return db.serviceRequest.findUniqueOrThrow({ where: { hospitalId_id: { hospitalId, id } } });
  }

  public findByPublicId(db: Db, publicId: string) {
    return db.serviceRequest.findUnique({ where: { publicId } });
  }

  // With the bed's ward and floor, to check the caller's area.
  public findWithPlace(db: Db, hospitalId: string, id: string) {
    return db.serviceRequest.findUnique({
      where: { hospitalId_id: { hospitalId, id } },
      include: { bed: { select: { wardId: true, ward: { select: { floorId: true } } } } },
    });
  }

  // The requests of one bed stay, newest first, at most 100.
  public listForBedSession(db: Db, hospitalId: string, bedId: string, bedSessionId: string) {
    return db.serviceRequest.findMany({
      where: { hospitalId, bedId, bedSessionId },
      orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
  }

  public create(db: Db, data: Prisma.ServiceRequestUncheckedCreateInput): Promise<ServiceRequest> {
    return db.serviceRequest.create({ data });
  }

  // Changes a request only if it is still at the version and status the
  // caller read; returns how many changed (0 or 1).
  public async updateIfUnchanged(
    db: Db,
    hospitalId: string,
    id: string,
    expected: { version: number; status: RequestStatus },
    data: Prisma.ServiceRequestUncheckedUpdateManyInput,
  ): Promise<number> {
    return (
      await db.serviceRequest.updateMany({
        where: { hospitalId, id, version: expected.version, status: expected.status },
        data,
      })
    ).count;
  }

  public async addEvent(db: Db, data: Prisma.RequestEventUncheckedCreateInput): Promise<void> {
    await db.requestEvent.create({ data });
  }

  public listEvents(db: Db, hospitalId: string, requestId: string) {
    return db.requestEvent.findMany({
      where: { hospitalId, requestId },
      orderBy: { requestVersion: 'asc' },
    });
  }

  // Shared row locks that serialize a patient's request with the bed session
  // closing, QR rotation, and revocation. Each returns whether the row is
  // still active.
  public async lockActiveBedSession(
    db: Db,
    guest: { hospitalId: string; bedId: string; bedSessionId: string },
  ): Promise<boolean> {
    const rows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT "id" FROM "BedSession"
      WHERE "hospitalId" = ${guest.hospitalId}::uuid
        AND "bedId" = ${guest.bedId}::uuid
        AND "id" = ${guest.bedSessionId}::uuid
        AND "status" = 'ACTIVE'
      FOR SHARE
    `);
    return rows.length === 1;
  }

  public async lockActiveGuestSession(
    db: Db,
    guest: { guestSessionId: string; hospitalId: string; bedId: string; bedSessionId: string },
  ): Promise<boolean> {
    const rows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT "id" FROM "GuestSession"
      WHERE "id" = ${guest.guestSessionId}::uuid
        AND "hospitalId" = ${guest.hospitalId}::uuid
        AND "bedId" = ${guest.bedId}::uuid
        AND "bedSessionId" = ${guest.bedSessionId}::uuid
        AND "revokedAt" IS NULL
      FOR SHARE
    `);
    return rows.length === 1;
  }

  // The guest session with everything that decides whether it still works.
  public findGuestSession(db: Db, guestSessionId: string) {
    return db.guestSession.findUnique({
      where: { id: guestSessionId },
      include: {
        hospital: { select: hospitalAccessSelect },
        bedSession: { include: { bed: { select: { active: true, status: true } } } },
      },
    });
  }
}
