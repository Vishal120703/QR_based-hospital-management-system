import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { io, type Socket } from 'socket.io-client';
import { z } from 'zod';
import { createApp } from '../../src/app.js';
import { createLogger } from '../../src/config/logger.js';
import { createPrismaClient } from '../../src/database/prisma.js';
import { StaffAuthService } from '../../src/modules/auth/index.js';
import {
  NotificationService,
  createNotificationRealtime,
  startNotificationWorker,
} from '../../src/modules/notifications/index.js';
import { EscalationService } from '../../src/modules/requests/index.js';
import { NotificationRepository } from '../../src/modules/notifications/notification.repository.js';
import {
  createBedFixture,
  createHospitalFixture,
  createPatientRequest,
  createStaffToken,
  createPlatformToken,
  requireTestDatabaseUrl,
  type HospitalFixture,
} from '../support/fixtures.js';

const db = createPrismaClient(requireTestDatabaseUrl());
const logger = createLogger('silent');
const app = createApp({
  database: db,
  logger,
  qrResolveRateLimit: { windowMs: 60_000, max: 100000 },
});
const service = new NotificationService(db, logger);
const auth = new StaffAuthService(db);
let hospital: HospitalFixture;
let foreign: HospitalFixture;
let bed: { bedId: string; wardId: string };
let server: Server;
let realtime: ReturnType<typeof createNotificationRealtime>;
let address: string;
const sockets: Socket[] = [];
const as = (token: string) => ({
  get: (path: string) => request(app).get(path).set('authorization', `Bearer ${token}`),
  post: (path: string, body = {}) =>
    request(app).post(path).set('authorization', `Bearer ${token}`).send(body),
});

beforeAll(async () => {
  await db.$connect();
  server = createServer(app);
  realtime = createNotificationRealtime(server, db, ['http://localhost:5173'], logger, 25);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const bound = server.address();
  if (!bound || typeof bound === 'string') throw new Error('Missing test port');
  address = `http://127.0.0.1:${bound.port}`;
});
afterAll(async () => {
  sockets.forEach((socket) => socket.disconnect());
  await realtime.stop();
  await db.$disconnect();
});
beforeEach(async () => {
  hospital = await createHospitalFixture(db, app, 'NOTIFY');
  foreign = await createHospitalFixture(db, app, 'OTHER');
  bed = await createBedFixture(db, hospital);
  const manager = await auth.authenticate(hospital.adminToken);
  await db.hospitalMembership.update({
    where: { id: manager.membershipId },
    data: { dutyStatus: 'ON_DUTY' },
  });
});
const submit = () => createPatientRequest(db, app, hospital, bed.bedId, 'Drinking Water');
async function processLatest(id: string) {
  const event = await db.requestEvent.findFirstOrThrow({
    where: { requestId: id },
    orderBy: { requestVersion: 'desc' },
  });
  await service.process({ id: event.id, sourceKey: `event:${event.id}`, kind: 'event' });
  return event;
}
async function worker(
  tokenPermissions = [
    'request.read',
    'request.accept',
    'request.start',
    'request.complete',
    'request.reject',
  ],
) {
  const token = await createStaffToken(db, app, hospital, tokenPermissions);
  const context = await auth.authenticate(token);
  const department = await db.department.findFirstOrThrow({
    where: { hospitalId: hospital.hospitalId, code: 'PANTRY' },
  });
  await db.hospitalMembership.update({
    where: { id: context.membershipId },
    data: { dutyStatus: 'ON_DUTY' },
  });
  await db.staffDepartment.create({
    data: {
      hospitalId: hospital.hospitalId,
      membershipId: context.membershipId,
      departmentId: department.id,
    },
  });
  await db.staffLocationScope.create({
    data: {
      hospitalId: hospital.hospitalId,
      membershipId: context.membershipId,
      scopeType: 'HOSPITAL',
    },
  });
  return { token, context };
}
async function command(id: string, action: string, token = hospital.adminToken, extra = {}) {
  const current = await db.serviceRequest.findUniqueOrThrow({ where: { id } });
  const response = await as(token).post(`/admin/requests/${id}/${action}`, {
    expectedVersion: current.version,
    ...extra,
  });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
}
async function connect(token: string, extra = {}) {
  const socket = io(address, {
    auth: { token, ...extra },
    transports: ['websocket'],
    reconnection: false,
  });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  return socket;
}

describe('Persistent role-aware notifications', () => {
  it('notifies only on-duty managers in the authorized area, not unassigned care staff or outsiders', async () => {
    const care = await worker();
    const otherPlace = await createBedFixture(db, hospital, 'OUTSIDE');
    const outside = await createStaffToken(db, app, hospital, ['request.read', 'request.assign']);
    const ctx = await auth.authenticate(outside);
    const role = await db.userRole.findFirstOrThrow({ where: { membershipId: ctx.membershipId } });
    const outsideWard = await db.ward.findUniqueOrThrow({ where: { id: otherPlace.wardId } });
    await db.scopeAssignment.updateMany({
      where: { userRoleId: role.id },
      data: { scopeType: 'FLOOR', scopeId: outsideWard.floorId },
    });
    await db.hospitalMembership.update({
      where: { id: ctx.membershipId },
      data: { dutyStatus: 'ON_DUTY' },
    });
    const pending = await submit();
    await processLatest(pending.id);
    expect(await service.unreadCount(await auth.authenticate(hospital.adminToken))).toBe(1);
    expect(await service.unreadCount(care.context)).toBe(0);
    expect(await service.unreadCount(ctx)).toBe(0);
    expect(await service.unreadCount(await auth.authenticate(foreign.adminToken))).toBe(0);
    const response = await as(hospital.adminToken).get('/admin/notifications');
    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).not.toContain('Drinking Water');
    expect(JSON.stringify(response.body)).not.toContain('Bed 101');
  });

  it('deduplicates competing workers and repeated event processing', async () => {
    const pending = await submit();
    const event = await db.requestEvent.findFirstOrThrow({ where: { requestId: pending.id } });
    const source = { kind: 'event' as const, id: event.id, sourceKey: `event:${event.id}` };
    await Promise.all([
      service.process(source),
      new NotificationService(db, logger).process(source),
    ]);
    await service.process(source);
    expect(await db.staffNotification.count({ where: { hospitalId: hospital.hospitalId } })).toBe(
      1,
    );
    expect(await db.notificationDispatch.count({ where: { sourceKey: source.sourceKey } })).toBe(1);
  });

  it('notifies the new assignee only and hides the former owner link after handover', async () => {
    const first = await worker();
    const second = await worker();
    const pending = await submit();
    await command(pending.id, 'assign', hospital.adminToken, {
      assigneeId: first.context.membershipId,
    });
    await processLatest(pending.id);
    expect(await service.unreadCount(first.context)).toBe(1);
    await command(pending.id, 'accept', first.token);
    await command(pending.id, 'transfer', hospital.adminToken, {
      assigneeId: second.context.membershipId,
      reason: 'Handover',
    });
    await processLatest(pending.id);
    expect(await service.unreadCount(second.context)).toBe(1);
    expect(await service.unreadCount(first.context)).toBe(1);
    const old = await service.list(first.context, { limit: 20 });
    expect(old.items[0]?.requestId).toBeNull();
    expect((await service.list(second.context, { limit: 20 })).items[0]?.requestId).toBe(
      pending.id,
    );
  });

  it('does not notify a stale assignee when ownership changed before processing', async () => {
    const first = await worker();
    const second = await worker();
    const pending = await submit();
    await command(pending.id, 'assign', hospital.adminToken, {
      assigneeId: first.context.membershipId,
    });
    const event = await db.requestEvent.findFirstOrThrow({
      where: { requestId: pending.id, type: 'ASSIGNED' },
    });
    await command(pending.id, 'accept', first.token);
    await command(pending.id, 'transfer', hospital.adminToken, {
      assigneeId: second.context.membershipId,
      reason: 'Handover',
    });
    await service.process({ kind: 'event', id: event.id, sourceKey: `event:${event.id}` });
    expect(await service.unreadCount(first.context)).toBe(0);
  });

  it('persists read status, validates pagination, and rejects foreign notification IDs and cursors', async () => {
    const pending = await submit();
    await processLatest(pending.id);
    const context = await auth.authenticate(hospital.adminToken);
    const item = (await service.list(context, { limit: 1 })).items[0]!;
    expect((await as(foreign.adminToken).post(`/admin/notifications/${item.id}/read`)).status).toBe(
      404,
    );
    expect(
      (await as(foreign.adminToken).get(`/admin/notifications?before=${item.id}`)).status,
    ).toBe(404);
    for (const query of [
      'limit=0',
      'limit=51',
      'unread=maybe',
      'hospitalId=foreign',
      'before=bad',
    ]) {
      expect((await as(hospital.adminToken).get(`/admin/notifications?${query}`)).status).toBe(400);
    }
    expect(
      z
        .object({ unreadCount: z.number() })
        .parse((await as(hospital.adminToken).post(`/admin/notifications/${item.id}/read`)).body)
        .unreadCount,
    ).toBe(0);
    const readAt = (await service.list(context, { limit: 20 })).items[0]!.readAt;
    await service.read(context, item.id);
    expect(
      (await new NotificationService(db, logger).list(context, { limit: 20 })).items[0]!.readAt,
    ).toEqual(readAt);
    expect(
      z
        .object({ items: z.array(z.unknown()) })
        .parse((await as(hospital.adminToken).get('/admin/notifications?unread=true')).body).items,
    ).toEqual([]);
    expect(
      z
        .object({ unreadCount: z.number() })
        .parse((await as(hospital.adminToken).get('/admin/notifications/unread-count')).body)
        .unreadCount,
    ).toBe(0);
  });

  it('returns empty inboxes and non-overlapping stable pages', async () => {
    const context = await auth.authenticate(hospital.adminToken);
    expect(await service.list(context, { limit: 1 })).toMatchObject({
      items: [],
      nextCursor: null,
      unreadCount: 0,
    });
    for (let i = 0; i < 3; i++) {
      const placed = await createBedFixture(db, hospital, String(i));
      const pending = await createPatientRequest(db, app, hospital, placed.bedId, 'Drinking Water');
      await processLatest(pending.id);
    }
    const a = await service.list(context, { limit: 2 });
    const b = await service.list(context, { limit: 2, before: a.nextCursor! });
    expect(a.items).toHaveLength(2);
    expect(b.items).toHaveLength(1);
    expect(new Set([...a.items, ...b.items].map((item) => item.id)).size).toBe(3);
    expect(b.nextCursor).toBeNull();
  });

  it('persists retry backoff across worker restart and prevents a poison source blocking later work', async () => {
    const pending = await submit();
    const event = await db.requestEvent.findFirstOrThrow({ where: { requestId: pending.id } });
    const source = { kind: 'event' as const, id: event.id, sourceKey: `event:${event.id}` };
    const sources = vi
      .spyOn(NotificationRepository.prototype, 'pendingSources')
      .mockResolvedValueOnce([source]);
    const fail = vi
      .spyOn(NotificationRepository.prototype, 'finish')
      .mockRejectedValueOnce(new Error('Temporary DB error'));
    await service.run();
    sources.mockRestore();
    fail.mockRestore();
    expect(
      await db.notificationDispatch.findUnique({ where: { sourceKey: source.sourceKey } }),
    ).toMatchObject({ outcome: 'RETRY', attempts: 1 });
    expect(
      (await new NotificationRepository().pendingSources(db, 10000, new Date(0))).some(
        (row) => row.sourceKey === source.sourceKey,
      ),
    ).toBe(false);
    await new NotificationService(db, logger).process(source); // still waiting on its backoff
    expect(await db.staffNotification.count({ where: { sourceKey: source.sourceKey } })).toBe(0);
    await db.notificationDispatch.update({
      where: { sourceKey: source.sourceKey },
      data: { nextAttemptAt: new Date(0) },
    });
    expect(
      (await new NotificationRepository().pendingSources(db, 10000, new Date(0))).some(
        (row) => row.sourceKey === source.sourceKey,
      ),
    ).toBe(true);
    await new NotificationService(db, logger).process(source);
    expect(await db.staffNotification.count({ where: { sourceKey: source.sourceKey } })).toBe(1);
  });

  it('records a no-recipient warning without breaking the patient request', async () => {
    await db.hospitalMembership.updateMany({
      where: { hospitalId: hospital.hospitalId },
      data: { dutyStatus: 'OFF_DUTY' },
    });
    const warn = vi.spyOn(logger, 'warn');
    const pending = await submit();
    const event = await processLatest(pending.id);
    expect(
      await db.notificationDispatch.findUnique({ where: { sourceKey: `event:${event.id}` } }),
    ).toMatchObject({ outcome: 'NO_RECIPIENT', recipients: 0 });
    expect(warn).toHaveBeenCalled();
    expect((await db.serviceRequest.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe(
      'SUBMITTED',
    );
  });

  it('sends completion to managers and cancellation to the current owner without treating read as acknowledgement', async () => {
    const care = await worker();
    const pending = await submit();
    await command(pending.id, 'assign', hospital.adminToken, {
      assigneeId: care.context.membershipId,
    });
    await processLatest(pending.id);
    const notice = (await service.list(care.context, { limit: 20 })).items[0]!;
    await service.read(care.context, notice.id);
    expect((await db.serviceRequest.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe(
      'ASSIGNED',
    );
    await command(pending.id, 'cancel', hospital.adminToken, { reason: 'No longer needed' });
    await processLatest(pending.id);
    expect(
      (await service.list(care.context, { limit: 20 })).items.map((item) => item.type),
    ).toContain('CANCELLED');
    const nextBed = await createBedFixture(db, hospital, 'COMPLETE');
    const next = await createPatientRequest(db, app, hospital, nextBed.bedId, 'Drinking Water');
    await command(next.id, 'assign', hospital.adminToken, {
      assigneeId: care.context.membershipId,
    });
    await command(next.id, 'accept', care.token);
    await command(next.id, 'start', care.token);
    await command(next.id, 'complete', care.token);
    await processLatest(next.id);
    expect(
      (await service.list(await auth.authenticate(hospital.adminToken), { limit: 20 })).items.map(
        (item) => item.type,
      ),
    ).toContain('COMPLETED');
  });

  it('excludes disabled accounts even when their duty flag is on', async () => {
    const other = await worker(['request.read', 'request.assign']);
    await db.user.update({ where: { id: other.context.user.id }, data: { status: 'INACTIVE' } });
    const pending = await submit();
    await processLatest(pending.id);
    expect(await service.unreadCount(other.context)).toBe(0);
  });

  it('authenticates the API and rejects anonymous, guest, and platform credentials', async () => {
    const pending = await submit();
    const platform = await createPlatformToken(db, app);
    expect((await request(app).get('/admin/notifications')).status).toBe(401);
    expect((await as(pending.guestToken).get('/admin/notifications')).status).toBe(401);
    expect((await as(platform.token).get('/admin/notifications')).status).toBe(401);
  });

  it('recovers pending sources after processing failure and retries delivery without deleting saved notifications', async () => {
    const pending = await submit();
    const event = await db.requestEvent.findFirstOrThrow({ where: { requestId: pending.id } });
    const source = { kind: 'event' as const, id: event.id, sourceKey: `event:${event.id}` };
    const failing = vi
      .spyOn(NotificationRepository.prototype, 'finish')
      .mockRejectedValueOnce(new Error('Transient write'));
    await expect(service.process(source)).rejects.toThrow('Transient write');
    expect(await db.staffNotification.count({ where: { sourceKey: source.sourceKey } })).toBe(0);
    // The rollback left no receipt, so the worker still sees this source as pending.
    expect(
      await db.notificationDispatch.findUnique({ where: { sourceKey: source.sourceKey } }),
    ).toBeNull();
    failing.mockRestore();
    // Retry this source itself: run() takes the oldest pending sources across the
    // shared test database, which need not include it.
    await service.process(source);
    expect(await db.staffNotification.count({ where: { sourceKey: source.sourceKey } })).toBe(1);
    const deliver = vi.fn().mockRejectedValue(new Error('Socket unavailable'));
    const workerRun = startNotificationWorker(db, logger, deliver, 60000);
    await workerRun.stop();
    expect(deliver).toHaveBeenCalled();
    expect(await db.staffNotification.count({ where: { sourceKey: source.sourceKey } })).toBe(1);
    await db.staffNotification.updateMany({
      where: { realtimeAttemptedAt: null },
      data: { nextDeliveryAt: new Date(0) },
    });
    const retry = vi.fn().mockResolvedValue(undefined);
    const restarted = startNotificationWorker(db, logger, retry, 60000);
    await restarted.stop();
    expect(retry).toHaveBeenCalled();
  });

  it('delivers only to the authenticated recipient, ignores arbitrary room joins, and recovers offline messages', async () => {
    const owner = await connect(hospital.adminToken);
    const outsider = await connect(foreign.adminToken, {
      hospitalId: hospital.hospitalId,
      role: 'admin',
    });
    const received = vi.fn();
    const leaked = vi.fn();
    owner.on('notification.created', received);
    outsider.on('notification.created', leaked);
    outsider.emit(
      'join',
      `inbox:${hospital.hospitalId}:${(await auth.authenticate(hospital.adminToken)).membershipId}`,
    );
    const pending = await submit();
    await processLatest(pending.id);
    const notice = await db.staffNotification.findFirstOrThrow({ where: { entityId: pending.id } });
    await realtime.deliver(notice);
    await vi.waitFor(() => expect(received).toHaveBeenCalledWith({ id: notice.id }));
    expect(leaked).not.toHaveBeenCalled();
    owner.disconnect();
    const nextBed = await createBedFixture(db, hospital, 'OFFLINE');
    const offline = await createPatientRequest(db, app, hospital, nextBed.bedId, 'Drinking Water');
    await processLatest(offline.id);
    await connect(hospital.adminToken);
    expect(
      z
        .object({ items: z.array(z.unknown()) })
        .parse((await as(hospital.adminToken).get('/admin/notifications')).body).items,
    ).toHaveLength(2);
  });

  it('rejects invalid socket credentials and disconnects revoked sessions before emitting', async () => {
    await expect(connect('invalid')).rejects.toThrow('Unauthorized');
    const owner = await connect(hospital.adminToken);
    const received = vi.fn();
    owner.on('notification.created', received);
    const context = await auth.authenticate(hospital.adminToken);
    await auth.logout(context);
    await realtime.deliver({
      id: randomUUID(),
      hospitalId: hospital.hospitalId,
      membershipId: context.membershipId,
    });
    await vi.waitFor(() => expect(owner.connected).toBe(false));
    expect(received).not.toHaveBeenCalled();
  });

  it('uses configured escalation thresholds, processes all batches, and prevents repeated escalation notices', async () => {
    const manager = await auth.authenticate(hospital.adminToken);
    const role = await db.role.findFirstOrThrow({
      where: { hospitalId: hospital.hospitalId, systemKey: 'HOSPITAL_MANAGER' },
    });
    const policy = await db.escalationPolicy.create({
      data: { hospitalId: hospital.hospitalId, name: 'Notify policy' },
    });
    await db.escalationLevel.create({
      data: {
        hospitalId: hospital.hospitalId,
        escalationPolicyId: policy.id,
        level: 1,
        afterMinutes: 2,
        targetType: 'ROLE',
        roleId: role.id,
      },
    });
    const pending = await submit();
    const now = new Date();
    await db.serviceRequest.update({
      where: { id: pending.id },
      data: { escalationPolicyId: policy.id, acceptDueAt: new Date(now.getTime() - 60000) },
    });
    const escalator = new EscalationService(db);
    await escalator.run(now, 1);
    expect(await db.requestEscalation.count({ where: { requestId: pending.id } })).toBe(0);
    await escalator.run(new Date(now.getTime() + 60000), 1);
    const steps = await db.requestEscalation.findMany({ where: { requestId: pending.id } });
    expect(steps).toHaveLength(1);
    const step = steps[0]!;
    await service.process({ kind: 'escalation', id: step.id, sourceKey: `escalation:${step.id}` });
    await escalator.run(new Date(now.getTime() + 120000), 1);
    await service.process({ kind: 'escalation', id: step.id, sourceKey: `escalation:${step.id}` });
    expect(
      (await service.list(manager, { limit: 20 })).items.filter(
        (item) => item.type === 'ESCALATED',
      ),
    ).toHaveLength(1);
    await command(pending.id, 'cancel', hospital.adminToken, { reason: 'No longer needed' });
    await escalator.run(new Date(now.getTime() + 300000), 1);
    expect(await db.requestEscalation.count({ where: { requestId: pending.id } })).toBe(1);
  });
});
