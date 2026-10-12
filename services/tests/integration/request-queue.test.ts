import { randomBytes } from 'node:crypto';
import { type Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { z } from 'zod';
import { createApp } from '../../src/app.js';
import { createLogger } from '../../src/config/logger.js';
import { createPrismaClient } from '../../src/database/prisma.js';
import {
  createBedFixture,
  createHospitalFixture,
  createPatientRequest,
  createStaffToken,
  requireTestDatabaseUrl,
  type HospitalFixture,
} from '../support/fixtures.js';

// The work queue pages through any number of requests: overdue work first,
// then the rest oldest first, with counts for every list.

const database = createPrismaClient(requireTestDatabaseUrl());
const application = createApp({
  logger: createLogger('silent'),
  database,
  qrResolveRateLimit: { windowMs: 60_000, max: 100_000 },
});

const pageSchema = z.object({
  serviceRequests: z.array(
    z.object({ id: z.string(), status: z.string(), submittedAt: z.string() }).passthrough(),
  ),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
  counts: z.object({
    open: z.number(),
    waiting: z.number(),
    overdue: z.number(),
    completed: z.number(),
    history: z.number(),
    completedToday: z.number(),
  }),
});

let hospital: HospitalFixture;
const ids = { overdue: [] as string[], onTime: [] as string[], history: [] as string[] };
let assigned: string;

const get = (token: string, query: string) =>
  request(application).get(`/admin/requests${query}`).set('authorization', `Bearer ${token}`);
const page = async (token: string, query: string) => {
  const response = await get(token, query);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return pageSchema.parse(response.body);
};
const minutes = (count: number) => new Date(Date.now() + count * 60_000);

beforeAll(async () => {
  hospital = await createHospitalFixture(database, application, 'QUEUE');
  const { bedId } = await createBedFixture(database, hospital);
  const template = await createPatientRequest(
    database,
    application,
    hospital,
    bedId,
    'Drinking Water',
  );
  ids.onTime.push(template.id);
  const row = await database.serviceRequest.findUniqueOrThrow({ where: { id: template.id } });
  const admin = await database.hospitalMembership.findFirstOrThrow({
    where: { hospitalId: hospital.hospitalId },
  });

  // Each copy belongs to its own earlier (closed) stay on the bed, because a
  // stay may hold only one active request per service.
  const copy = async (data: Partial<Prisma.ServiceRequestUncheckedCreateInput>) => {
    const stay = await database.bedSession.create({
      data: {
        hospitalId: hospital.hospitalId,
        bedId,
        status: 'CLOSED',
        startedByMembershipId: admin.id,
        endedAt: new Date(),
      },
    });
    const created = await database.serviceRequest.create({
      data: {
        hospitalId: row.hospitalId,
        bedId: row.bedId,
        serviceId: row.serviceId,
        serviceName: row.serviceName,
        categoryName: row.categoryName,
        departmentId: row.departmentId,
        priority: row.priority,
        slaPolicyId: row.slaPolicyId,
        slaPolicyVersionId: row.slaPolicyVersionId,
        slaPolicyVersion: row.slaPolicyVersion,
        acceptMinutes: row.acceptMinutes,
        completeMinutes: row.completeMinutes,
        acceptDueAt: row.acceptDueAt,
        completeDueAt: row.completeDueAt,
        publicId: `CR-${randomBytes(8).toString('hex').toUpperCase()}`,
        bedSessionId: stay.id,
        ...data,
      },
    });
    return created.id;
  };

  // 30 waiting requests, sent 60 to 31 minutes ago, still within target.
  for (let index = 0; index < 30; index += 1) {
    ids.onTime.push(
      await copy({
        submittedAt: minutes(-60 + index),
        acceptDueAt: minutes(60),
        completeDueAt: minutes(120),
      }),
    );
  }
  // Newer, but already overdue: they must still come first.
  for (let index = 0; index < 3; index += 1) {
    ids.overdue.push(
      await copy({
        submittedAt: minutes(-10 + index),
        acceptDueAt: minutes(-1),
        completeDueAt: minutes(30),
      }),
    );
  }
  assigned = await copy({
    status: 'ASSIGNED',
    assigneeId: admin.id,
    assignedAt: minutes(-4),
    submittedAt: minutes(-5),
    acceptDueAt: minutes(-2),
    completeDueAt: minutes(30),
  });
  ids.overdue.push(assigned);
  for (let index = 0; index < 2; index += 1) {
    await copy({
      status: 'COMPLETED',
      assigneeId: admin.id,
      completedAt: minutes(-20 + index),
      submittedAt: minutes(-90),
      acceptDueAt: minutes(-80),
      completeDueAt: minutes(-30),
    });
  }
  for (let index = 0; index < 30; index += 1) {
    ids.history.push(
      await copy({
        status: 'CANCELLED',
        cancelledAt: minutes(-200 + index),
        submittedAt: minutes(-300 + index),
        acceptDueAt: minutes(-290 + index),
        completeDueAt: minutes(-280 + index),
      }),
    );
  }
});

afterAll(async () => {
  await database.$disconnect();
});

describe('Request queue', () => {
  it('puts overdue work first, then the oldest, with counts for every list', async () => {
    const first = await page(hospital.adminToken, '?view=open&pageSize=10');
    expect(first.total).toBe(35);
    expect(first.counts).toEqual({
      open: 35,
      waiting: 34,
      overdue: 4,
      completed: 2,
      history: 30,
      completedToday: 2,
    });
    const shown = first.serviceRequests.map((row) => row.id);
    // The overdue ones (oldest first), then the oldest waiting ones.
    expect(shown.slice(0, 4)).toEqual(ids.overdue);
    expect(shown.slice(4)).toEqual(ids.onTime.slice(1, 7));
  });

  it('reaches every open request exactly once, however many pages', async () => {
    const seen: string[] = [];
    for (let number = 1; number <= 4; number += 1) {
      const result = await page(hospital.adminToken, `?page=${number}&pageSize=10`);
      expect(result.page).toBe(number);
      seen.push(...result.serviceRequests.map((row) => row.id));
    }
    expect(seen).toHaveLength(35);
    expect(new Set(seen)).toEqual(new Set([...ids.overdue, ...ids.onTime]));
    const beyond = await page(hospital.adminToken, '?page=5&pageSize=10');
    expect(beyond.serviceRequests).toEqual([]);
    expect(beyond.total).toBe(35);
  });

  it('filters by overdue or one status, and pages finished history newest first', async () => {
    expect((await page(hospital.adminToken, '?overdue=true')).total).toBe(4);
    expect((await page(hospital.adminToken, '?status=SUBMITTED')).total).toBe(34);
    const assignedOnly = await page(hospital.adminToken, '?status=ASSIGNED');
    expect(assignedOnly.serviceRequests.map((row) => row.id)).toEqual([assigned]);
    expect((await page(hospital.adminToken, '?view=completed')).total).toBe(2);

    const history = await page(hospital.adminToken, '?view=history');
    expect(history.total).toBe(30);
    expect(history.serviceRequests).toHaveLength(25);
    expect(history.serviceRequests[0]?.id).toBe(ids.history.at(-1));
    const rest = await page(hospital.adminToken, '?view=history&page=2');
    expect(rest.serviceRequests.map((row) => row.id)).toEqual(ids.history.slice(0, 5).reverse());
  });

  it('refuses page sizes, pages, and filters that make no sense', async () => {
    for (const query of [
      '?pageSize=0',
      '?pageSize=101',
      '?page=0',
      '?page=two',
      '?view=everything',
      '?view=open&status=CLOSED',
      '?view=history&overdue=true',
      '?overdue=maybe',
      '?sort=newest',
    ]) {
      expect((await get(hospital.adminToken, query)).status, query).toBe(400);
    }
  });

  it('shows other hospitals and other people’s work to no one', async () => {
    const other = await createHospitalFixture(database, application, 'QUEUE-OTHER');
    const outsider = await page(other.adminToken, '?pageSize=100');
    expect(outsider.total).toBe(0);
    expect(outsider.counts.open).toBe(0);
    const allIds = [...ids.overdue, ...ids.onTime];
    expect(outsider.serviceRequests.some((row) => allIds.includes(row.id))).toBe(false);

    // Care staff see only work assigned to them: none here.
    const careStaff = await createStaffToken(database, application, hospital, ['request.read']);
    const own = await page(careStaff, '?pageSize=100');
    expect(own.total).toBe(0);
    expect(own.counts).toMatchObject({ open: 0, overdue: 0, waiting: 0 });
    const noAccess = await createStaffToken(database, application, hospital, ['staff.read']);
    expect((await get(noAccess, '')).status).toBe(403);
  });
});
