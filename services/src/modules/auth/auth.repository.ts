import { type Db } from '../../database/client.js';

// Staff accounts, memberships, and sessions as the sign-in flow needs them.
export class AuthRepository {
  public findHospitalByCode(db: Db, code: string) {
    return db.hospital.findUnique({
      where: { code },
      include: { client: { select: { status: true } } },
    });
  }

  public findUserByEmail(db: Db, email: string) {
    return db.user.findUnique({ where: { email } });
  }

  public findMembership(db: Db, hospitalId: string, userId: string) {
    return db.hospitalMembership.findUnique({
      where: { hospitalId_userId: { hospitalId, userId } },
    });
  }

  public createSession(
    db: Db,
    data: { hospitalId: string; membershipId: string; tokenHash: string; expiresAt: Date },
  ) {
    return db.staffSession.create({ data });
  }

  // A session with everything needed to build the staff context: hospital,
  // client status, user, roles, permissions, and where each role applies.
  public findSessionByTokenHash(db: Db, tokenHash: string) {
    return db.staffSession.findUnique({
      where: { tokenHash },
      include: {
        hospital: {
          include: {
            logo: { select: { publicId: true } },
            client: { select: { status: true } },
          },
        },
        membership: {
          include: {
            user: true,
            userRoles: {
              include: {
                role: { include: { rolePermissions: true } },
                scopes: true,
              },
            },
          },
        },
      },
    });
  }

  public async revokeSession(db: Db, hospitalId: string, sessionId: string): Promise<void> {
    await db.staffSession.updateMany({
      where: { id: sessionId, hospitalId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  public async revokeMembershipSessions(
    db: Db,
    hospitalId: string,
    membershipId: string,
  ): Promise<number> {
    const revoked = await db.staffSession.updateMany({
      where: { hospitalId, membershipId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return revoked.count;
  }

  public async revokeHospitalSessions(db: Db, hospitalIds: readonly string[]): Promise<number> {
    const revoked = await db.staffSession.updateMany({
      where: { hospitalId: { in: [...hospitalIds] }, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return revoked.count;
  }
}
