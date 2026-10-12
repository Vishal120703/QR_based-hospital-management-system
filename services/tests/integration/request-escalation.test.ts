import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { z } from 'zod';
import { createApp } from '../../src/app.js';
import { createLogger } from '../../src/config/logger.js';
import { createPrismaClient } from '../../src/database/prisma.js';
import { EscalationService } from '../../src/modules/requests/index.js';
import {
  createBedFixture,
  createHospitalFixture,
  createPatientRequest,
  fixturePassword,
  loginStaff,
  requireTestDatabaseUrl,
  type HospitalFixture,
} from '../support/fixtures.js';

// The SLA worker escalates overdue requests by the service's escalation
// policy, once per step, and each person's alert feed shows what needs them.

const database = createPrismaClient(requireTestDatabaseUrl());
const application = createApp({
  logger: createLogger('silent'),
  database,
  qrResolveRateLimit: { windowMs: 60_000, max: 100_000 },
});
const worker = new EscalationService(database);

let hospital: HospitalFixture;
let beds: { a: string; b: string };
let roles: Record<string, string>;
const people: Record<string, { id: string; token: string }> = {};

function as(token: string) {
  const bearer = `Bearer ${token}`;
  return {
    get: (path: string) => request(application).get(path).set('authorization', bearer),
    post: (path: string, body: object = {}) =>
      request(application).post(path).set('authorization', bearer).send(body),
    patch: (path: string, body: object) =>
      request(application).patch(path).set('authorization', bearer).send(body),
  };
}
const admin = () => as(hospital.adminToken);
const minutesFrom = (base: Date, count: number) => new Date(base.getTime() + count * 60_000);

async function staff(name: string, roleKey: string, scopeId?: string, department?: string) {
  const email = `${name.toLowerCase()}-${randomUUID().slice(0, 6)}@example.test`;
  const created = await admin().post('/admin/staff', {
    email,
    displayName: name,
    password: fixturePassword,
  });
  const id = z.object({ staff: z.object({ id: z.string() }) }).parse(created.body).staff.id;
  const role = await admin().post(`/admin/memberships/${id}/roles`, {
    roleId: roles[roleKey],
    ...(scopeId ? { scopeId } : {}),
  });
  expect(role.status, JSON.stringify(role.body)).toBe(201);
  if (department) {
    const departmentId = (
      await database.department.findFirstOrThrow({
        where: { hospitalId: hospital.hospitalId, code: department },
      })
    ).id;
    await admin().post(`/admin/staff/${id}/departments`, { departmentId });
    await admin().post(`/admin/staff/${id}/coverage`, { scopeType: 'HOSPITAL' });
    await admin().post(`/admin/staff/${id}/duty`, { dutyStatus: 'ON_DUTY' });
  }
  people[name] = { id, token: await loginStaff(application, hospital.code, email) };
  return people[name];
}

async function command(token: string, id: string, action: string, body: object = {}) {
  const current = await database.serviceRequest.findUniqueOrThrow({ where: { id } });
  const response = await as(token).post(`/admin/requests/${id}/${action}`, {
    expectedVersion: current.version,
    ...body,
  });
  expect(response.status, `${action}: ${JSON.stringify(response.body)}`).toBe(200);
}

// Moves a request's deadlines so the one that applies was missed `late` minutes ago.
async function missedBy(id: string, late: number, now = new Date()) {
  const row = await database.serviceRequest.findUniqueOrThrow({ where: { id } });
  const accept = ['SUBMITTED', 'ASSIGNED'].includes(row.status);
  await database.serviceRequest.update({
    where: { id },
    data: accept
      ? { acceptDueAt: minutesFrom(now, -late), completeDueAt: minutesFrom(now, 120) }
      : { completeDueAt: minutesFrom(now, -late) },
  });
}

const steps = (requestId: string) =>
  database.requestEscalation.findMany({
    where: { requestId },
    orderBy: [{ stage: 'asc' }, { level: 'asc' }],
    select: { stage: true, level: true, targetType: true },
  });
const flags = (id: string) =>
  database.serviceRequest.findUniqueOrThrow({
    where: { id },
    select: { isEscalated: true, escalationLevel: true },
  });
const alertsSchema = z.object({
  counts: z.object({ waiting: z.number(), overdue: z.number(), escalated: z.number() }),
  alerts: z.array(
    z.object({
      key: z.string(),
      kind: z.enum(['new', 'overdue', 'escalated']),
      requestId: z.string(),
      level: z.number().nullable(),
    }),
  ),
});
const alertsOf = async (token: string) => {
  const response = await as(token).get('/admin/requests/alerts');
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return alertsSchema.parse(response.body);
};

beforeAll(async () => {
  hospital = await createHospitalFixture(database, application, 'ESCALATE');
  const rows = await database.role.findMany({
    where: { hospitalId: hospital.hospitalId, systemKey: { not: null } },
  });
  roles = Object.fromEntries(rows.map((role) => [role.systemKey!, role.id]));
  const a = await createBedFixture(database, hospital, 'A1');
  const b = await createBedFixture(database, hospital, 'B1');
  beds = { a: a.bedId, b: b.bedId };
  const floorOf = async (wardId: string) =>
    (await database.ward.findUniqueOrThrow({ where: { id: wardId } })).floorId;
  await staff('FloorA', 'FLOOR_MANAGER', await floorOf(a.wardId));
  await staff('FloorB', 'FLOOR_MANAGER', await floorOf(b.wardId));
  await staff('Pavan', 'CARE_STAFF', undefined, 'PANTRY');

  // Level 1 at once to floor managers, level 2 after 30 minutes to whoever
  // is assigned.
  const policy = await admin().post('/admin/escalation-policies', {
    name: 'Water escalation',
    levels: [
      { targetType: 'ROLE', roleId: roles.FLOOR_MANAGER, afterMinutes: 0 },
      { targetType: 'ASSIGNEE', afterMinutes: 30 },
    ],
  });
  expect(policy.status, JSON.stringify(policy.body)).toBe(201);
  const policyId = z.object({ escalationPolicy: z.object({ id: z.string() }) }).parse(policy.body)
    .escalationPolicy.id;
  for (const name of ['Drinking Water']) {
    const service = await database.serviceItem.findFirstOrThrow({
      where: { hospitalId: hospital.hospitalId, name },
    });
    const linked = await admin().patch(`/admin/services/${service.id}`, {
      escalationPolicyId: policyId,
    });
    expect(linked.status, JSON.stringify(linked.body)).toBe(200);
  }
});

afterAll(async () => {
  await database.$disconnect();
});

describe('SLA escalation', () => {
  it('takes each step once, after its delay, however often the worker runs', async () => {
    const water = await createPatientRequest(
      database,
      application,
      hospital,
      beds.a,
      'Drinking Water',
    );
    expect(await steps(water.id)).toEqual([]);
    const now = new Date();
    await missedBy(water.id, 1, now);

    await worker.run(now);
    expect(await steps(water.id)).toEqual([{ stage: 'ACCEPT', level: 1, targetType: 'ROLE' }]);
    expect(await flags(water.id)).toEqual({ isEscalated: true, escalationLevel: 1 });

    // Overlapping runs, as from two API processes, add nothing.
    await Promise.all([worker.run(now), worker.run(now), worker.run(now)]);
    expect(await steps(water.id)).toHaveLength(1);

    await worker.run(minutesFrom(now, 31));
    expect(await steps(water.id)).toEqual([
      { stage: 'ACCEPT', level: 1, targetType: 'ROLE' },
      { stage: 'ACCEPT', level: 2, targetType: 'ASSIGNEE' },
    ]);
    expect(await flags(water.id)).toEqual({ isEscalated: true, escalationLevel: 2 });
    const audit = await database.auditLog.findMany({
      where: { hospitalId: hospital.hospitalId, action: 'request.escalate', targetId: water.id },
    });
    expect(audit).toHaveLength(2);
    expect(audit.every((entry) => entry.actorType === 'SYSTEM')).toBe(true);

    // Cancelled: nothing more happens to it.
    await command(hospital.adminToken, water.id, 'cancel', { reason: 'Duplicate request' });
    await worker.run(minutesFrom(now, 300));
    expect(await steps(water.id)).toHaveLength(2);
  });

  it('starts over for the completion deadline, and stops once the work is done', async () => {
    const cleaning = await createPatientRequest(
      database,
      application,
      hospital,
      beds.a,
      'Drinking Water',
    );
    const now = new Date();
    await missedBy(cleaning.id, 5, now);
    await worker.run(now);
    expect(await flags(cleaning.id)).toEqual({ isEscalated: true, escalationLevel: 1 });

    await command(hospital.adminToken, cleaning.id, 'assign', { assigneeId: people.Pavan!.id });
    await command(people.Pavan!.token, cleaning.id, 'accept');
    // A new deadline applies: the accept escalation is over.
    expect(await flags(cleaning.id)).toEqual({ isEscalated: false, escalationLevel: 0 });

    await missedBy(cleaning.id, 1, now);
    await worker.run(now);
    expect((await steps(cleaning.id)).map((step) => `${step.stage}:${step.level}`)).toEqual([
      'ACCEPT:1',
      'COMPLETE:1',
    ]);

    await command(people.Pavan!.token, cleaning.id, 'start');
    await command(people.Pavan!.token, cleaning.id, 'complete');
    await worker.run(minutesFrom(now, 300));
    expect(await steps(cleaning.id)).toHaveLength(2);
    expect(await flags(cleaning.id)).toEqual({ isEscalated: false, escalationLevel: 0 });
  });
});

describe('Alerts', () => {
  it('shows each person what needs them, only for requests they may see', async () => {
    const water = await createPatientRequest(
      database,
      application,
      hospital,
      beds.a,
      'Drinking Water',
    );
    const floorA = await alertsOf(people.FloorA!.token);
    expect(floorA.alerts.map((alert) => alert.key)).toContain(`new:${water.id}`);
    expect(
      (await alertsOf(people.FloorB!.token)).alerts.map((alert) => alert.requestId),
    ).not.toContain(water.id);
    expect((await alertsOf(hospital.adminToken)).alerts.map((alert) => alert.key)).toContain(
      `new:${water.id}`,
    );

    await command(hospital.adminToken, water.id, 'assign', { assigneeId: people.Pavan!.id });
    const now = new Date();
    await missedBy(water.id, 31, now);
    await worker.run(now);
    const stepIds = await database.requestEscalation.findMany({
      where: { requestId: water.id },
      orderBy: { level: 'asc' },
    });

    // Level 1 went to floor managers; only the one whose floor it is sees it.
    const managerA = await alertsOf(people.FloorA!.token);
    expect(managerA.alerts.map((alert) => alert.key)).toEqual(
      expect.arrayContaining([`escalated:${stepIds[0]!.id}`, `overdue:${water.id}:accept`]),
    );
    expect(managerA.alerts.map((alert) => alert.key)).not.toContain(`escalated:${stepIds[1]!.id}`);
    const managerB = await alertsOf(people.FloorB!.token);
    expect(managerB.alerts.some((alert) => alert.requestId === water.id)).toBe(false);
    expect(managerB.counts.escalated).toBe(0);

    // Level 2 went to the assignee, who also sees their own overdue work.
    const pavan = await alertsOf(people.Pavan!.token);
    expect(pavan.alerts.map((alert) => alert.key)).toEqual(
      expect.arrayContaining([`escalated:${stepIds[1]!.id}`, `overdue:${water.id}:accept`]),
    );
    expect(pavan.alerts.some((alert) => alert.kind === 'new')).toBe(false);

    // Once accepted, the accept-deadline alerts stop.
    await command(people.Pavan!.token, water.id, 'accept');
    const after = await alertsOf(people.Pavan!.token);
    expect(after.alerts.some((alert) => alert.requestId === water.id)).toBe(false);

    // Another hospital sees none of it.
    const other = await createHospitalFixture(database, application, 'ESCALATE-OTHER');
    const outsider = await alertsOf(other.adminToken);
    expect(outsider.alerts).toEqual([]);
    expect(outsider.counts).toEqual({ waiting: 0, overdue: 0, escalated: 0 });
  });
});
