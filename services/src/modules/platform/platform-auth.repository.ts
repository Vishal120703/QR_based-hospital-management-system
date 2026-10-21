import { type Db } from '../../database/client.js';

// Super admin accounts and their sessions, separate from hospital staff sessions.
export class PlatformAuthRepository {
  public findUserWithAdmin(db: Db, email: string) {
    return db.user.findUnique({ where: { email }, include: { platformAdmin: true } });
  }

  public async createSession(
    db: Db,
    data: { userId: string; tokenHash: string; expiresAt: Date },
  ): Promise<void> {
    await db.platformSession.create({ data });
  }

  public findSessionByTokenHash(db: Db, tokenHash: string) {
    return db.platformSession.findUnique({
      where: { tokenHash },
      include: { admin: { include: { user: true } } },
    });
  }

  public async revokeSession(db: Db, id: string): Promise<void> {
    await db.platformSession.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  public findPasswordHash(db: Db, userId: string) {
    return db.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
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

  public async revokeOtherSessions(db: Db, userId: string, keepSessionId: string): Promise<number> {
    const [platform, staff] = await Promise.all([
      db.platformSession.updateMany({
        where: { userId, revokedAt: null, id: { not: keepSessionId } },
        data: { revokedAt: new Date() },
      }),
      db.staffSession.updateMany({
        where: { membership: { userId }, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    return platform.count + staff.count;
  }
}
