import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { z } from 'zod';
import { createApp } from '../../src/app.js';
import { createLogger } from '../../src/config/logger.js';
import { createPrismaClient } from '../../src/database/prisma.js';
import { dueDates, snapshotService } from '../../src/modules/catalog/service-snapshot.js';
import {
  createBedFixture,
  createHospitalFixture,
  createStaffToken,
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
const idSchema = z.object({ id: uuid }).passthrough();
const slaSchema = z.object({
  slaPolicy: z
    .object({
      id: uuid,
      name: z.string(),
      currentVersion: z.number(),
      acceptMinutes: z.number(),
      completeMinutes: z.number(),
      versions: z.array(
        z.object({ version: z.number(), acceptMinutes: z.number(), completeMinutes: z.number() }),
      ),
    })
    .passthrough(),
});
const catalogSchema = z.object({
  categories: z.array(
    z
      .object({
        id: uuid,
        name: z.string(),
        emergencyNotice: z.boolean(),
        services: z.array(
          z.object({ id: uuid, name: z.string(), description: z.string().nullable() }).strict(),
        ),
      })
      .passthrough(),
  ),
});

let hospitalA: HospitalFixture;
let hospitalB: HospitalFixture;

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

function created(response: { status: number; body: unknown }, key: string): string {
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return z.record(z.string(), idSchema).parse(response.body)[key]?.id ?? '';
}

async function lookup(hospital: HospitalFixture) {
  const { hospitalId } = hospital;
  const [departments, categories, services, policies] = await Promise.all([
    database.department.findMany({ where: { hospitalId } }),
    database.serviceCategory.findMany({ where: { hospitalId } }),
    database.serviceItem.findMany({ where: { hospitalId } }),
    database.slaPolicy.findMany({ where: { hospitalId } }),
  ]);
  const by =
    <T extends { id: string }>(rows: T[], key: (row: T) => string) =>
    (name: string) => {
      const row = rows.find((item) => key(item) === name);
      if (!row) throw new Error(`Missing fixture "${name}".`);
      return row.id;
    };
  return {
    department: by(departments, (row) => row.code),
    category: by(categories, (row) => row.name),
    service: by(services, (row) => row.name),
    sla: by(policies, (row) => row.name),
  };
}

// A guest session for a fresh occupied bed in this hospital.
async function guestToken(hospital: HospitalFixture): Promise<string> {
  const admin = as(hospital.adminToken);
  const { bedId } = await createBedFixture(database, hospital);
  const qr = z
    .object({ token: z.string() })
    .parse((await admin.post(`/admin/beds/${bedId}/qr`)).body);
  expect((await admin.post('/admin/bed-sessions', { bedId })).status).toBe(201);
  const resolved = await request(application).post('/public/qr/resolve').send({ token: qr.token });
  return z.object({ guestToken: z.string() }).parse(resolved.body).guestToken;
}

async function patientCatalog(token: string) {
  const response = await request(application)
    .get('/public/services')
    .set('authorization', `Bearer ${token}`);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return catalogSchema.parse(response.body).categories;
}

const serviceNames = (categories: Awaited<ReturnType<typeof patientCatalog>>) =>
  categories.flatMap((category) => category.services.map((service) => service.name)).sort();

beforeAll(async () => {
  hospitalA = await createHospitalFixture(database, application, 'CAT-A');
  hospitalB = await createHospitalFixture(database, application, 'CAT-B');
});

afterAll(async () => {
  await database.$disconnect();
});

describe('Phase 6 service catalog', () => {
  it('seeds an editable example catalog for every new hospital', async () => {
    const services = z
      .object({
        services: z.array(z.object({ name: z.string(), priority: z.string() }).passthrough()),
      })
      .parse((await as(hospitalA.adminToken).get('/admin/services')).body).services;
    expect(services.map((item) => [item.name, item.priority]).sort()).toEqual([
      ['Drinking Water', 'NORMAL'],
      ['Nurse Assistance', 'HIGH'],
      ['Room Cleaning', 'NORMAL'],
      ['Wheelchair', 'NORMAL'],
    ]);
    const policies = z
      .object({ slaPolicies: z.array(slaSchema.shape.slaPolicy) })
      .parse((await as(hospitalA.adminToken).get('/admin/sla-policies')).body).slaPolicies;
    expect(
      policies.map((policy) => [policy.name, policy.acceptMinutes, policy.completeMinutes]),
    ).toEqual([
      ['Quick response', 3, 10],
      ['Standard', 10, 60],
    ]);
  });

  it('shows patients only active services in active categories and departments', async () => {
    const hospital = await createHospitalFixture(database, application, 'CAT-P');
    const admin = as(hospital.adminToken);
    const ids = await lookup(hospital);
    const guest = await guestToken(hospital);

    const catalog = await patientCatalog(guest);
    expect(serviceNames(catalog)).toEqual([
      'Drinking Water',
      'Nurse Assistance',
      'Room Cleaning',
      'Wheelchair',
    ]);
    expect(catalog.find((category) => category.name === 'Nursing Help')?.emergencyNotice).toBe(
      true,
    );
    expect(JSON.stringify(catalog)).not.toMatch(/departmentId|slaPolicyId|priority/);

    await admin.patch(`/admin/services/${ids.service('Drinking Water')}`, { active: false });
    await admin.patch(`/admin/service-categories/${ids.category('Room & Cleaning')}`, {
      active: false,
    });
    await admin.patch(`/admin/departments/${ids.department('TRANSPORT')}`, { active: false });
    const visible = await patientCatalog(guest);
    expect(serviceNames(visible)).toEqual(['Nurse Assistance']);
    expect(visible.map((category) => category.name)).toEqual(['Nursing Help']);

    // Requests use the same rule: a hidden service cannot be snapshotted.
    const requestable = async (name: string) =>
      (await snapshotService(database, hospital.hospitalId, ids.service(name), new Date())) !==
      null;
    expect(await requestable('Drinking Water')).toBe(false);
    expect(await requestable('Room Cleaning')).toBe(false);
    expect(await requestable('Wheelchair')).toBe(false);
    expect(await requestable('Nurse Assistance')).toBe(true);

    expect((await request(application).get('/public/services')).status).toBe(401);
    expect(
      (
        await request(application)
          .get('/public/services')
          .set('authorization', `Bearer ${hospital.adminToken}`)
      ).status,
    ).toBe(401);
    expect(
      (
        await request(application)
          .get('/public/services?hospitalId=x')
          .set('authorization', `Bearer ${guest}`)
      ).status,
    ).toBe(400);
  });

  it('requires a department and SLA policy that belong to the hospital', async () => {
    const admin = as(hospitalA.adminToken);
    const own = await lookup(hospitalA);
    const foreign = await lookup(hospitalB);
    const valid = {
      categoryId: own.category('Food & Water'),
      departmentId: own.department('PANTRY'),
      slaPolicyId: own.sla('Standard'),
      name: `Tea ${randomUUID().slice(0, 6)}`,
    };
    const without = (key: keyof typeof valid) =>
      Object.fromEntries(Object.entries(valid).filter(([field]) => field !== key));

    expect((await admin.post('/admin/services', without('departmentId'))).status).toBe(400);
    expect((await admin.post('/admin/services', without('slaPolicyId'))).status).toBe(400);
    expect((await admin.post('/admin/services', { ...valid, priority: 'EMERGENCY' })).status).toBe(
      400,
    );
    expect(
      (await admin.post('/admin/services', { ...valid, hospitalId: hospitalB.hospitalId })).status,
    ).toBe(400);

    const foreignRefs = [
      { departmentId: foreign.department('PANTRY') },
      { categoryId: foreign.category('Food & Water') },
      { slaPolicyId: foreign.sla('Standard') },
    ];
    for (const ref of foreignRefs) {
      expect(
        (await admin.post('/admin/services', { ...valid, ...ref })).status,
        JSON.stringify(ref),
      ).toBe(404);
    }

    const closed = created(
      await admin.post('/admin/departments', {
        code: `CLOSED-${randomUUID().slice(0, 4)}`,
        name: 'Closed',
      }),
      'department',
    );
    await admin.patch(`/admin/departments/${closed}`, { active: false });
    expect((await admin.post('/admin/services', { ...valid, departmentId: closed })).status).toBe(
      409,
    );

    const serviceId = created(await admin.post('/admin/services', valid), 'service');
    expect((await admin.post('/admin/services', valid)).status).toBe(409);
    expect((await admin.patch(`/admin/services/${serviceId}`, { departmentId: null })).status).toBe(
      400,
    );
    expect(
      (
        await admin.patch(`/admin/services/${serviceId}`, {
          departmentId: foreign.department('PANTRY'),
        })
      ).status,
    ).toBe(404);
  });

  it('isolates catalog and SLA configuration across hospitals', async () => {
    const own = await lookup(hospitalA);
    const intruder = as(hospitalB.adminToken);
    const escalation = created(
      await as(hospitalA.adminToken).post('/admin/escalation-policies', {
        name: `Isolation ${randomUUID().slice(0, 6)}`,
        levels: [{ targetType: 'ASSIGNEE', afterMinutes: 0 }],
      }),
      'escalationPolicy',
    );
    const targets = [
      ['services', own.service('Wheelchair'), { name: 'Stolen' }],
      ['service-categories', own.category('Assistance'), { name: 'Stolen' }],
      ['sla-policies', own.sla('Standard'), { acceptMinutes: 1 }],
      ['escalation-policies', escalation, { name: 'Stolen' }],
    ] as const;
    for (const [path, id, change] of targets) {
      expect(JSON.stringify((await intruder.get(`/admin/${path}`)).body), path).not.toContain(id);
      const statuses = [
        (await intruder.get(`/admin/${path}/${id}`)).status,
        (await intruder.patch(`/admin/${path}/${id}`, change)).status,
        (await intruder.delete(`/admin/${path}/${id}`)).status,
      ];
      expect(statuses, path).toEqual([404, 404, 404]);
    }
    const standard = await database.slaPolicy.findUniqueOrThrow({
      where: { id: own.sla('Standard') },
    });
    expect(standard.currentVersion).toBe(1);

    const otherGuest = await guestToken(hospitalB);
    expect(JSON.stringify(await patientCatalog(otherGuest))).not.toContain(
      own.service('Wheelchair'),
    );
    expect(
      await snapshotService(database, hospitalB.hospitalId, own.service('Wheelchair'), new Date()),
    ).toBeNull();
  });
});

describe('Phase 6 SLA policies', () => {
  it('rejects invalid and negative SLA timings', async () => {
    const admin = as(hospitalA.adminToken);
    const name = `SLA ${randomUUID().slice(0, 6)}`;
    const invalid = [
      { name, acceptMinutes: -5, completeMinutes: 10 },
      { name, acceptMinutes: 5, completeMinutes: -10 },
      { name, acceptMinutes: 0, completeMinutes: 10 },
      { name, acceptMinutes: 2.5, completeMinutes: 10 },
      { name, acceptMinutes: 10, completeMinutes: 5 },
      { name, acceptMinutes: 1441, completeMinutes: 2000 },
      { name, acceptMinutes: '5', completeMinutes: 10 },
      { name },
    ];
    for (const body of invalid) {
      expect((await admin.post('/admin/sla-policies', body)).status, JSON.stringify(body)).toBe(
        400,
      );
    }
    const id = created(
      await admin.post('/admin/sla-policies', { name, acceptMinutes: 5, completeMinutes: 30 }),
      'slaPolicy',
    );
    // A partial edit is validated against the merged result.
    expect((await admin.patch(`/admin/sla-policies/${id}`, { completeMinutes: 4 })).status).toBe(
      400,
    );
    expect((await admin.patch(`/admin/sla-policies/${id}`, { acceptMinutes: 31 })).status).toBe(
      400,
    );

    // The database enforces the same rules without the API.
    await expect(
      database.slaPolicyVersion.create({
        data: {
          hospitalId: hospitalA.hospitalId,
          slaPolicyId: id,
          version: 9,
          acceptMinutes: 10,
          completeMinutes: 5,
        },
      }),
    ).rejects.toThrow();
  });

  it('versions SLA changes so existing request deadlines never move', async () => {
    const hospital = await createHospitalFixture(database, application, 'CAT-V');
    const admin = as(hospital.adminToken);
    const ids = await lookup(hospital);
    const water = ids.service('Drinking Water');
    const quick = ids.sla('Quick response');
    const submittedAt = new Date('2026-10-05T10:00:00.000Z');

    // A request created now freezes version 1 (3 / 10 minutes).
    const before = await snapshotService(database, hospital.hospitalId, water, submittedAt);
    expect(before).toMatchObject({
      serviceName: 'Drinking Water',
      priority: 'NORMAL',
      departmentId: ids.department('PANTRY'),
      slaPolicyVersion: 1,
      acceptMinutes: 3,
      completeMinutes: 10,
      acceptDueAt: new Date('2026-10-05T10:03:00.000Z'),
      completeDueAt: new Date('2026-10-05T10:10:00.000Z'),
    });

    const edited = await admin.patch(`/admin/sla-policies/${quick}`, {
      acceptMinutes: 5,
      completeMinutes: 20,
    });
    expect(edited.status).toBe(200);
    const policy = slaSchema.parse(edited.body).slaPolicy;
    expect(policy).toMatchObject({ currentVersion: 2, acceptMinutes: 5, completeMinutes: 20 });
    expect(
      policy.versions.map((version) => [
        version.version,
        version.acceptMinutes,
        version.completeMinutes,
      ]),
    ).toEqual([
      [2, 5, 20],
      [1, 3, 10],
    ]);

    // New requests use version 2; the earlier snapshot's version is untouched.
    const after = await snapshotService(database, hospital.hospitalId, water, submittedAt);
    expect(after).toMatchObject({
      slaPolicyVersion: 2,
      acceptDueAt: new Date('2026-10-05T10:05:00.000Z'),
    });
    const frozen = await database.slaPolicyVersion.findUniqueOrThrow({
      where: { id: before?.slaPolicyVersionId ?? '' },
    });
    expect(dueDates(submittedAt, frozen)).toEqual({
      acceptDueAt: before?.acceptDueAt,
      completeDueAt: before?.completeDueAt,
    });

    // Renaming does not create a version; versions cannot be edited in place.
    const renamed = slaSchema.parse(
      (await admin.patch(`/admin/sla-policies/${quick}`, { name: 'Fast lane' })).body,
    );
    expect(renamed.slaPolicy.currentVersion).toBe(2);
    await expect(
      database.slaPolicyVersion.update({ where: { id: frozen.id }, data: { acceptMinutes: 99 } }),
    ).rejects.toThrow(/immutable/);
    expect(
      (await database.slaPolicyVersion.findUniqueOrThrow({ where: { id: frozen.id } }))
        .acceptMinutes,
    ).toBe(3);
  });

  it('keeps versions contiguous under concurrent edits', async () => {
    const admin = as(hospitalA.adminToken);
    const id = created(
      await admin.post('/admin/sla-policies', {
        name: `Race ${randomUUID().slice(0, 6)}`,
        acceptMinutes: 1,
        completeMinutes: 100,
      }),
      'slaPolicy',
    );
    const responses = await Promise.all(
      [2, 3, 4, 5, 6].map((minutes) =>
        admin.patch(`/admin/sla-policies/${id}`, { acceptMinutes: minutes }),
      ),
    );
    const succeeded = responses.filter((response) => response.status === 200).length;
    expect(responses.every((response) => [200, 409].includes(response.status))).toBe(true);
    expect(succeeded).toBeGreaterThanOrEqual(1);

    const versions = await database.slaPolicyVersion.findMany({
      where: { slaPolicyId: id },
      orderBy: { version: 'asc' },
    });
    expect(versions.map((version) => version.version)).toEqual(
      Array.from({ length: succeeded + 1 }, (_, index) => index + 1),
    );
    const policy = await database.slaPolicy.findUniqueOrThrow({ where: { id } });
    expect(policy.currentVersion).toBe(succeeded + 1);
  });
});

describe('Phase 6 escalation policies', () => {
  it('configures ordered levels that target the assignee or a hospital role', async () => {
    const admin = as(hospitalA.adminToken);
    const manager = await database.role.create({
      data: { hospitalId: hospitalA.hospitalId, name: `Ward Manager ${randomUUID().slice(0, 6)}` },
    });
    const inactive = await database.role.create({
      data: {
        hospitalId: hospitalA.hospitalId,
        name: `Retired ${randomUUID().slice(0, 6)}`,
        active: false,
      },
    });
    const foreignRole = await database.role.findFirstOrThrow({
      where: { hospitalId: hospitalB.hospitalId },
    });
    const name = `Escalate ${randomUUID().slice(0, 6)}`;
    const attempt = (levels: object[]) =>
      admin.post('/admin/escalation-policies', { name, levels });

    expect((await attempt([])).status).toBe(400);
    expect((await attempt([{ targetType: 'ROLE', afterMinutes: 0 }])).status).toBe(400);
    expect(
      (await attempt([{ targetType: 'ASSIGNEE', afterMinutes: 0, roleId: manager.id }])).status,
    ).toBe(400);
    expect(
      (
        await attempt([
          { targetType: 'ASSIGNEE', afterMinutes: 5 },
          { targetType: 'ROLE', roleId: manager.id, afterMinutes: 5 },
        ])
      ).status,
    ).toBe(400);
    expect(
      (await attempt([{ targetType: 'ROLE', roleId: foreignRole.id, afterMinutes: 0 }])).status,
    ).toBe(404);
    expect(
      (await attempt([{ targetType: 'ROLE', roleId: inactive.id, afterMinutes: 0 }])).status,
    ).toBe(404);

    const response = await attempt([
      { targetType: 'ASSIGNEE', afterMinutes: 0 },
      { targetType: 'ROLE', roleId: manager.id, afterMinutes: 5 },
    ]);
    const policy = z
      .object({
        escalationPolicy: z.object({
          id: uuid,
          levels: z.array(z.object({ level: z.number(), targetType: z.string() }).passthrough()),
        }),
      })
      .parse(response.body).escalationPolicy;
    expect(policy.levels.map((level) => [level.level, level.targetType])).toEqual([
      [1, 'ASSIGNEE'],
      [2, 'ROLE'],
    ]);

    // Attach it to a service; then the policy and its role are in use.
    const ids = await lookup(hospitalA);
    const wheelchair = ids.service('Wheelchair');
    expect(
      (await admin.patch(`/admin/services/${wheelchair}`, { escalationPolicyId: policy.id }))
        .status,
    ).toBe(200);
    expect(
      (await snapshotService(database, hospitalA.hospitalId, wheelchair, new Date()))
        ?.escalationPolicyId,
    ).toBe(policy.id);
    expect((await admin.delete(`/admin/escalation-policies/${policy.id}`)).status).toBe(409);
    expect((await admin.delete(`/admin/roles/${manager.id}`)).status).toBe(409);

    const replaced = await admin.patch(`/admin/escalation-policies/${policy.id}`, {
      levels: [{ targetType: 'ASSIGNEE', afterMinutes: 2 }],
    });
    expect(replaced.status).toBe(200);
    expect((await admin.delete(`/admin/roles/${manager.id}`)).status).toBe(204);
    expect(
      (await admin.patch(`/admin/services/${wheelchair}`, { escalationPolicyId: null })).status,
    ).toBe(200);
    expect((await admin.delete(`/admin/escalation-policies/${policy.id}`)).status).toBe(204);
  });
});

describe('Phase 6 configuration safety', () => {
  it('protects configuration that is in use from deletion', async () => {
    const hospital = await createHospitalFixture(database, application, 'CAT-D');
    const admin = as(hospital.adminToken);
    const ids = await lookup(hospital);
    expect(
      (await admin.delete(`/admin/service-categories/${ids.category('Assistance')}`)).status,
    ).toBe(409);
    expect((await admin.delete(`/admin/sla-policies/${ids.sla('Standard')}`)).status).toBe(409);
    expect((await admin.delete(`/admin/departments/${ids.department('TRANSPORT')}`)).status).toBe(
      409,
    );

    expect((await admin.delete(`/admin/services/${ids.service('Wheelchair')}`)).status).toBe(204);
    expect(
      (await admin.delete(`/admin/service-categories/${ids.category('Assistance')}`)).status,
    ).toBe(204);
  });

  it('requires catalog and SLA permissions', async () => {
    const reader = as(await createStaffToken(database, application, hospitalA, ['service.read']));
    expect((await reader.get('/admin/services')).status).toBe(200);
    expect((await reader.get('/admin/sla-policies')).status).toBe(200);
    expect((await reader.get('/admin/escalation-policies')).status).toBe(200);
    expect((await reader.post('/admin/service-categories', { name: 'Nope' })).status).toBe(403);

    const catalogManager = as(
      await createStaffToken(database, application, hospitalA, ['service.read', 'service.manage']),
    );
    expect(
      (
        await catalogManager.post('/admin/service-categories', {
          name: `Comfort ${randomUUID().slice(0, 6)}`,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await catalogManager.post('/admin/sla-policies', {
          name: 'Nope',
          acceptMinutes: 1,
          completeMinutes: 2,
        })
      ).status,
    ).toBe(403);
    expect((await request(application).get('/admin/services')).status).toBe(401);
  });

  it('audits catalog and SLA changes', async () => {
    const admin = as(hospitalA.adminToken);
    const id = created(
      await admin.post('/admin/sla-policies', {
        name: `Audit ${randomUUID().slice(0, 6)}`,
        acceptMinutes: 2,
        completeMinutes: 8,
      }),
      'slaPolicy',
    );
    await admin.patch(`/admin/sla-policies/${id}`, { completeMinutes: 9 });
    const entries = await database.auditLog.findMany({
      where: { hospitalId: hospitalA.hospitalId, targetId: id },
      orderBy: { createdAt: 'asc' },
    });
    expect(entries.map((entry) => entry.action)).toEqual(['sla.create', 'sla.update']);
    expect(entries[1]?.metadata).toMatchObject({
      before: { version: 1, completeMinutes: 8 },
      after: { version: 2, completeMinutes: 9 },
    });
  });
});
