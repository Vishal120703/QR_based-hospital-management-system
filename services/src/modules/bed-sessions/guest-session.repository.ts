import { type Db } from '../../database/client.js';
import { hospitalAccessSelect } from '../hospitals/index.js';

// Guest sessions: the short-lived patient access created by scanning a QR.
export class GuestSessionRepository {
  public create(
    db: Db,
    data: {
      hospitalId: string;
      bedId: string;
      bedSessionId: string;
      tokenHash: string;
      expiresAt: Date;
    },
  ) {
    return db.guestSession.create({ data });
  }

  // With what is needed to decide whether it still works.
  public findByTokenHash(db: Db, tokenHash: string) {
    return db.guestSession.findUnique({
      where: { tokenHash },
      include: {
        bedSession: { select: { status: true } },
        hospital: { select: hospitalAccessSelect },
      },
    });
  }

  public async touch(db: Db, id: string, at: Date): Promise<void> {
    await db.guestSession.updateMany({ where: { id }, data: { lastActivityAt: at } });
  }

  // Where the patient is, as their page shows it.
  public findPlace(db: Db, hospitalId: string, bedId: string) {
    return Promise.all([
      db.hospital.findUniqueOrThrow({
        where: { id: hospitalId },
        select: { name: true, logo: { select: { publicId: true } } },
      }),
      db.bed.findUniqueOrThrow({
        where: { hospitalId_id: { hospitalId, id: bedId } },
        select: {
          code: true,
          displayName: true,
          room: { select: { name: true } },
          ward: { select: { name: true, floor: { select: { name: true } } } },
        },
      }),
    ]);
  }

  public async revokeForBed(db: Db, hospitalId: string, bedId: string): Promise<number> {
    return (
      await db.guestSession.updateMany({
        where: { hospitalId, bedId, revokedAt: null },
        data: { revokedAt: new Date() },
      })
    ).count;
  }

  public async revokeForBedSession(
    db: Db,
    hospitalId: string,
    bedSessionId: string,
  ): Promise<number> {
    return (
      await db.guestSession.updateMany({
        where: { hospitalId, bedSessionId, revokedAt: null },
        data: { revokedAt: new Date() },
      })
    ).count;
  }
}
