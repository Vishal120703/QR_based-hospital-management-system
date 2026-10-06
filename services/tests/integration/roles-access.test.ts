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
let otherHospital: HospitalFixture;
let roleIds: Record<string, string>;
let departmentIds: Record<string, string>;
let layout: {
  floorA: string;
  floorB: string;
  wardA: string;
  wardB: string;
  bedA: string;
  bedB: string;
};

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

// Creates a staff member through the API and returns their id, email, and token.
async function staffMember(name: string) {
  const email = `${name.toLowerCase()}-${randomUUID().slice(0, 6)}@example.test`;
  const created = await as(hospital.adminToken).post('/admin/staff', {
    email,
    displayName: name,
    password: fixturePassword,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const id = z.object({ staff: z.object({ id: uuid }) }).parse(created.body).staff.id;
  return { id, email };
}

async function give(membershipId: string, roleKey: string, scopeId?: string) {
  return as(hospital.adminToken).post(`/admin/memberships/${membershipId}/roles`, {
    roleId: roleIds[roleKey],
    ...(scopeId ? { scopeId } : {}),
  });
}

async function signIn(email: string) {
  return loginStaff(application, hospital.code, email);
}

// A patient request on a bed, for one named service.
async function patientRequest(bedId: string, serviceName: string) {
  const admin = as(hospital.adminToken);
  const qrCodes = await database.bedQrCode.findFirst({ where: { bedId } });
  const qr = qrCodes
    ? z
        .object({ token: z.string() })
        .parse((await admin.post(`/admin/beds/${bedId}/qr/rotate`)).body)
    : z.object({ token: z.string() }).parse((await admin.post(`/admin/beds/${bedId}/qr`)).body);
  if (!(await database.bedSession.findFirst({ where: { bedId, status: 'ACTIVE' } }))) {
    expect((await admin.post('/admin/bed-sessions', { bedId })).status).toBe(201);
  }
  const resolved = await request(application).post('/public/qr/resolve').send({ token: qr.token });
  const guest = z.object({ guestToken: z.string() }).parse(resolved.body).guestToken;
  const service = await database.serviceItem.findFirstOrThrow({
    where: { hospitalId: hospital.hospitalId, name: serviceName },
  });
  const submitted = await as(guest).post('/public/requests', { serviceId: service.id });
  expect([200, 201]).toContain(submitted.status);
  const publicId = z
    .object({ serviceRequest: z.object({ publicId: z.string() }) })
    .parse(submitted.body).serviceRequest.publicId;
  return database.serviceRequest.findUniqueOrThrow({ where: { publicId } });
}

beforeAll(async () => {
  hospital = await createHospitalFixture(database, application, 'ROLES');
  otherHospital = await createHospitalFixture(database, application, 'ROLES-X');
  const roles = await database.role.findMany({
    where: { hospitalId: hospital.hospitalId, systemKey: { not: null } },
  });
  roleIds = Object.fromEntries(roles.map((role) => [role.systemKey!, role.id]));
  const departments = await database.department.findMany({
    where: { hospitalId: hospital.hospitalId },
  });
  departmentIds = Object.fromEntries(departments.map((item) => [item.code, item.id]));
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
  layout = {
    floorA: floorA.id,
    floorB: floorB.id,
    wardA: wardA.id,
    wardB: wardB.id,
    bedA: bedA.id,
    bedB: bedB.id,
  };
});

afterAll(async () => {
  await database.$disconnect();
});

describe('Role hierarchy and scoped access', () => {
  it('gives every hospital the built-in hierarchy and protects the Hospital Manager role', async () => {
    expect(Object.keys(roleIds).sort()).toEqual([
      'CARE_STAFF',
      'DEPARTMENT_SUPERVISOR',
      'FLOOR_MANAGER',
      'HOSPITAL_MANAGER',
      'WARD_MANAGER',
    ]);
    const admin = as(hospital.adminToken);
    const listed = await admin.get('/admin/roles');
    const manager = z
      .object({
        roles: z.array(
          z
            .object({
              systemKey: z.string().nullable(),
              locked: z.boolean(),
              memberCount: z.number(),
            })
            .passthrough(),
        ),
      })
      .parse(listed.body)
      .roles.find((role) => role.systemKey === 'HOSPITAL_MANAGER');
    expect(manager).toMatchObject({ locked: true, memberCount: 1 });

    expect(
      (await admin.patch(`/admin/roles/${roleIds.HOSPITAL_MANAGER}`, { description: 'x' })).status,
    ).toBe(409);
    expect((await admin.delete(`/admin/roles/${roleIds.FLOOR_MANAGER}`)).status).toBe(409);
    expect(
      (await admin.patch(`/admin/roles/${roleIds.CARE_STAFF}`, { name: 'Renamed' })).status,
    ).toBe(409);
    // A built-in role below the manager can still be tuned.
    const tuned = await admin.patch(`/admin/roles/${roleIds.CARE_STAFF}`, {
      permissionKeys: ['request.read', 'request.accept', 'request.start', 'request.complete'],
    });
    expect(tuned.status, JSON.stringify(tuned.body)).toBe(200);
  });

  it('lets a hospital create its own department and a role for it', async () => {
    const admin = as(hospital.adminToken);
    const department = await admin.post('/admin/departments', {
      code: 'PHYSIO',
      name: 'Physiotherapy',
    });
    expect(department.status, JSON.stringify(department.body)).toBe(201);
    const physioId = z.object({ department: z.object({ id: uuid }) }).parse(department.body)
      .department.id;
    const role = await admin.post('/admin/roles', {
      name: 'Physio Lead',
      description: 'Runs the physiotherapy team',
      scopeLevel: 'DEPARTMENT',
      permissionKeys: ['request.read', 'request.assign', 'staff.read'],
    });
    expect(role.status, JSON.stringify(role.body)).toBe(201);
    expect(role.body).toMatchObject({ role: { scopeLevel: 'DEPARTMENT', builtIn: false } });
    const roleId = z.object({ role: z.object({ id: uuid }) }).parse(role.body).role.id;
    const lead = await staffMember('Priya');
    const assigned = await admin.post(`/admin/memberships/${lead.id}/roles`, {
      roleId,
      scopeId: physioId,
    });
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(201);
    expect(assigned.body).toMatchObject({
      assignment: { scopeType: 'DEPARTMENT', scopeId: physioId },
    });
    // While assigned, the role's level cannot change.
    expect((await admin.patch(`/admin/roles/${roleId}`, { scopeLevel: 'WARD' })).status).toBe(409);
  });

  it('validates the place a role is given for', async () => {
    const person = await staffMember('Ravi');
    expect((await give(person.id, 'FLOOR_MANAGER')).status).toBe(400);
    expect((await give(person.id, 'FLOOR_MANAGER', layout.wardA)).status).toBe(404);
    const foreignFloor = await database.floor.create({
      data: { hospitalId: otherHospital.hospitalId, code: 'X1', name: 'Foreign' },
    });
    expect((await give(person.id, 'FLOOR_MANAGER', foreignFloor.id)).status).toBe(404);
    expect((await give(person.id, 'CARE_STAFF', layout.floorA)).status).toBe(400);
    expect((await give(person.id, 'FLOOR_MANAGER', layout.floorA)).status).toBe(201);
    expect((await give(person.id, 'FLOOR_MANAGER', layout.floorA)).status).toBe(409);
    expect((await give(person.id, 'FLOOR_MANAGER', layout.floorB)).status).toBe(201);
    const staff = await as(hospital.adminToken).get(`/admin/staff/${person.id}`);
    expect(staff.body).toMatchObject({
      staff: {
        roleAssignments: [
          {
            roleId: roleIds.FLOOR_MANAGER,
            scopes: expect.arrayContaining([
              { type: 'FLOOR', id: layout.floorA },
              { type: 'FLOOR', id: layout.floorB },
            ]) as unknown,
          },
        ],
      },
    });
    // Removing one place keeps the other.
    const admin = as(hospital.adminToken);
    expect(
      (
        await admin.delete(
          `/admin/memberships/${person.id}/roles/${roleIds.FLOOR_MANAGER}/scopes/${layout.floorB}`,
        )
      ).status,
    ).toBe(204);
    const after = await database.scopeAssignment.findMany({
      where: { userRole: { membershipId: person.id } },
    });
    expect(after.map((scope) => scope.scopeId)).toEqual([layout.floorA]);
  });

  it('shows a floor manager only their floor and lets them admit patients there', async () => {
    const person = await staffMember('Meera');
    expect((await give(person.id, 'FLOOR_MANAGER', layout.floorA)).status).toBe(201);
    const manager = as(await signIn(person.email));

    const beds = z
      .object({ beds: z.array(z.object({ id: uuid })) })
      .parse((await manager.get('/admin/beds')).body)
      .beds.map((bed) => bed.id);
    expect(beds).toEqual([layout.bedA]);
    const floors = z
      .object({ floors: z.array(z.object({ id: uuid })) })
      .parse((await manager.get('/admin/floors')).body)
      .floors.map((floor) => floor.id);
    expect(floors).toEqual([layout.floorA]);
    expect((await manager.get(`/admin/beds/${layout.bedB}`)).status).toBe(404);
    expect((await manager.get('/admin/staff')).status).toBe(403);
    expect((await manager.post('/admin/floors', { code: 'NEW', name: 'New' })).status).toBe(403);

    const admitted = await manager.post('/admin/bed-sessions', { bedId: layout.bedA });
    expect(admitted.status, JSON.stringify(admitted.body)).toBe(201);
    expect((await manager.post('/admin/bed-sessions', { bedId: layout.bedB })).status).toBe(404);
    const sessionId = z.object({ bedSession: z.object({ id: uuid }) }).parse(admitted.body)
      .bedSession.id;
    const sessions = z
      .object({ bedSessions: z.array(z.object({ bedId: uuid })) })
      .parse((await manager.get('/admin/bed-sessions?status=ACTIVE')).body);
    expect(sessions.bedSessions.every((session) => session.bedId === layout.bedA)).toBe(true);
    expect((await manager.post(`/admin/bed-sessions/${sessionId}/close`)).status).toBe(200);
  });

  it('shows a ward manager only their ward', async () => {
    const person = await staffMember('Neha');
    expect((await give(person.id, 'WARD_MANAGER', layout.wardB)).status).toBe(201);
    const manager = as(await signIn(person.email));
    const wards = z
      .object({ wards: z.array(z.object({ id: uuid })) })
      .parse((await manager.get('/admin/wards')).body)
      .wards.map((ward) => ward.id);
    expect(wards).toEqual([layout.wardB]);
    expect((await manager.post('/admin/bed-sessions', { bedId: layout.bedA })).status).toBe(404);
  });

  it("lets a department supervisor handle only their department's requests", async () => {
    const supervisor = await staffMember('Sana');
    expect((await give(supervisor.id, 'DEPARTMENT_SUPERVISOR', departmentIds.PANTRY)).status).toBe(
      201,
    );
    const pantryWorker = await staffMember('Pavan');
    await as(hospital.adminToken).post(`/admin/staff/${pantryWorker.id}/departments`, {
      departmentId: departmentIds.PANTRY,
    });
    await as(hospital.adminToken).post(`/admin/staff/${pantryWorker.id}/coverage`, {
      scopeType: 'HOSPITAL',
    });
    await as(hospital.adminToken).post(`/admin/staff/${pantryWorker.id}/duty`, {
      dutyStatus: 'ON_DUTY',
    });

    const water = await patientRequest(layout.bedB, 'Drinking Water');
    const nurse = await patientRequest(layout.bedB, 'Nurse Assistance');
    const lead = as(await signIn(supervisor.email));
    const visible = z
      .object({ serviceRequests: z.array(z.object({ id: uuid })) })
      .parse((await lead.get('/admin/requests')).body)
      .serviceRequests.map((item) => item.id);
    expect(visible).toContain(water.id);
    expect(visible).not.toContain(nurse.id);

    const eligible = await lead.get(
      `/admin/staff/eligible?bedId=${layout.bedB}&departmentId=${departmentIds.PANTRY}`,
    );
    expect(eligible.status).toBe(200);
    expect(
      (
        await lead.get(
          `/admin/staff/eligible?bedId=${layout.bedB}&departmentId=${departmentIds.NURSING}`,
        )
      ).status,
    ).toBe(404);
    const assigned = await lead.post(`/admin/requests/${water.id}/assign`, {
      expectedVersion: water.version,
      assigneeId: pantryWorker.id,
    });
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(200);
    expect(
      (
        await lead.post(`/admin/requests/${nurse.id}/assign`, {
          expectedVersion: nurse.version,
          assigneeId: pantryWorker.id,
        })
      ).status,
    ).toBe(404);
  });

  it('never leaves a hospital without an active Hospital Manager', async () => {
    const second = await staffMember('Second');
    expect((await give(second.id, 'HOSPITAL_MANAGER')).status).toBe(201);
    const secondToken = await signIn(second.email);
    const firstId = z
      .object({ membershipId: uuid })
      .parse((await as(hospital.adminToken).get('/auth/staff/me')).body).membershipId;

    // The second manager deactivates the first: one manager remains.
    expect(
      (await as(secondToken).post(`/admin/staff/${firstId}/status`, { status: 'INACTIVE' })).status,
    ).toBe(200);

    // Someone with full permissions but not the manager role cannot remove the last one.
    const deputyRole = await as(secondToken).post('/admin/roles', {
      name: `Deputy ${randomUUID().slice(0, 4)}`,
      permissionKeys: (await database.permission.findMany()).map((item) => item.key),
    });
    // The first manager is inactive now, so the second one creates the deputy.
    const email = `deputy-${randomUUID().slice(0, 6)}@example.test`;
    const created = await as(secondToken).post('/admin/staff', {
      email,
      displayName: 'Deputy',
      password: fixturePassword,
    });
    const deputyId = z.object({ staff: z.object({ id: uuid }) }).parse(created.body).staff.id;
    await as(secondToken).post(`/admin/memberships/${deputyId}/roles`, {
      roleId: z.object({ role: z.object({ id: uuid }) }).parse(deputyRole.body).role.id,
    });
    const deputyToken = await signIn(email);
    expect(
      (
        await as(deputyToken).delete(
          `/admin/memberships/${second.id}/roles/${roleIds.HOSPITAL_MANAGER}`,
        )
      ).status,
    ).toBe(409);
    expect(
      (await as(deputyToken).post(`/admin/staff/${second.id}/status`, { status: 'INACTIVE' }))
        .status,
    ).toBe(409);
  });
});
