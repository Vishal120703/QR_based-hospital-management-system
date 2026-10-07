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
}
