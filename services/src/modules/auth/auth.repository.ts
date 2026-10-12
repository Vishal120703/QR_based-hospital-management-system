import { type Db } from '../../database/client.js';

// Staff accounts, memberships, and sessions as the sign-in flow needs them.
export class AuthRepository {
  // Serialize credential changes with final sign-in checks. Hashing stays
  // outside transactions; only the final trusted account check holds a lock.
  public lockUser(db: Db, userId: string): Promise<{ id: string }[]> {
    return db.$queryRaw<
      { id: string }[]
    >`SELECT "id" FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;
  }
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

  public findPasswordHash(db: Db, userId: string) {
    return db.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  }

  public async replacePassword(
    db: Db,
    userId: string,
    data: { passwordHash: string; mustChangePassword: boolean },
  ): Promise<void> {
    await db.user.update({ where: { id: userId }, data });
  }

  public async replacePasswordIfUnchanged(
    db: Db,
    userId: string,
    previousHash: string,
    passwordHash: string,
  ): Promise<boolean> {
    const result = await db.user.updateMany({
      where: { id: userId, passwordHash: previousHash, status: 'ACTIVE' },
      data: { passwordHash, mustChangePassword: false },
    });
    return result.count === 1;
  }

  // Whether the account also signs in somewhere else: another hospital, or
  // the platform. Its password then is not one hospital's to reset.
  public async usedOutside(db: Db, userId: string, hospitalId: string): Promise<boolean> {
    const [memberships, operator] = await Promise.all([
      db.hospitalMembership.count({ where: { userId, hospitalId: { not: hospitalId } } }),
      db.platformAdmin.count({ where: { userId } }),
    ]);
    return memberships + operator > 0;
  }

  // Ends the member's other open sessions, keeping the one in use.
  public async revokeOtherSessions(db: Db, userId: string, keepSessionId: string): Promise<number> {
    const revoked = await db.staffSession.updateMany({
      where: { membership: { userId }, revokedAt: null, id: { not: keepSessionId } },
      data: { revokedAt: new Date() },
    });
    const platform = await db.platformSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return revoked.count + platform.count;
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
