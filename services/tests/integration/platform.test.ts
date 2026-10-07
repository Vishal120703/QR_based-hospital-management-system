import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { z } from 'zod';
import { createApp } from '../../src/app.js';
import { createLogger } from '../../src/config/logger.js';
import { createPrismaClient } from '../../src/database/prisma.js';
import {
  createBedFixture,
  createHospitalFixture,
  createPlatformToken,
  fixturePassword,
  loginStaff,
  requireTestDatabaseUrl,
  type HospitalFixture,
} from '../support/fixtures.js';

const database = createPrismaClient(requireTestDatabaseUrl());
const application = createApp({
  logger: createLogger('silent'),
  database,
  platformLoginRateLimit: { windowMs: 60_000, max: 1_000 },
});

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAAABJRU5ErkJggg==',
  'base64',
);
const hospitalSchema = z.object({
  hospital: z
    .object({
      id: z.string().uuid(),
      code: z.string(),
      status: z.string(),
      managers: z.array(z.object({ email: z.string(), displayName: z.string() })),
    })
    .passthrough(),
});

let operator: string;
let existing: HospitalFixture;

function as(token: string) {
  const bearer = `Bearer ${token}`;
  return {
    get: (path: string) => request(application).get(path).set('authorization', bearer),
    post: (path: string, body: object) =>
      request(application).post(path).set('authorization', bearer).send(body),
    patch: (path: string, body: object) =>
      request(application).patch(path).set('authorization', bearer).send(body),
  };
}

function newHospital(overrides: Record<string, string> = {}) {
  const suffix = randomUUID().slice(0, 6).toUpperCase();
  return {
    name: `Sunrise Hospital ${suffix}`,
    code: `SUN-${suffix}`,
    timezone: 'Asia/Kolkata',
    managerName: 'Asha Manager',
    managerEmail: `asha-${suffix.toLowerCase()}@example.test`,
    managerPassword: fixturePassword,
    ...overrides,
  };
}

beforeAll(async () => {
  operator = (await createPlatformToken(database, application)).token;
  existing = await createHospitalFixture(database, application, 'PLAT');
});

afterAll(async () => {
  await database.$disconnect();
});

describe('SaaS platform administration', () => {
  it('onboards a client hospital whose manager can sign in with the built-in roles', async () => {
    const input = newHospital();
    const created = await as(operator).post('/platform/hospitals', input);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const { hospital } = hospitalSchema.parse(created.body);
    expect(hospital).toMatchObject({ code: input.code, status: 'ACTIVE' });
    expect(hospital.managers).toEqual([
      expect.objectContaining({ email: input.managerEmail, displayName: 'Asha Manager' }),
    ]);

    const roles = await database.role.findMany({
      where: { hospitalId: hospital.id },
      select: { systemKey: true, scopeLevel: true },
    });
    expect(roles).toEqual(
      expect.arrayContaining([
        { systemKey: 'HOSPITAL_MANAGER', scopeLevel: 'HOSPITAL' },
        { systemKey: 'FLOOR_MANAGER', scopeLevel: 'FLOOR' },
        { systemKey: 'WARD_MANAGER', scopeLevel: 'WARD' },
        { systemKey: 'DEPARTMENT_SUPERVISOR', scopeLevel: 'DEPARTMENT' },
        { systemKey: 'CARE_STAFF', scopeLevel: 'HOSPITAL' },
      ]),
    );

    const managerToken = await loginStaff(application, input.code, input.managerEmail);
    const me = await as(managerToken).get('/auth/staff/me');
    expect(me.body).toMatchObject({ tenant: { code: input.code } });
    expect(z.object({ permissions: z.array(z.string()) }).parse(me.body).permissions).toContain(
      'role.manage',
    );

    const listed = await as(operator).get('/platform/hospitals');
    expect(listed.status).toBe(200);
    const codes = z
      .object({ hospitals: z.array(z.object({ code: z.string(), activeStaff: z.number() })) })
      .parse(listed.body)
      .hospitals.map((item) => item.code);
    expect(codes).toEqual(expect.arrayContaining([input.code, existing.code]));

    expect(
      await database.auditLog.count({
        where: {
          hospitalId: hospital.id,
          actorType: 'PLATFORM',
          action: 'platform.hospital.create',
        },
      }),
    ).toBe(1);

    // Codes and manager emails stay unique across the platform.
    expect(
      (await as(operator).post('/platform/hospitals', { ...newHospital(), code: input.code }))
        .status,
    ).toBe(409);
    expect(
      (await as(operator).post('/platform/hospitals', newHospital({ timezone: 'Mars/Base' })))
        .status,
    ).toBe(400);
  });

  it('suspends a hospital: staff are signed out and patients cannot open its QR codes', async () => {
    const { bedId } = await createBedFixture(database, existing);
    const qr = z
      .object({ token: z.string() })
      .parse((await as(existing.adminToken).post(`/admin/beds/${bedId}/qr`, {})).body);
    expect((await as(existing.adminToken).post('/admin/bed-sessions', { bedId })).status).toBe(201);

    const suspended = await as(operator).patch(`/platform/hospitals/${existing.hospitalId}`, {
      status: 'SUSPENDED',
    });
    expect(suspended.status, JSON.stringify(suspended.body)).toBe(200);
    expect((await as(existing.adminToken).get('/auth/staff/me')).status).toBe(401);
    expect(
      (await request(application).post('/public/qr/resolve').send({ token: qr.token })).status,
    ).toBe(404);
    const email = `admin-${existing.code}@example.test`.toLowerCase();
    await expect(loginStaff(application, existing.code, email)).rejects.toThrow();

    expect(
      (await as(operator).patch(`/platform/hospitals/${existing.hospitalId}`, { status: 'ACTIVE' }))
        .status,
    ).toBe(200);
    const again = await loginStaff(application, existing.code, email);
    expect((await as(again).get('/auth/staff/me')).status).toBe(200);
    expect(
      (await request(application).post('/public/qr/resolve').send({ token: qr.token })).status,
    ).toBe(201);
  });

  it('adds another manager and sets a logo for a client', async () => {
    const email = `second-${randomUUID().slice(0, 6)}@example.test`;
    const added = await as(operator).post(`/platform/hospitals/${existing.hospitalId}/managers`, {
      displayName: 'Second Manager',
      email,
      password: fixturePassword,
    });
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    expect(hospitalSchema.parse(added.body).hospital.managers.map((item) => item.email)).toContain(
      email,
    );
    await loginStaff(application, existing.code, email);
    expect(
      (
        await as(operator).post(`/platform/hospitals/${existing.hospitalId}/managers`, {
          displayName: 'Duplicate',
          email,
          password: fixturePassword,
        })
      ).status,
    ).toBe(409);

    const logo = await request(application)
      .put(`/platform/hospitals/${existing.hospitalId}/logo`)
      .set('authorization', `Bearer ${operator}`)
      .set('content-type', 'image/png')
      .send(png);
    expect(logo.status, JSON.stringify(logo.body)).toBe(200);
    const detail = await as(operator).get(`/platform/hospitals/${existing.hospitalId}`);
    const { logoUrl } = z.object({ logoUrl: z.string() }).parse(logo.body);
    expect(detail.body).toMatchObject({ hospital: { logoUrl } });
  });

  it('groups hospitals under clients and closes every hospital of a suspended client', async () => {
    const suffix = randomUUID().slice(0, 6).toUpperCase();
    const clientSchema = z.object({
      client: z
        .object({
          id: z.string().uuid(),
          name: z.string(),
          status: z.string(),
          hospitalCount: z.number(),
          contactEmail: z.string().nullable(),
          hospitals: z.array(z.object({ id: z.string(), code: z.string(), status: z.string() })),
        })
        .passthrough(),
    });

    // A new client arrives with its first hospital.
    const first = newHospital();
    const created = await as(operator).post('/platform/hospitals', {
      ...first,
      client: {
        name: `Apex Health Group ${suffix}`,
        code: `APEX-${suffix}`,
        contactName: 'Ravi Accounts',
        contactEmail: `Accounts-${suffix}@apex.example`,
        contactPhone: '+91 80 1234 5678',
      },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const clientId = z
      .object({ hospital: z.object({ client: z.object({ id: z.string().uuid() }) }) })
      .parse(created.body).hospital.client.id;

    // A second branch for the same client.
    const second = newHospital();
    expect((await as(operator).post('/platform/hospitals', { ...second, clientId })).status).toBe(
      201,
    );
    const detail = clientSchema.parse(
      (await as(operator).get(`/platform/clients/${clientId}`)).body,
    ).client;
    expect(detail).toMatchObject({
      name: `Apex Health Group ${suffix}`,
      hospitalCount: 2,
      contactEmail: `accounts-${suffix.toLowerCase()}@apex.example`,
    });
    expect(detail.hospitals.map((hospital) => hospital.code).sort()).toEqual(
      [first.code, second.code].sort(),
    );
    const listed = z
      .object({ clients: z.array(z.object({ id: z.string(), hospitalCount: z.number() })) })
      .parse((await as(operator).get('/platform/clients')).body).clients;
    expect(listed.find((client) => client.id === clientId)?.hospitalCount).toBe(2);

    // Suspending the client closes both hospitals; their own status is unchanged.
    const firstToken = await loginStaff(application, first.code, first.managerEmail);
    const secondFixture = {
      hospitalId: detail.hospitals.find((hospital) => hospital.code === second.code)!.id,
      code: second.code,
      adminToken: await loginStaff(application, second.code, second.managerEmail),
    };
    const { bedId } = await createBedFixture(database, secondFixture);
    const qr = z
      .object({ token: z.string() })
      .parse((await as(secondFixture.adminToken).post(`/admin/beds/${bedId}/qr`, {})).body);
    await as(secondFixture.adminToken).post('/admin/bed-sessions', { bedId });

    const suspended = await as(operator).patch(`/platform/clients/${clientId}`, {
      status: 'SUSPENDED',
    });
    expect(suspended.status, JSON.stringify(suspended.body)).toBe(200);
    expect(clientSchema.parse(suspended.body).client.hospitals.map((item) => item.status)).toEqual([
      'ACTIVE',
      'ACTIVE',
    ]);
    expect((await as(firstToken).get('/auth/staff/me')).status).toBe(401);
    expect((await as(secondFixture.adminToken).get('/auth/staff/me')).status).toBe(401);
    await expect(loginStaff(application, first.code, first.managerEmail)).rejects.toThrow();
    expect(
      (await request(application).post('/public/qr/resolve').send({ token: qr.token })).status,
    ).toBe(404);
    // Nothing new can be added to a suspended client.
    expect(
      (await as(operator).post('/platform/hospitals', { ...newHospital(), clientId })).status,
    ).toBe(409);
    expect(
      (await as(operator).patch(`/platform/hospitals/${existing.hospitalId}`, { clientId })).status,
    ).toBe(409);
    expect(
      await database.auditLog.count({
        where: { action: 'platform.client.update', hospital: { clientId } },
      }),
    ).toBe(2);

    expect(
      (await as(operator).patch(`/platform/clients/${clientId}`, { status: 'ACTIVE' })).status,
    ).toBe(200);
    expect(
      (
        await as(await loginStaff(application, first.code, first.managerEmail)).get(
          '/auth/staff/me',
        )
      ).status,
    ).toBe(200);
    expect(
      (await request(application).post('/public/qr/resolve').send({ token: qr.token })).status,
    ).toBe(201);

    // A hospital can move to another client, for example after an acquisition.
    const moved = await as(operator).patch(`/platform/hospitals/${secondFixture.hospitalId}`, {
      clientId: z
        .object({ hospital: z.object({ client: z.object({ id: z.string() }) }) })
        .parse((await as(operator).get(`/platform/hospitals/${existing.hospitalId}`)).body).hospital
        .client.id,
    });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(
      clientSchema.parse((await as(operator).get(`/platform/clients/${clientId}`)).body).client
        .hospitalCount,
    ).toBe(1);

    // Client codes are unique, and a hospital names one client only.
    expect(
      (
        await as(operator).post('/platform/hospitals', {
          ...newHospital(),
          client: { name: 'Copy', code: `APEX-${suffix}` },
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await as(operator).post('/platform/hospitals', {
          ...newHospital(),
          clientId,
          client: { name: 'Both', code: `BOTH-${suffix}` },
        })
      ).status,
    ).toBe(400);
    // Hospital staff never reach client data.
    expect((await as(firstToken).get('/platform/clients')).status).toBe(401);
  });

  it('keeps platform and hospital credentials apart', async () => {
    expect((await as(existing.adminToken).get('/platform/hospitals')).status).toBe(401);
    expect((await as(operator).get('/admin/hospital')).status).toBe(401);
    expect((await request(application).get('/platform/hospitals')).status).toBe(401);
    // A hospital manager's password does not open the platform.
    const email = `admin-${existing.code}@example.test`.toLowerCase();
    expect(
      (
        await request(application)
          .post('/auth/platform/login')
          .send({ email, password: fixturePassword })
      ).status,
    ).toBe(401);
    // Patient and staff routes do not ask for a platform token.
    expect((await request(application).get('/public/logos/not-a-uuid')).status).toBe(404);
    const logout = await request(application)
      .post('/auth/platform/logout')
      .set('authorization', `Bearer ${operator}`);
    expect(logout.status).toBe(204);
    expect((await as(operator).get('/platform/hospitals')).status).toBe(401);
    operator = (await createPlatformToken(database, application)).token;
  });
});
