import { type Db } from '../../database/client.js';

export class RetentionRepository {
  public deleteStaffSessions(db: Db, cutoff: Date) {
    return db.staffSession.deleteMany({
      where: {
        OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { not: null, lt: cutoff } }],
      },
    });
  }

  public deletePlatformSessions(db: Db, cutoff: Date) {
    return db.platformSession.deleteMany({
      where: {
        OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { not: null, lt: cutoff } }],
      },
    });
  }

  public deleteGuestSessions(db: Db, cutoff: Date) {
    return db.guestSession.deleteMany({
      where: {
        OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { not: null, lt: cutoff } }],
      },
    });
  }

  public deleteNotifications(db: Db, cutoff: Date) {
    return db.staffNotification.deleteMany({ where: { createdAt: { lt: cutoff } } });
  }

  public deleteDispatchReceipts(db: Db, cutoff: Date) {
    return db.notificationDispatch.deleteMany({ where: { processedAt: { lt: cutoff } } });
  }

  public deleteAuditLogs(db: Db, cutoff: Date) {
    return db.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
  }
}
