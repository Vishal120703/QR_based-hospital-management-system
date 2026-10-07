import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { z } from 'zod';
import { createApp } from '../../src/app.js';
import { createLogger } from '../../src/config/logger.js';
import { createPrismaClient } from '../../src/database/prisma.js';
import { cityCare, greenValley } from '../../src/modules/hospitals/test-seed-data.js';
import { seedTestHospitals } from '../../src/modules/hospitals/test-seed.js';
import { fixturePassword, requireTestDatabaseUrl } from '../support/fixtures.js';

// The manual-testing hospitals must load, sign everyone in with the right
// access, and hold a consistent request history. Their codes are fixed, so a
// second run of this file reuses the hospitals created by the first.

const database = createPrismaClient(requireTestDatabaseUrl());
const application = createApp({ logger: createLogger('silent'), database });
const tokens = new Map<string, string>();
let createdNow = false;

const meSchema = z.object({
  permissions: z.array(z.string()),
  scopedPermissions: z.array(z.string()),
});
const reportSchema = z
  .object({
    summary: z
      .object({
        total: z.number(),
        completed: z.number(),
        rejected: z.number(),
        cancelledByPatient: z.number(),
        overdueOpen: z.number(),
      })
      .passthrough(),
    byStaff: z.array(z.object({ name: z.string(), completed: z.number() }).passthrough()),
    notCompleted: z.array(z.object({ reason: z.string().nullable() }).passthrough()),
  })
  .passthrough();

async function signIn(code: string, email: string) {
  return request(application)
    .post('/auth/staff/login')
    .send({ hospitalCode: code, email, password: fixturePassword });
}
function as(key: string) {
  const bearer = `Bearer ${tokens.get(key) ?? ''}`;
  return {
    get: (path: string) => request(application).get(path).set('authorization', bearer),
    post: (path: string, body: object) =>
      request(application).post(path).set('authorization', bearer).send(body),
  };
}
const last14Days = () => {
  const to = new Date(Date.now() + 60_000);
  return `from=${new Date(to.getTime() - 14 * 86_400_000).toISOString()}&to=${to.toISOString()}`;
};

beforeAll(async () => {
  const result = await seedTestHospitals(database, {
    password: fixturePassword,
    platformPassword: fixturePassword,
  });
  createdNow = result.created.some((hospital) => hospital.code === cityCare.code);
  for (const spec of [cityCare, greenValley]) {
    for (const person of spec.people) {
      const response = await signIn(spec.code, `${person.email}@${spec.domain}`);
      if (response.status === 200) {
        tokens.set(person.key, z.object({ token: z.string() }).parse(response.body).token);
      }
    }
  }
}, 60_000);

afterAll(async () => {
  await database.$disconnect();
});

describe('Manual-testing hospitals', () => {
  it('never changes a hospital that already exists', async () => {
    const again = await seedTestHospitals(database, { password: fixturePassword });
    expect(again.created).toEqual([]);
    expect(again.skipped).toEqual([cityCare.code, greenValley.code]);
  });

  it('signs in every active account, and not the suspended one', () => {
    const expected = [...cityCare.people, ...greenValley.people]
      .filter((person) => !person.suspended)
      .map((person) => person.key);
    expect([...tokens.keys()].sort()).toEqual(expected.sort());
    expect(tokens.has('karan')).toBe(false);
  });

  it('gives each role its own access', async () => {
    const me = async (key: string) => meSchema.parse((await as(key).get('/auth/staff/me')).body);
    expect((await me('meera')).permissions).toContain('role.manage');
    const operations = await me('arjun');
    expect(operations.permissions).toEqual(expect.arrayContaining(['staff.manage', 'audit.read']));
    expect(operations.permissions).not.toContain('role.manage');
    const floor = await me('ravi');
    expect(floor.permissions).toEqual([]);
    expect(floor.scopedPermissions).toEqual(
      expect.arrayContaining(['request.assign', 'request.transfer', 'analytics.read']),
    );

    expect((await as('ravi').get('/admin/audit-log')).status).toBe(403);
    expect((await as('kavita').get('/admin/requests')).status).toBe(403);
    expect((await as('kavita').get('/admin/beds')).status).toBe(200);
    expect((await as('pavan').get('/admin/reports/requests')).status).toBe(403);
    expect((await as('arjun').get('/admin/audit-log')).status).toBe(200);

    // The Operations Manager may suspend a floor manager but not the Hospital Manager.
    const meera = await database.hospitalMembership.findFirstOrThrow({
      where: { user: { email: `meera.iyer@${cityCare.domain}` } },
    });
    expect(
      (await as('arjun').post(`/admin/staff/${meera.id}/status`, { status: 'SUSPENDED' })).status,
    ).toBe(403);
  });

  it('shows each person only the requests in their area', async () => {
    const list = async (key: string) =>
      z
        .object({
          serviceRequests: z.array(
            z.object({ hospitalId: z.string(), assigneeId: z.string().nullable() }).passthrough(),
          ),
        })
        .parse((await as(key).get('/admin/requests')).body).serviceRequests;
    const city = await database.hospital.findUniqueOrThrow({ where: { code: cityCare.code } });
    const everything = await list('meera');
    expect(everything.length).toBeGreaterThan(50);
    expect(everything.every((row) => row.hospitalId === city.id)).toBe(true);
    const floorOnly = await list('ravi');
    expect(floorOnly.length).toBeGreaterThan(0);
    expect(floorOnly.length).toBeLessThan(everything.length);
    const pavan = await database.hospitalMembership.findFirstOrThrow({
      where: { user: { email: `pavan.kumar@${cityCare.domain}` } },
    });
    const own = await list('pavan');
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((row) => row.assigneeId === pavan.id)).toBe(true);
    expect((await list('rohan')).every((row) => row.hospitalId !== city.id)).toBe(true);
  });

  it('fills Reports with work, reasons, and lateness', async () => {
    const response = await as('meera').get(`/admin/reports/requests?${last14Days()}`);
    expect(response.status).toBe(200);
    const report = reportSchema.parse(response.body);
    expect(report.summary.total).toBeGreaterThan(60);
    expect(report.summary.rejected).toBeGreaterThanOrEqual(4);
    expect(report.summary.cancelledByPatient).toBeGreaterThanOrEqual(2);
    expect(report.byStaff.find((row) => row.name === 'Pavan Kumar')?.completed).toBeGreaterThan(0);
    expect(report.notCompleted.some((row) => row.reason?.includes('nil by mouth'))).toBe(true);
  });

  it('keeps every request history complete and in order', async () => {
    const requests = await database.serviceRequest.findMany({
      where: { hospital: { code: { in: [cityCare.code, greenValley.code] } } },
      include: { events: { orderBy: { requestVersion: 'asc' } } },
    });
    for (const row of requests) {
      expect(row.events.map((event) => event.requestVersion)).toEqual(
        row.events.map((_, index) => index + 1),
      );
      expect(row.events).toHaveLength(row.version);
      expect(row.events.at(-1)?.resultingStatus).toBe(row.status);
      const times = row.events.map((event) => event.occurredAt.getTime());
      expect([...times].sort((left, right) => left - right)).toEqual(times);
    }
  });

  it('leaves today’s open work ready to act on', async () => {
    if (!createdNow) return; // A previous run may already have moved these on.
    const water = await database.serviceRequest.findFirstOrThrow({
      where: {
        hospital: { code: cityCare.code },
        serviceName: 'Drinking Water',
        status: 'ASSIGNED',
        bed: { code: 'ICU-03' },
      },
    });
    const accepted = await as('neha').post(`/admin/requests/${water.id}/accept`, {
      expectedVersion: water.version,
    });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
  });
});
