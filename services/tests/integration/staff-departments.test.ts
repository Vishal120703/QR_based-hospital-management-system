import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { z } from 'zod';
import { createApp } from '../../src/app.js';
import { createLogger } from '../../src/config/logger.js';
import { createPrismaClient } from '../../src/database/prisma.js';
import { exampleDepartments } from '../../src/modules/departments/department.service.js';
import {
  createBedFixture,
  createHospitalFixture,
  createStaffToken,
  requireTestDatabaseUrl,
  type HospitalFixture,
} from '../support/fixtures.js';

const database = createPrismaClient(requireTestDatabaseUrl());
const application = createApp({ logger: createLogger('silent'), database });
const staffPassword = 'StaffPassword123!';

const uuid = z.string().uuid();
const staffSchema = z
  .object({
    id: uuid,
    email: z.string(),
    displayName: z.string(),
    status: z.string(),
    dutyStatus: z.string(),
    departmentIds: z.array(uuid),
    coverage: z.array(
      z.object({
        id: uuid,
        scopeType: z.string(),
        floorId: uuid.nullable(),
        wardId: uuid.nullable(),
      }),
    ),
    roleIds: z.array(uuid),
  })
  .passthrough();
type Staff = z.infer<typeof staffSchema>;
const staffResponse = z.object({ staff: staffSchema });
const eligibleResponse = z.object({
  staff: z.array(z.object({ membershipId: uuid, displayName: z.string() }).passthrough()),
});
const departmentListSchema = z.object({
  departments: z.array(z.object({ id: uuid, code: z.string(), name: z.string() }).passthrough()),
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

async function departmentId(hospital: HospitalFixture, code: string): Promise<string> {
  const department = await database.department.findUniqueOrThrow({
    where: { hospitalId_code: { hospitalId: hospital.hospitalId, code } },
  });
  return department.id;
}

async function createStaff(hospital: HospitalFixture, displayName: string): Promise<Staff> {
  const response = await as(hospital.adminToken).post('/admin/staff', {
    email: `${displayName.toLowerCase()}-${randomUUID().slice(0, 8)}@example.test`,
    displayName,
    password: staffPassword,
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return staffResponse.parse(response.body).staff;
}

type Coverage = { scopeType: 'HOSPITAL' } | { floorId: string } | { wardId: string };

async function configure(
  hospital: HospitalFixture,
  staff: Staff,
  setup: { departments: string[]; coverage: Coverage[]; onDuty: boolean },
): Promise<void> {
  const admin = as(hospital.adminToken);
  for (const id of setup.departments) {
    expect(
      (await admin.post(`/admin/staff/${staff.id}/departments`, { departmentId: id })).status,
    ).toBe(201);
  }
  for (const scope of setup.coverage) {
    const body =
      'floorId' in scope
        ? { scopeType: 'FLOOR', floorId: scope.floorId }
        : 'wardId' in scope
          ? { scopeType: 'WARD', wardId: scope.wardId }
          : scope;
    const response = await admin.post(`/admin/staff/${staff.id}/coverage`, body);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
  }
  if (setup.onDuty) {
    expect(
      (await admin.post(`/admin/staff/${staff.id}/duty`, { dutyStatus: 'ON_DUTY' })).status,
    ).toBe(200);
  }
}

async function eligibleNames(
  hospital: HospitalFixture,
  bedId: string,
  department: string,
): Promise<string[]> {
  const response = await as(hospital.adminToken).get(
    `/admin/staff/eligible?bedId=${bedId}&departmentId=${department}`,
  );
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return eligibleResponse.parse(response.body).staff.map((item) => item.displayName);
}

async function login(hospital: HospitalFixture, email: string): Promise<string> {
  const response = await request(application)
    .post('/auth/staff/login')
    .send({ hospitalCode: hospital.code, email, password: staffPassword });
  expect(response.status).toBe(200);
  return z.object({ token: z.string() }).parse(response.body).token;
}

beforeAll(async () => {
  hospitalA = await createHospitalFixture(database, application, 'STF-A');
  hospitalB = await createHospitalFixture(database, application, 'STF-B');
});

afterAll(async () => {
  await database.$disconnect();
});

describe('Phase 5 departments', () => {
  it('seeds editable example departments for every new hospital', async () => {
    const response = await as(hospitalA.adminToken).get('/admin/departments');
    expect(response.status).toBe(200);
    const codes = departmentListSchema
      .parse(response.body)
      .departments.map((item) => item.code)
      .sort();
    expect(codes).toEqual(exampleDepartments.map(([code]) => code).sort());

    const pantry = await departmentId(hospitalA, 'PANTRY');
    const renamed = await as(hospitalA.adminToken).patch(`/admin/departments/${pantry}`, {
      name: 'Food & Beverage',
    });
    expect(renamed.status).toBe(200);
  });

  it('isolates department CRUD across hospitals and protects departments in use', async () => {
    const admin = as(hospitalA.adminToken);
    const created = await admin.post('/admin/departments', { code: 'pharmacy', name: 'Pharmacy' });
    expect(created.status).toBe(201);
    const id = z
      .object({ department: z.object({ id: uuid, code: z.string() }) })
      .parse(created.body).department;
    expect(id.code).toBe('PHARMACY');
    expect((await admin.post('/admin/departments', { code: 'PHARMACY', name: 'Dup' })).status).toBe(
      409,
    );

    const intruder = as(hospitalB.adminToken);
    expect(JSON.stringify((await intruder.get('/admin/departments')).body)).not.toContain(id.id);
    expect((await intruder.get(`/admin/departments/${id.id}`)).status).toBe(404);
    expect((await intruder.patch(`/admin/departments/${id.id}`, { name: 'Stolen' })).status).toBe(
      404,
    );
    expect((await intruder.delete(`/admin/departments/${id.id}`)).status).toBe(404);

    const member = await createStaff(hospitalA, 'Pharma');
    await configure(hospitalA, member, { departments: [id.id], coverage: [], onDuty: false });
    expect((await admin.delete(`/admin/departments/${id.id}`)).status).toBe(409);
    expect((await admin.delete(`/admin/staff/${member.id}/departments/${id.id}`)).status).toBe(200);
    expect((await admin.delete(`/admin/departments/${id.id}`)).status).toBe(204);
  });
});

describe('Phase 5 staff', () => {
  it('creates staff who can work once they hold a role', async () => {
    const admin = as(hospitalA.adminToken);
    const member = await createStaff(hospitalA, 'Asha');
    expect(member).toMatchObject({ status: 'ACTIVE', dutyStatus: 'OFF_DUTY', roleIds: [] });

    // Credentials are valid, but a membership without a role grants no access.
    const token = await login(hospitalA, member.email);
    expect((await as(token).get('/auth/staff/me')).status).toBe(401);

    const role = await database.role.create({
      data: { hospitalId: hospitalA.hospitalId, name: `Reader ${randomUUID().slice(0, 6)}` },
    });
    await database.rolePermission.create({
      data: { hospitalId: hospitalA.hospitalId, roleId: role.id, permissionKey: 'staff.read' },
    });
    expect(
      (await admin.post(`/admin/memberships/${member.id}/roles`, { roleId: role.id })).status,
    ).toBe(201);
    const me = await as(await login(hospitalA, member.email)).get('/auth/staff/me');
    expect(me.status).toBe(200);
    expect(z.object({ membershipId: uuid }).parse(me.body).membershipId).toBe(member.id);

    expect(
      (
        await admin.post('/admin/staff', {
          email: member.email.toUpperCase(),
          displayName: 'Copy',
          password: staffPassword,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await admin.post('/admin/staff', {
          email: 'short@example.test',
          displayName: 'Short',
          password: 'short',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await admin.post('/admin/staff', {
          email: 'forged@example.test',
          displayName: 'Forged',
          password: staffPassword,
          hospitalId: hospitalB.hospitalId,
        })
      ).status,
    ).toBe(400);

    const stored = await database.auditLog.findFirstOrThrow({
      where: { hospitalId: hospitalA.hospitalId, action: 'staff.create', targetId: member.id },
    });
    expect(JSON.stringify(stored)).not.toContain(staffPassword);
  });

  it('removes roles symmetrically with assignment and never from yourself', async () => {
    const admin = as(hospitalA.adminToken);
    const member = await createStaff(hospitalA, 'Ravi');
    const role = await database.role.create({
      data: { hospitalId: hospitalA.hospitalId, name: `Temp ${randomUUID().slice(0, 6)}` },
    });
    await admin.post(`/admin/memberships/${member.id}/roles`, { roleId: role.id });
    expect((await admin.delete(`/admin/memberships/${member.id}/roles/${role.id}`)).status).toBe(
      204,
    );
    expect((await admin.delete(`/admin/memberships/${member.id}/roles/${role.id}`)).status).toBe(
      404,
    );

    const me = z
      .object({ membershipId: uuid })
      .parse((await admin.get('/auth/staff/me')).body).membershipId;
    const adminRole = await database.role.findFirstOrThrow({
      where: { hospitalId: hospitalA.hospitalId, name: 'Hospital Admin' },
    });
    expect((await admin.delete(`/admin/memberships/${me}/roles/${adminRole.id}`)).status).toBe(409);

    // A manager without every admin permission cannot strip the admin role.
    const manager = as(
      await createStaffToken(database, application, hospitalA, ['staff.manage', 'role.manage']),
    );
    expect((await manager.delete(`/admin/memberships/${me}/roles/${adminRole.id}`)).status).toBe(
      403,
    );
  });

  it('keeps duty and membership status consistent', async () => {
    const admin = as(hospitalA.adminToken);
    const member = await createStaff(hospitalA, 'Kiran');
    const role = await database.role.create({
      data: { hospitalId: hospitalA.hospitalId, name: `Duty ${randomUUID().slice(0, 6)}` },
    });
    await admin.post(`/admin/memberships/${member.id}/roles`, { roleId: role.id });
    const token = await login(hospitalA, member.email);
    expect((await as(token).get('/auth/staff/me')).status).toBe(200);

    const onDuty = await admin.post(`/admin/staff/${member.id}/duty`, { dutyStatus: 'ON_DUTY' });
    expect(staffResponse.parse(onDuty.body).staff.dutyStatus).toBe('ON_DUTY');
    const again = await admin.post(`/admin/staff/${member.id}/duty`, { dutyStatus: 'ON_DUTY' });
    expect(again.status).toBe(200);
    expect(
      await database.auditLog.count({
        where: { hospitalId: hospitalA.hospitalId, action: 'staff.duty', targetId: member.id },
      }),
    ).toBe(1);

    const deactivated = await admin.post(`/admin/staff/${member.id}/status`, {
      status: 'INACTIVE',
    });
    expect(deactivated.status).toBe(200);
    expect(staffResponse.parse(deactivated.body).staff).toMatchObject({
      status: 'INACTIVE',
      dutyStatus: 'OFF_DUTY',
    });
    expect((await as(token).get('/auth/staff/me')).status).toBe(401);
    expect(
      (await admin.post(`/admin/staff/${member.id}/duty`, { dutyStatus: 'ON_DUTY' })).status,
    ).toBe(409);

    const reactivated = await admin.post(`/admin/staff/${member.id}/status`, { status: 'ACTIVE' });
    expect(staffResponse.parse(reactivated.body).staff).toMatchObject({
      status: 'ACTIVE',
      dutyStatus: 'OFF_DUTY',
    });

    const me = z
      .object({ membershipId: uuid })
      .parse((await admin.get('/auth/staff/me')).body).membershipId;
    expect((await admin.post(`/admin/staff/${me}/status`, { status: 'INACTIVE' })).status).toBe(
      409,
    );
  });

  it('validates departments and coverage, in the API and the database', async () => {
    const admin = as(hospitalA.adminToken);
    const member = await createStaff(hospitalA, 'Leela');
    const ownBed = await createBedFixture(database, hospitalA);
    const foreignBed = await createBedFixture(database, hospitalB);

    const coverage = (body: object) => admin.post(`/admin/staff/${member.id}/coverage`, body);
    expect((await coverage({ scopeType: 'WARD', wardId: foreignBed.wardId })).status).toBe(404);
    expect((await coverage({ scopeType: 'WARD', wardId: ownBed.wardId })).status).toBe(201);
    expect((await coverage({ scopeType: 'WARD', wardId: ownBed.wardId })).status).toBe(409);
    expect((await coverage({ scopeType: 'HOSPITAL' })).status).toBe(201);
    expect((await coverage({ scopeType: 'HOSPITAL' })).status).toBe(409);
    expect((await coverage({ scopeType: 'FLOOR', wardId: ownBed.wardId })).status).toBe(400);
    expect((await coverage({ scopeType: 'ROOM' })).status).toBe(400);

    const inactiveWard = await createBedFixture(database, hospitalA);
    await database.bed.update({ where: { id: inactiveWard.bedId }, data: { active: false } });
    await database.ward.update({ where: { id: inactiveWard.wardId }, data: { active: false } });
    expect((await coverage({ scopeType: 'WARD', wardId: inactiveWard.wardId })).status).toBe(409);

    const current = staffResponse.parse((await admin.get(`/admin/staff/${member.id}`)).body).staff;
    const wardScope = current.coverage.find((item) => item.scopeType === 'WARD');
    expect(wardScope).toBeDefined();
    expect(
      (await admin.delete(`/admin/staff/${member.id}/coverage/${wardScope?.id ?? ''}`)).status,
    ).toBe(200);

    const billing = await departmentId(hospitalA, 'BILLING');
    await admin.patch(`/admin/departments/${billing}`, { active: false });
    expect(
      (await admin.post(`/admin/staff/${member.id}/departments`, { departmentId: billing })).status,
    ).toBe(409);
    const foreignDepartment = await departmentId(hospitalB, 'NURSING');
    expect(
      (
        await admin.post(`/admin/staff/${member.id}/departments`, {
          departmentId: foreignDepartment,
        })
      ).status,
    ).toBe(404);

    // Composite foreign keys and the CHECK constraint hold without the API.
    await expect(
      database.staffLocationScope.create({
        data: {
          hospitalId: hospitalA.hospitalId,
          membershipId: member.id,
          scopeType: 'WARD',
          wardId: foreignBed.wardId,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      database.staffDepartment.create({
        data: {
          hospitalId: hospitalA.hospitalId,
          membershipId: member.id,
          departmentId: foreignDepartment,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      database.staffLocationScope.create({
        data: {
          hospitalId: hospitalA.hospitalId,
          membershipId: member.id,
          scopeType: 'FLOOR',
          wardId: ownBed.wardId,
        },
      }),
    ).rejects.toThrow();
  });

  it('isolates staff across hospitals', async () => {
    const member = await createStaff(hospitalA, 'Tara');
    const nursing = await departmentId(hospitalA, 'NURSING');
    const intruder = as(hospitalB.adminToken);
    const ownBed = await createBedFixture(database, hospitalA);

    expect(JSON.stringify((await intruder.get('/admin/staff')).body)).not.toContain(member.id);
    const attempts = [
      await intruder.get(`/admin/staff/${member.id}`),
      await intruder.post(`/admin/staff/${member.id}/status`, { status: 'INACTIVE' }),
      await intruder.post(`/admin/staff/${member.id}/duty`, { dutyStatus: 'ON_DUTY' }),
      await intruder.post(`/admin/staff/${member.id}/departments`, { departmentId: nursing }),
      await intruder.post(`/admin/staff/${member.id}/coverage`, { scopeType: 'HOSPITAL' }),
      await intruder.get(`/admin/staff/eligible?bedId=${ownBed.bedId}&departmentId=${nursing}`),
      await intruder.post('/admin/shifts', {
        membershipId: member.id,
        startsAt: '2026-11-01T08:00:00Z',
        endsAt: '2026-11-01T16:00:00Z',
      }),
    ];
    expect(attempts.map((response) => response.status)).toEqual([
      404, 404, 404, 404, 404, 404, 404,
    ]);
    const stored = await database.hospitalMembership.findUniqueOrThrow({
      where: { id: member.id },
    });
    expect(stored).toMatchObject({ status: 'ACTIVE', dutyStatus: 'OFF_DUTY' });
  });

  it('requires staff permissions', async () => {
    const reader = as(await createStaffToken(database, application, hospitalA, ['staff.read']));
    expect((await reader.get('/admin/staff')).status).toBe(200);
    expect((await reader.get('/admin/departments')).status).toBe(200);
    expect(
      (
        await reader.post('/admin/staff', {
          email: 'x@example.test',
          displayName: 'X',
          password: staffPassword,
        })
      ).status,
    ).toBe(403);
    expect((await reader.post('/admin/departments', { code: 'X', name: 'X' })).status).toBe(403);
    expect((await request(application).get('/admin/staff')).status).toBe(401);
  });
});

describe('Phase 5 eligibility', () => {
  it('requires department, location coverage, duty, and active status', async () => {
    const hospital = await createHospitalFixture(database, application, 'ELIG');
    const { hospitalId } = hospital;
    const floor1 = await database.floor.create({ data: { hospitalId, code: 'F1', name: 'F1' } });
    const floor2 = await database.floor.create({ data: { hospitalId, code: 'F2', name: 'F2' } });
    const ward = (floorId: string, code: string) =>
      database.ward.create({ data: { hospitalId, floorId, code, name: code } });
    const w1 = await ward(floor1.id, 'W1');
    const w2 = await ward(floor1.id, 'W2');
    const w3 = await ward(floor2.id, 'W3');
    const bed = (wardId: string, code: string) =>
      database.bed.create({ data: { hospitalId, wardId, code, displayName: code } });
    const b1 = await bed(w1.id, 'B1');
    const b2 = await bed(w2.id, 'B2');
    const b3 = await bed(w3.id, 'B3');
    const housekeeping = await departmentId(hospital, 'HOUSEKEEPING');
    const nursing = await departmentId(hospital, 'NURSING');

    const hire = async (name: string, setup: Parameters<typeof configure>[2]) => {
      const member = await createStaff(hospital, name);
      await configure(hospital, member, setup);
      return member;
    };
    await hire('Hana', {
      departments: [housekeeping],
      coverage: [{ wardId: w1.id }],
      onDuty: true,
    });
    await hire('Farid', {
      departments: [housekeeping],
      coverage: [{ floorId: floor1.id }],
      onDuty: true,
    });
    await hire('Mira', {
      departments: [housekeeping],
      coverage: [{ floorId: floor1.id }, { floorId: floor2.id }],
      onDuty: true,
    });
    await hire('Omar', {
      departments: [housekeeping],
      coverage: [{ scopeType: 'HOSPITAL' }],
      onDuty: false,
    });
    await hire('Nina', {
      departments: [nursing],
      coverage: [{ scopeType: 'HOSPITAL' }],
      onDuty: true,
    });
    await hire('Dev', {
      departments: [housekeeping, nursing],
      coverage: [{ wardId: w3.id }],
      onDuty: true,
    });
    await hire('Zed', { departments: [housekeeping], coverage: [], onDuty: true });
    const ivan = await hire('Ivan', {
      departments: [housekeeping],
      coverage: [{ scopeType: 'HOSPITAL' }],
      onDuty: true,
    });
    const uma = await hire('Uma', {
      departments: [housekeeping],
      coverage: [{ scopeType: 'HOSPITAL' }],
      onDuty: true,
    });

    // Ivan and Uma are eligible until their membership or account is deactivated.
    expect(await eligibleNames(hospital, b2.id, housekeeping)).toEqual([
      'Farid',
      'Ivan',
      'Mira',
      'Uma',
    ]);
    // Written directly so Ivan stays ON_DUTY: this isolates the membership-status
    // rule (the API would also set him OFF_DUTY, which is tested separately).
    await database.hospitalMembership.update({
      where: { id: ivan.id },
      data: { status: 'SUSPENDED' },
    });
    await database.user.update({
      where: { id: z.string().parse(uma.userId) },
      data: { status: 'INACTIVE' },
    });

    expect(await eligibleNames(hospital, b1.id, housekeeping)).toEqual(['Farid', 'Hana', 'Mira']);
    expect(await eligibleNames(hospital, b2.id, housekeeping)).toEqual(['Farid', 'Mira']);
    expect(await eligibleNames(hospital, b3.id, housekeeping)).toEqual(['Dev', 'Mira']);
    expect(await eligibleNames(hospital, b1.id, nursing)).toEqual(['Nina']);
    expect(await eligibleNames(hospital, b3.id, nursing)).toEqual(['Dev', 'Nina']);

    // Going off duty removes someone immediately; an inactive department has nobody.
    const mira = await database.hospitalMembership.findFirstOrThrow({
      where: { hospitalId, user: { displayName: 'Mira' } },
    });
    await as(hospital.adminToken).post(`/admin/staff/${mira.id}/duty`, { dutyStatus: 'OFF_DUTY' });
    expect(await eligibleNames(hospital, b3.id, housekeeping)).toEqual(['Dev']);
    await as(hospital.adminToken).patch(`/admin/departments/${nursing}`, { active: false });
    expect(await eligibleNames(hospital, b3.id, nursing)).toEqual([]);

    // Hospital A's staff are never eligible for, or able to query, another hospital's bed.
    expect(
      (
        await as(hospitalA.adminToken).get(
          `/admin/staff/eligible?bedId=${b1.id}&departmentId=${housekeeping}`,
        )
      ).status,
    ).toBe(404);
  });
});

describe('Phase 5 shifts', () => {
  it('schedules shifts without overlaps and without changing eligibility', async () => {
    const admin = as(hospitalA.adminToken);
    const member = await createStaff(hospitalA, 'Sana');
    const nursing = await departmentId(hospitalA, 'NURSING');
    const shift = (startsAt: string, endsAt: string, extra: object = {}) =>
      admin.post('/admin/shifts', { membershipId: member.id, startsAt, endsAt, ...extra });

    const created = await shift('2026-11-01T08:00:00Z', '2026-11-01T16:00:00Z');
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const shiftId = z.object({ shift: z.object({ id: uuid }) }).parse(created.body).shift.id;

    expect((await shift('2026-11-01T15:00:00Z', '2026-11-01T20:00:00Z')).status).toBe(409);
    expect((await shift('2026-11-01T16:00:00Z', '2026-11-01T22:00:00Z')).status).toBe(201);
    expect((await shift('2026-11-02T10:00:00Z', '2026-11-02T09:00:00Z')).status).toBe(400);
    expect((await shift('2026-11-03T00:00:00Z', '2026-11-04T01:00:00Z')).status).toBe(400);
    expect(
      (await shift('2026-11-05T08:00:00Z', '2026-11-05T16:00:00Z', { departmentId: nursing }))
        .status,
    ).toBe(409);

    const listed = await admin.get(
      `/admin/shifts?membershipId=${member.id}&from=2026-11-01T00:00:00Z&to=2026-11-02T00:00:00Z`,
    );
    expect(z.object({ shifts: z.array(z.unknown()) }).parse(listed.body).shifts).toHaveLength(2);

    expect((await as(hospitalB.adminToken).delete(`/admin/shifts/${shiftId}`)).status).toBe(404);
    expect((await admin.delete(`/admin/shifts/${shiftId}`)).status).toBe(204);

    const stored = await database.hospitalMembership.findUniqueOrThrow({
      where: { id: member.id },
    });
    expect(stored.dutyStatus).toBe('OFF_DUTY');
  });
});

describe('Phase 5 audit', () => {
  it('records every staff change without secrets', async () => {
    const admin = as(hospitalA.adminToken);
    const member = await createStaff(hospitalA, 'Audit');
    const nursing = await departmentId(hospitalA, 'NURSING');
    await configure(hospitalA, member, {
      departments: [nursing],
      coverage: [{ scopeType: 'HOSPITAL' }],
      onDuty: true,
    });
    await admin.post(`/admin/staff/${member.id}/status`, { status: 'SUSPENDED' });

    const entries = await database.auditLog.findMany({
      where: { hospitalId: hospitalA.hospitalId, targetId: member.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(entries.map((entry) => entry.action)).toEqual([
      'staff.create',
      'staff.department.add',
      'staff.coverage.add',
      'staff.duty',
      'staff.status',
    ]);
    expect(entries.every((entry) => entry.actorType === 'STAFF' && entry.requestId)).toBe(true);
    expect(JSON.stringify(entries)).not.toContain(staffPassword);
  });
});
