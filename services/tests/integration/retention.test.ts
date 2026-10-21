import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { createLogger } from '../../src/config/logger.js';
import { createPrismaClient } from '../../src/database/prisma.js';
import { RetentionService } from '../../src/modules/retention/index.js';
import {
  createBedFixture,
  createHospitalFixture,
  createPlatformToken,
  requireTestDatabaseUrl,
  type HospitalFixture,
} from '../support/fixtures.js';

const database = createPrismaClient(requireTestDatabaseUrl());
const application = createApp({ logger: createLogger('silent'), database });
let hospital: HospitalFixture;

beforeAll(async () => {
  hospital = await createHospitalFixture(database, application, 'RETENTION');
});

afterAll(async () => {
  await database.$disconnect();
});

describe('data retention', () => {
  it('removes only records older than each configured policy', async () => {
    const now = new Date('2026-10-21T12:00:00.000Z');
    const old = new Date('2025-09-01T12:00:00.000Z');
    const recent = new Date('2026-10-20T12:00:00.000Z');
    const membership = await database.hospitalMembership.findFirstOrThrow({
      where: { hospitalId: hospital.hospitalId },
    });
    const platform = await createPlatformToken(database, application);
    const platformUser = await database.user.findUniqueOrThrow({
      where: { email: platform.email },
    });
    const { bedId } = await createBedFixture(database, hospital, 'RETENTION-BED');
    const bedSession = await database.bedSession.create({
      data: { hospitalId: hospital.hospitalId, bedId },
    });

    const oldStaff = await database.staffSession.create({
      data: {
        hospitalId: hospital.hospitalId,
        membershipId: membership.id,
        tokenHash: randomUUID(),
        expiresAt: old,
      },
    });
    const recentStaff = await database.staffSession.create({
      data: {
        hospitalId: hospital.hospitalId,
        membershipId: membership.id,
        tokenHash: randomUUID(),
        expiresAt: new Date('2026-11-01T12:00:00.000Z'),
      },
    });
    const oldPlatform = await database.platformSession.create({
      data: { userId: platformUser.id, tokenHash: randomUUID(), expiresAt: old },
    });
    const oldGuest = await database.guestSession.create({
      data: {
        hospitalId: hospital.hospitalId,
        bedId,
        bedSessionId: bedSession.id,
        tokenHash: randomUUID(),
        expiresAt: old,
      },
    });
    const oldNotification = await database.staffNotification.create({
      data: {
        hospitalId: hospital.hospitalId,
        membershipId: membership.id,
        sourceKey: `retention:${randomUUID()}`,
        type: 'TEST',
        priority: 'NORMAL',
        title: 'Old notification',
        message: 'Old notification',
        entityId: randomUUID(),
        createdAt: old,
      },
    });
    const recentNotification = await database.staffNotification.create({
      data: {
        hospitalId: hospital.hospitalId,
        membershipId: membership.id,
        sourceKey: `retention:${randomUUID()}`,
        type: 'TEST',
        priority: 'NORMAL',
        title: 'Recent notification',
        message: 'Recent notification',
        entityId: randomUUID(),
        createdAt: recent,
      },
    });
    const dispatch = await database.notificationDispatch.create({
      data: {
        sourceKey: `retention:${randomUUID()}`,
        recipients: 1,
        outcome: 'CREATED',
        processedAt: old,
      },
    });
    const oldAudit = await database.auditLog.create({
      data: {
        hospitalId: hospital.hospitalId,
        actorType: 'SYSTEM',
        action: 'retention.test',
        targetType: 'Test',
        targetId: randomUUID(),
        metadata: {},
        createdAt: old,
      },
    });

    const removed = await new RetentionService(database, {
      sessionDays: 30,
      notificationDays: 180,
      auditDays: 365,
    }).run(now);

    expect(removed.staffSessions).toBeGreaterThanOrEqual(1);
    expect(removed.platformSessions).toBeGreaterThanOrEqual(1);
    expect(removed.guestSessions).toBeGreaterThanOrEqual(1);
    expect(removed.notifications).toBeGreaterThanOrEqual(1);
    expect(removed.dispatchReceipts).toBeGreaterThanOrEqual(1);
    expect(removed.auditLogs).toBeGreaterThanOrEqual(1);
    expect(await database.staffSession.findUnique({ where: { id: oldStaff.id } })).toBeNull();
    expect(
      await database.staffSession.findUnique({ where: { id: recentStaff.id } }),
    ).not.toBeNull();
    expect(await database.platformSession.findUnique({ where: { id: oldPlatform.id } })).toBeNull();
    expect(await database.guestSession.findUnique({ where: { id: oldGuest.id } })).toBeNull();
    expect(
      await database.staffNotification.findUnique({ where: { id: oldNotification.id } }),
    ).toBeNull();
    expect(
      await database.staffNotification.findUnique({ where: { id: recentNotification.id } }),
    ).not.toBeNull();
    expect(
      await database.notificationDispatch.findUnique({ where: { sourceKey: dispatch.sourceKey } }),
    ).toBeNull();
    expect(await database.auditLog.findUnique({ where: { id: oldAudit.id } })).toBeNull();
  });
});
