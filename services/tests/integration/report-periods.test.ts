import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { z } from 'zod';
import { createApp } from '../../src/app.js';
import { dayIn, addDays } from '../../src/common/time-zone.js';
import { createLogger } from '../../src/config/logger.js';
import { createPrismaClient } from '../../src/database/prisma.js';
import {
  createBedFixture,
  createHospitalFixture,
  createPatientRequest,
  requireTestDatabaseUrl,
  type HospitalFixture,
} from '../support/fixtures.js';

// Report periods are whole days in the hospital's own time zone. This
// hospital is in New York, and 8 March 2026 is its daylight-saving day.

const database = createPrismaClient(requireTestDatabaseUrl());
const application = createApp({
  logger: createLogger('silent'),
  database,
  qrResolveRateLimit: { windowMs: 60_000, max: 100_000 },
});
const timeZone = 'America/New_York';

let hospital: HospitalFixture;
let lateEvening: { id: string; publicId: string };
let justAfterMidnight: { id: string; publicId: string };

const get = (path: string) =>
  request(application).get(path).set('authorization', `Bearer ${hospital.adminToken}`);
const reportSchema = z
  .object({
    range: z.object({ from: z.string(), to: z.string() }),
    summary: z.object({ total: z.number() }).passthrough(),
  })
  .passthrough();
const message = (body: unknown) =>
  z.object({ error: z.object({ message: z.string() }) }).parse(body).error.message;
const total = async (query: string) => {
  const response = await get(`/admin/reports/requests?${query}`);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return reportSchema.parse(response.body);
};

// Moves a request to another submission time (its history is append-only and
// keeps the real times; periods are chosen by submission time).
async function submittedAt(id: string, iso: string) {
  const at = new Date(iso);
  const row = await database.serviceRequest.findUniqueOrThrow({ where: { id } });
  const shift = at.getTime() - row.submittedAt.getTime();
  await database.serviceRequest.update({
    where: { id },
    data: {
      submittedAt: at,
      acceptDueAt: new Date(row.acceptDueAt.getTime() + shift),
      completeDueAt: new Date(row.completeDueAt.getTime() + shift),
    },
  });
}

beforeAll(async () => {
  hospital = await createHospitalFixture(database, application, 'TZ');
  const changed = await request(application)
    .patch('/admin/hospital')
    .set('authorization', `Bearer ${hospital.adminToken}`)
    .send({ timezone: timeZone });
  expect(changed.status, JSON.stringify(changed.body)).toBe(200);
  const { bedId } = await createBedFixture(database, hospital);
  lateEvening = await createPatientRequest(
    database,
    application,
    hospital,
    bedId,
    'Drinking Water',
  );
  justAfterMidnight = await createPatientRequest(
    database,
    application,
    hospital,
    bedId,
    'Room Cleaning',
  );
  // 23:59 on 7 March and 00:01 on 8 March, New York time (UTC−5 that night).
  await submittedAt(lateEvening.id, '2026-03-08T04:59:00Z');
  await submittedAt(justAfterMidnight.id, '2026-03-08T05:01:00Z');
});

afterAll(async () => {
  await database.$disconnect();
});

describe('Report periods in the hospital’s time zone', () => {
  it('counts each request on the hospital’s own day, across midnight and daylight saving', async () => {
    const eighth = await total('from=2026-03-08&to=2026-03-08');
    expect(eighth.summary.total).toBe(1);
    // The day the clocks went forward has 23 hours.
    expect(eighth.range).toEqual({
      from: '2026-03-08T05:00:00.000Z',
      to: '2026-03-09T04:00:00.000Z',
    });
    expect((await total('from=2026-03-07&to=2026-03-07')).summary.total).toBe(1);
    expect((await total('from=2026-03-07&to=2026-03-08')).summary.total).toBe(2);

    const log = await get('/admin/reports/requests/log?from=2026-03-07&to=2026-03-07');
    expect(
      z
        .object({ requests: z.array(z.object({ publicId: z.string() }).passthrough()) })
        .parse(log.body)
        .requests.map((row) => row.publicId),
    ).toEqual([lateEvening.publicId]);
  });

  it('does not depend on the server’s own time zone, and still takes exact times', async () => {
    const before = process.env.TZ;
    process.env.TZ = 'Asia/Tokyo';
    try {
      expect((await total('from=2026-03-08&to=2026-03-08')).summary.total).toBe(1);
    } finally {
      process.env.TZ = before;
    }
    const exact = await total('from=2026-03-08T05:00:00.000Z&to=2026-03-08T05:02:00.000Z');
    expect(exact.summary.total).toBe(1);
  });

  it('defaults to the last 7 hospital days', async () => {
    const today = dayIn(new Date(), timeZone);
    const report = await total('');
    expect(dayIn(new Date(report.range.from), timeZone)).toBe(addDays(today, -6));
    expect(new Date(report.range.from).toISOString()).toBe(report.range.from);
  });

  it('explains wrong, empty, reversed, and over-long periods, and allows future ones', async () => {
    for (const query of [
      'from=',
      'from=2026-02-30',
      'to=yesterday',
      'from=12%2F03%2F2026',
      'from=2026-03-08T99:00:00Z',
    ]) {
      const response = await get(`/admin/reports/requests?${query}`);
      expect(response.status, query).toBe(400);
    }
    const reversed = await get('/admin/reports/requests?from=2026-03-09&to=2026-03-08');
    expect(reversed.status).toBe(400);
    expect(message(reversed.body)).toBe('The start must be before the end.');
    const tooLong = await get('/admin/reports/requests?from=2024-01-01&to=2026-03-08');
    expect(tooLong.status).toBe(400);
    expect(message(tooLong.body)).toBe('Choose a period of at most one year.');
    expect((await total('from=2099-01-01&to=2099-01-31')).summary.total).toBe(0);
  });

  it('filters the audit log by hospital days too', async () => {
    const today = dayIn(new Date(), timeZone);
    const entries = async (query: string) => {
      const response = await get(`/admin/audit-log?${query}`);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      return z.object({ entries: z.array(z.unknown()) }).parse(response.body).entries;
    };
    expect((await entries(`from=${today}&to=${today}`)).length).toBeGreaterThan(0);
    expect(await entries(`from=${addDays(today, 1)}&to=${addDays(today, 1)}`)).toEqual([]);
    const reversed = await get(`/admin/audit-log?from=${today}&to=${addDays(today, -1)}`);
    expect(reversed.status).toBe(400);
    expect((await get('/admin/audit-log?from=2026-02-30')).status).toBe(400);
  });
});
