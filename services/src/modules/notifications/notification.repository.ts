import { Prisma } from '@prisma/client';
import { type Db } from '../../database/client.js';

export interface NotificationSource {
  sourceKey: string;
  id: string;
  kind: 'event' | 'escalation';
}
const retryAt = (attempts: number) =>
  new Date(Date.now() + Math.min(300_000, 2000 * 2 ** Math.min(attempts, 8)));

export class NotificationRepository {
  public lockSource(db: Db, sourceKey: string) {
    return db.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${sourceKey}, 0))`,
    );
  }
  public receipt(db: Db, sourceKey: string) {
    return db.notificationDispatch.findUnique({ where: { sourceKey } });
  }
  public finish(db: Db, data: Prisma.NotificationDispatchCreateInput) {
    return db.notificationDispatch.upsert({
      where: { sourceKey: data.sourceKey },
      create: data,
      update: {
        outcome: data.outcome,
        recipients: data.recipients,
        processedAt: new Date(),
        nextAttemptAt: null,
      },
    });
  }
  public async retrySource(db: Db, sourceKey: string) {
    const previous = await this.receipt(db, sourceKey);
    // Another worker may have succeeded while this worker was failing.
    if (previous && previous.outcome !== 'RETRY') return;
    const attempts = (previous?.attempts ?? 0) + 1;
    await db.notificationDispatch.upsert({
      where: { sourceKey },
      create: {
        sourceKey,
        outcome: 'RETRY',
        recipients: 0,
        attempts,
        nextAttemptAt: retryAt(attempts),
      },
      update: { outcome: 'RETRY', attempts, nextAttemptAt: retryAt(attempts) },
    });
  }
  public create(db: Db, data: Prisma.StaffNotificationCreateManyInput[]) {
    return db.staffNotification.createMany({ data, skipDuplicates: true });
  }
  public count(db: Db, where: Prisma.StaffNotificationWhereInput) {
    return db.staffNotification.count({ where });
  }
  public find(db: Db, where: Prisma.StaffNotificationWhereInput) {
    return db.staffNotification.findFirst({ where });
  }
  public list(db: Db, where: Prisma.StaffNotificationWhereInput, take: number) {
    return db.staffNotification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      select: {
        id: true,
        type: true,
        priority: true,
        title: true,
        message: true,
        entityId: true,
        createdAt: true,
        readAt: true,
      },
    });
  }
  public visibleRequests(db: Db, where: Prisma.ServiceRequestWhereInput, ids: string[]) {
    return db.serviceRequest.findMany({
      where: { AND: [where, { id: { in: ids } }] },
      select: { id: true, publicId: true },
    });
  }
  public read(db: Db, where: Prisma.StaffNotificationWhereInput) {
    return db.staffNotification.updateMany({
      where: { AND: [where, { readAt: null }] },
      data: { readAt: new Date() },
    });
  }
  public pendingDelivery(db: Db) {
    return db.staffNotification.findMany({
      where: { realtimeAttemptedAt: null, nextDeliveryAt: { lte: new Date() } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 200,
      select: { id: true, hospitalId: true, membershipId: true, deliveryAttempts: true },
    });
  }
  public attempted(db: Db, id: string) {
    return db.staffNotification.update({
      where: { id },
      data: { realtimeAttemptedAt: new Date() },
    });
  }
  public retryDelivery(db: Db, id: string, attempts: number) {
    return db.staffNotification.updateMany({
      where: { id, realtimeAttemptedAt: null },
      data: { deliveryAttempts: { increment: 1 }, nextDeliveryAt: retryAt(attempts + 1) },
    });
  }
  // Anti-join receipts instead of a timestamp watermark: no event is skipped
  // when a transaction commits late or the process dies after request commit.
  public pendingSources(db: Db, limit: number, notBefore: Date) {
    return db.$queryRaw<NotificationSource[]>(Prisma.sql`
      SELECT "sourceKey", "id", "kind" FROM (
        SELECT 'event:' || e."id" AS "sourceKey", e."id", 'event' AS "kind", e."occurredAt" AS "at"
        FROM "RequestEvent" e WHERE e."occurredAt" >= ${notBefore} AND NOT EXISTS (
          SELECT 1 FROM "NotificationDispatch" d WHERE d."sourceKey" = 'event:' || e."id"
            AND (d."outcome" <> 'RETRY' OR d."nextAttemptAt" > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')))
        UNION ALL
        SELECT 'escalation:' || e."id", e."id", 'escalation', e."createdAt"
        FROM "RequestEscalation" e WHERE e."createdAt" >= ${notBefore} AND NOT EXISTS (
          SELECT 1 FROM "NotificationDispatch" d WHERE d."sourceKey" = 'escalation:' || e."id"
            AND (d."outcome" <> 'RETRY' OR d."nextAttemptAt" > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')))
      ) pending ORDER BY "at", "sourceKey" LIMIT ${limit}
    `);
  }

  public event(db: Db, id: string) {
    return db.requestEvent.findUnique({ where: { id } });
  }
  public escalation(db: Db, id: string) {
    return db.requestEscalation.findUnique({ where: { id } });
  }
  public request(db: Db, hospitalId: string, id: string) {
    return db.serviceRequest.findUnique({
      where: { hospitalId_id: { hospitalId, id } },
      include: {
        bed: { select: { wardId: true, ward: { select: { floorId: true } } } },
        hospital: { select: { status: true, client: { select: { status: true } } } },
      },
    });
  }

  public candidates(db: Db, hospitalId: string) {
    return db.hospitalMembership.findMany({
      where: {
        hospitalId,
        status: 'ACTIVE',
        dutyStatus: 'ON_DUTY',
        user: { status: 'ACTIVE', mustChangePassword: false },
      },
      include: {
        userRoles: {
          where: { role: { active: true } },
          include: { role: { include: { rolePermissions: true } }, scopes: true },
        },
      },
    });
  }
}
