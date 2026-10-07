import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { z } from 'zod';
import { createApp } from '../../src/app.js';
import { createLogger } from '../../src/config/logger.js';
import { createPrismaClient } from '../../src/database/prisma.js';
import {
  createHospitalFixture,
  fixturePassword,
  loginStaff,
  requireTestDatabaseUrl,
  type HospitalFixture,
} from '../support/fixtures.js';

const database = createPrismaClient(requireTestDatabaseUrl());
const application = createApp({
  logger: createLogger('silent'),
  database,
  qrResolveRateLimit: { windowMs: 60_000, max: 100_000 },
});

const uuid = z.string().uuid();
let hospital: HospitalFixture;
let roleIds: Record<string, string>;
let departments: Record<string, string>;
let beds: { a: string; b: string; floorA: string };
const people: Record<string, { id: string; email: string; token: string }> = {};
const requests: Record<string, { id: string; publicId: string }> = {};

function as(token: string) {
  const bearer = `Bearer ${token}`;
  return {
    get: (path: string) => request(application).get(path).set('authorization', bearer),
    post: (path: string, body: object = {}) =>
      request(application).post(path).set('authorization', bearer).send(body),
    patch: (path: string, body: object) =>
      request(application).patch(path).set('authorization', bearer).send(body),
    delete: (path: string) => request(application).delete(path).set('authorization', bearer),
  };
}
const admin = () => as(hospital.adminToken);

async function staff(name: string, roleKey: string, department?: string, scopeId?: string) {
  const email = `${name.toLowerCase()}-${randomUUID().slice(0, 6)}@example.test`;
  const created = await admin().post('/admin/staff', {
    email,
    displayName: name,
    password: fixturePassword,
  });
  const id = z.object({ staff: z.object({ id: uuid }) }).parse(created.body).staff.id;
  expect(
    (
      await admin().post(`/admin/memberships/${id}/roles`, {
        roleId: roleIds[roleKey],
        ...(scopeId ? { scopeId } : {}),
      })
    ).status,
  ).toBe(201);
  if (department) {
    await admin().post(`/admin/staff/${id}/departments`, { departmentId: departments[department] });
    await admin().post(`/admin/staff/${id}/coverage`, { scopeType: 'HOSPITAL' });
    await admin().post(`/admin/staff/${id}/duty`, { dutyStatus: 'ON_DUTY' });
  }
  people[name] = { id, email, token: await loginStaff(application, hospital.code, email) };
  return people[name];
}

async function patientRequest(bedId: string, serviceName: string) {
  const qrRow = await database.bedQrCode.findFirst({ where: { bedId } });
  const qr = z
    .object({ token: z.string() })
    .parse(
      (await admin().post(qrRow ? `/admin/beds/${bedId}/qr/rotate` : `/admin/beds/${bedId}/qr`))
        .body,
    );
  if (!(await database.bedSession.findFirst({ where: { bedId, status: 'ACTIVE' } }))) {
    await admin().post('/admin/bed-sessions', { bedId });
  }
  const guest = z
    .object({ guestToken: z.string() })
    .parse(
      (await request(application).post('/public/qr/resolve').send({ token: qr.token })).body,
    ).guestToken;
  const service = await database.serviceItem.findFirstOrThrow({
    where: { hospitalId: hospital.hospitalId, name: serviceName },
  });
  const submitted = await as(guest).post('/public/requests', { serviceId: service.id });
  const publicId = z
    .object({ serviceRequest: z.object({ publicId: z.string() }) })
    .parse(submitted.body).serviceRequest.publicId;
  const stored = await database.serviceRequest.findUniqueOrThrow({ where: { publicId } });
  return { id: stored.id, publicId, guest };
}

async function command(token: string, id: string, action: string, body: object = {}) {
  const current = await database.serviceRequest.findUniqueOrThrow({ where: { id } });
  const response = await as(token).post(`/admin/requests/${id}/${action}`, {
    expectedVersion: current.version,
    ...body,
  });
  expect(response.status, `${action}: ${JSON.stringify(response.body)}`).toBe(200);
}

const reportSchema = z
  .object({
    summary: z.object({
      total: z.number(),
      open: z.number(),
      completed: z.number(),
      cancelled: z.number(),
      cancelledByPatient: z.number(),
      rejected: z.number(),
      overdueOpen: z.number(),
    }),
    byDepartment: z.array(z.object({ name: z.string(), total: z.number() }).passthrough()),
    byStaff: z.array(
      z
        .object({
          membershipId: z.string(),
          name: z.string(),
          assigned: z.number(),
          accepted: z.number(),
          completed: z.number(),
          rejected: z.number(),
          transferredAway: z.number(),
          assignmentsMade: z.number(),
          closed: z.number(),
          rejectReasons: z.array(z.string()),
        })
        .passthrough(),
    ),
    notCompleted: z.array(
      z
        .object({
          publicId: z.string(),
          outcome: z.string(),
          endedBy: z.string().nullable(),
          reason: z.string().nullable(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

beforeAll(async () => {
  hospital = await createHospitalFixture(database, application, 'AUDIT');
  const roles = await database.role.findMany({
    where: { hospitalId: hospital.hospitalId, systemKey: { not: null } },
  });
  roleIds = Object.fromEntries(roles.map((role) => [role.systemKey!, role.id]));
  const rows = await database.department.findMany({ where: { hospitalId: hospital.hospitalId } });
  departments = Object.fromEntries(rows.map((row) => [row.code, row.id]));
  const hospitalId = hospital.hospitalId;
  const floorA = await database.floor.create({ data: { hospitalId, code: 'FA', name: 'Floor A' } });
  const floorB = await database.floor.create({ data: { hospitalId, code: 'FB', name: 'Floor B' } });
  const wardA = await database.ward.create({
    data: { hospitalId, floorId: floorA.id, code: 'WA', name: 'Ward A' },
  });
  const wardB = await database.ward.create({
    data: { hospitalId, floorId: floorB.id, code: 'WB', name: 'Ward B' },
  });
  const bedA = await database.bed.create({
    data: { hospitalId, wardId: wardA.id, code: 'A1', displayName: 'Bed A1' },
  });
  const bedB = await database.bed.create({
    data: { hospitalId, wardId: wardB.id, code: 'B1', displayName: 'Bed B1' },
  });
  beds = { a: bedA.id, b: bedB.id, floorA: floorA.id };

  const pantry = await staff('Pavan', 'CARE_STAFF', 'PANTRY');
  const nurse = await staff('Nisha', 'CARE_STAFF', 'NURSING');
  const nurse2 = await staff('Neel', 'CARE_STAFF', 'NURSING');

  // 1. Completed and closed. 2. Turned down by pantry staff.
  requests.water = await patientRequest(beds.a, 'Drinking Water');
  await command(hospital.adminToken, requests.water.id, 'assign', { assigneeId: pantry.id });
  await command(pantry.token, requests.water.id, 'accept');
  await command(pantry.token, requests.water.id, 'start');
  await command(pantry.token, requests.water.id, 'complete');
  await command(hospital.adminToken, requests.water.id, 'close');
  // The first water request is closed, so the same bed may ask again.
  requests.rejected = await patientRequest(beds.a, 'Drinking Water');
  await command(hospital.adminToken, requests.rejected.id, 'assign', { assigneeId: pantry.id });
  await command(pantry.token, requests.rejected.id, 'reject', { reason: 'Out of stock' });

  // 3. Cancelled by the patient.
  const cancelled = await patientRequest(beds.b, 'Nurse Assistance');
  requests.cancelled = cancelled;
  await as(cancelled.guest).post(`/public/requests/${cancelled.publicId}/cancel`, {
    reason: 'Not needed any more',
  });

  // 4. Accepted by one nurse, handed to another who completes it.
  requests.transferred = await patientRequest(beds.b, 'Nurse Assistance');
  await command(hospital.adminToken, requests.transferred.id, 'assign', { assigneeId: nurse.id });
  await command(nurse.token, requests.transferred.id, 'accept');
  await command(hospital.adminToken, requests.transferred.id, 'transfer', {
    assigneeId: nurse2.id,
    reason: 'Shift change',
  });
  await command(nurse2.token, requests.transferred.id, 'accept');
  await command(nurse2.token, requests.transferred.id, 'start');
  await command(nurse2.token, requests.transferred.id, 'complete');

  // 5. Waiting and already past its acceptance target.
  requests.overdue = await patientRequest(beds.b, 'Drinking Water');
  const past = new Date(Date.now() - 60 * 60_000);
  await database.serviceRequest.update({
    where: { id: requests.overdue.id },
    data: { acceptDueAt: past, completeDueAt: past },
  });
});

afterAll(async () => {
  await database.$disconnect();
});

describe('Request reports and audit', () => {
  it('counts requests, outcomes, and what each person did', async () => {
    const response = await admin().get('/admin/reports/requests');
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const report = reportSchema.parse(response.body);
    expect(report.summary).toMatchObject({
      total: 5,
      completed: 2,
      rejected: 1,
      cancelled: 1,
      cancelledByPatient: 1,
      open: 1,
      overdueOpen: 1,
    });
    const person = (name: string) => report.byStaff.find((row) => row.name === name);
    expect(person('Pavan')).toMatchObject({
      assigned: 2,
      accepted: 1,
      completed: 1,
      rejected: 1,
      rejectReasons: ['Out of stock'],
    });
    expect(person('Nisha')).toMatchObject({
      assigned: 1,
      accepted: 1,
      transferredAway: 1,
      completed: 0,
    });
    expect(person('Neel')).toMatchObject({ assigned: 1, accepted: 1, completed: 1 });
    expect(person('AUDIT Admin')).toMatchObject({ assignmentsMade: 4, closed: 1 });
    expect(report.byDepartment.find((row) => row.name === 'Pantry')?.total).toBe(3);

    const why = Object.fromEntries(report.notCompleted.map((item) => [item.publicId, item]));
    expect(why[requests.rejected!.publicId]).toMatchObject({
      outcome: 'rejected',
      endedBy: 'Pavan',
      reason: 'Out of stock',
    });
    expect(why[requests.cancelled!.publicId]).toMatchObject({
      outcome: 'cancelled',
      endedBy: 'Patient',
      reason: 'Not needed any more',
    });
    expect(why[requests.overdue!.publicId]).toMatchObject({ outcome: 'overdue' });
  });

  it('lists and filters the request log and shows one request’s full history', async () => {
    const log = (query: string) =>
      admin()
        .get(`/admin/reports/requests/log${query}`)
        .then((response) =>
          z
            .object({ requests: z.array(z.object({ publicId: z.string() }).passthrough()) })
            .parse(response.body)
            .requests.map((row) => row.publicId),
        );
    expect(await log('?outcome=rejected')).toEqual([requests.rejected!.publicId]);
    expect((await log(`?membershipId=${people.Pavan!.id}`)).sort()).toEqual(
      [requests.water!.publicId, requests.rejected!.publicId].sort(),
    );
    expect(await log(`?search=${requests.overdue!.publicId}`)).toEqual([
      requests.overdue!.publicId,
    ]);

    const timeline = await admin().get(`/admin/reports/requests/${requests.transferred!.id}`);
    expect(timeline.status).toBe(200);
    const events = z
      .object({
        request: z.object({
          completedBy: z.string(),
          events: z.array(
            z
              .object({
                type: z.string(),
                actor: z.object({ name: z.string() }),
                reason: z.string().nullable(),
                assigneeName: z.string().nullable(),
                previousAssigneeName: z.string().nullable(),
              })
              .passthrough(),
          ),
        }),
      })
      .parse(timeline.body).request;
    expect(events.completedBy).toBe('Neel');
    expect(events.events.map((event) => `${event.type}:${event.actor.name}`)).toEqual([
      'SUBMITTED:Patient',
      'ASSIGNED:AUDIT Admin',
      'ACCEPTED:Nisha',
      'TRANSFERRED:AUDIT Admin',
      'ACCEPTED:Neel',
      'STARTED:Neel',
      'COMPLETED:Neel',
    ]);
    expect(events.events[3]).toMatchObject({
      reason: 'Shift change',
      previousAssigneeName: 'Nisha',
      assigneeName: 'Neel',
    });
  });

  it('limits reports to a manager’s own floor or department', async () => {
    const floorManager = await staff('Farah', 'FLOOR_MANAGER', undefined, beds.floorA);
    const floor = reportSchema.parse(
      (await as(floorManager.token).get('/admin/reports/requests')).body,
    );
    expect(floor.summary.total).toBe(2);
    expect(
      (await as(floorManager.token).get(`/admin/reports/requests/${requests.cancelled!.id}`))
        .status,
    ).toBe(404);

    const supervisor = await staff('Dev', 'DEPARTMENT_SUPERVISOR', undefined, departments.PANTRY);
    const pantry = reportSchema.parse(
      (await as(supervisor.token).get('/admin/reports/requests')).body,
    );
    expect(pantry.summary.total).toBe(3);

    // Care staff see neither reports nor the audit log.
    expect((await as(people.Pavan!.token).get('/admin/reports/requests')).status).toBe(403);
    expect((await as(people.Pavan!.token).get('/admin/audit-log')).status).toBe(403);
    expect((await as(floorManager.token).get('/admin/audit-log')).status).toBe(403);
  });

  it('reads the audit log with names, filters, and pages', async () => {
    const page = await admin().get('/admin/audit-log?category=request&limit=2');
    expect(page.status, JSON.stringify(page.body)).toBe(200);
    const first = z
      .object({
        entries: z.array(
          z
            .object({
              id: uuid,
              action: z.string(),
              actorName: z.string(),
              targetName: z.string().nullable(),
            })
            .passthrough(),
        ),
        nextBefore: uuid.nullable(),
      })
      .parse(page.body);
    expect(first.entries).toHaveLength(2);
    expect(first.entries.every((entry) => entry.action.startsWith('request.'))).toBe(true);
    expect(first.entries[0]?.actorName).toBe('AUDIT Admin');
    expect(first.entries[0]?.targetName).toMatch(/\(CR-/);
    const next = await admin().get(
      `/admin/audit-log?category=request&limit=2&before=${first.nextBefore}`,
    );
    const ids = z
      .object({ entries: z.array(z.object({ id: uuid })) })
      .parse(next.body)
      .entries.map((entry) => entry.id);
    expect(ids.some((id) => first.entries.some((entry) => entry.id === id))).toBe(false);

    const staffEntries = await admin().get('/admin/audit-log?category=staff');
    const names = z
      .object({ entries: z.array(z.object({ targetName: z.string().nullable() })) })
      .parse(staffEntries.body)
      .entries.map((entry) => entry.targetName);
    expect(names).toContain('Pavan');
    expect(
      (await admin().get('/admin/reports/requests?from=2026-12-01&to=2026-01-01')).status,
    ).toBe(400);
    expect(
      (await admin().get('/admin/reports/requests?from=2024-01-01&to=2026-01-01')).status,
    ).toBe(400);
  });
});

describe('Authorization fixes', () => {
  it('lets care staff open only their own requests, by list or by link', async () => {
    const pantry = as(people.Pavan!.token);
    expect((await pantry.get(`/admin/requests/${requests.water!.id}`)).status).toBe(200);
    expect((await pantry.get(`/admin/requests/${requests.transferred!.id}`)).status).toBe(404);
    expect((await pantry.get(`/admin/requests/${requests.transferred!.id}/events`)).status).toBe(
      404,
    );
    // After the hand-over the first nurse no longer holds the request.
    expect(
      (await as(people.Nisha!.token).get(`/admin/requests/${requests.transferred!.id}`)).status,
    ).toBe(404);
    expect(
      (await as(people.Neel!.token).get(`/admin/requests/${requests.transferred!.id}`)).status,
    ).toBe(200);
  });

  it('stops staff and role managers from acting above their own powers', async () => {
    const senior = await admin().post('/admin/roles', {
      name: `Senior ${randomUUID().slice(0, 4)}`,
      permissionKeys: ['hospital.manage', 'staff.read'],
    });
    const seniorRoleId = z.object({ role: z.object({ id: uuid }) }).parse(senior.body).role.id;
    const deputyRole = await admin().post('/admin/roles', {
      name: `Deputy ${randomUUID().slice(0, 4)}`,
      permissionKeys: ['role.read', 'role.manage', 'staff.read', 'staff.manage'],
    });
    const deputyRoleId = z.object({ role: z.object({ id: uuid }) }).parse(deputyRole.body).role.id;
    roleIds.SENIOR = seniorRoleId;
    roleIds.DEPUTY = deputyRoleId;
    const seniorPerson = await staff('Sam', 'SENIOR');
    const deputy = await staff('Dina', 'DEPUTY');

    const asDeputy = as(deputy.token);
    expect(
      (await asDeputy.patch(`/admin/roles/${seniorRoleId}`, { permissionKeys: ['staff.read'] }))
        .status,
    ).toBe(403);
    expect((await asDeputy.delete(`/admin/roles/${seniorRoleId}`)).status).toBe(403);
    expect(
      (await asDeputy.post(`/admin/staff/${seniorPerson.id}/status`, { status: 'SUSPENDED' }))
        .status,
    ).toBe(403);
    // The Hospital Manager can.
    expect(
      (await admin().post(`/admin/staff/${seniorPerson.id}/status`, { status: 'SUSPENDED' }))
        .status,
    ).toBe(200);
  });

  it('lets a floor manager hand over accepted work on their own floor only', async () => {
    const manager = await staff('Hari', 'FLOOR_MANAGER', undefined, beds.floorA);
    const accepted = async (bedId: string) => {
      const created = await patientRequest(bedId, 'Nurse Assistance');
      await command(hospital.adminToken, created.id, 'assign', { assigneeId: people.Nisha!.id });
      await command(people.Nisha!.token, created.id, 'accept');
      return created;
    };
    const onFloor = await accepted(beds.a);
    await command(manager.token, onFloor.id, 'transfer', {
      assigneeId: people.Neel!.id,
      reason: 'My shift has ended',
    });
    const moved = await database.serviceRequest.findUniqueOrThrow({ where: { id: onFloor.id } });
    expect(moved).toMatchObject({ status: 'ASSIGNED', assigneeId: people.Neel!.id });

    const elsewhere = await accepted(beds.b);
    const current = await database.serviceRequest.findUniqueOrThrow({
      where: { id: elsewhere.id },
    });
    const refused = await as(manager.token).post(`/admin/requests/${elsewhere.id}/transfer`, {
      expectedVersion: current.version,
      assigneeId: people.Neel!.id,
      reason: 'My shift has ended',
    });
    expect(refused.status).toBe(404);
  });

  it('slows down password guessing against one account', async () => {
    const limited = createApp({
      logger: createLogger('silent'),
      database,
      staffLoginRateLimits: {
        perAccount: { windowMs: 60_000, max: 2 },
        perAddress: { windowMs: 60_000, max: 100 },
      },
    });
    const attempt = (email: string) =>
      request(limited)
        .post('/auth/staff/login')
        .send({ hospitalCode: hospital.code, email, password: 'wrong-password-123' });
    expect((await attempt(people.Pavan!.email)).status).toBe(401);
    expect((await attempt(people.Pavan!.email)).status).toBe(401);
    expect((await attempt(people.Pavan!.email)).status).toBe(429);
    // Other accounts are unaffected.
    expect((await attempt(people.Nisha!.email)).status).toBe(401);
  });
});
