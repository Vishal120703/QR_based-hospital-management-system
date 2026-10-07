import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { z } from 'zod';
import { createApp } from '../../src/app.js';
import { createLogger } from '../../src/config/logger.js';
import { createPrismaClient } from '../../src/database/prisma.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import { bootstrapHospital } from '../../src/modules/hospitals/index.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error('TEST_DATABASE_URL is required for tenant integration tests.');
}

const database = createPrismaClient(databaseUrl);
const application = createApp({ logger: createLogger('silent'), database });
const unique = randomUUID().slice(0, 8).toUpperCase();
const adminPassword = 'AdminPassword123!';

const hospitals = {
  a: { code: `TENANT-A-${unique}`, email: `admin-a-${unique}@example.test`, name: 'Hospital A' },
  b: { code: `TENANT-B-${unique}`, email: `admin-b-${unique}@example.test`, name: 'Hospital B' },
};

const loginResponseSchema = z.object({ token: z.string().min(40) });
const roleResponseSchema = z.object({
  role: z.object({ id: z.string().uuid(), name: z.string() }),
});

let hospitalAId: string;
let hospitalBId: string;
let hospitalBAdminMembershipId: string;
let limitedMembershipId: string;
let tokenA: string;
let tokenB: string;
let limitedToken: string;

async function login(
  hospitalCode: string,
  email: string,
  password = adminPassword,
): Promise<string> {
  const response = await request(application).post('/auth/staff/login').send({
    hospitalCode,
    email,
    password,
  });
  expect(response.status).toBe(200);
  return loginResponseSchema.parse(response.body).token;
}

beforeAll(async () => {
  const hospitalA = await bootstrapHospital(database, {
    name: hospitals.a.name,
    code: hospitals.a.code,
    timezone: 'Asia/Kolkata',
    adminEmail: hospitals.a.email,
    adminName: 'Admin A',
    adminPassword,
  });
  const hospitalB = await bootstrapHospital(database, {
    name: hospitals.b.name,
    code: hospitals.b.code,
    timezone: 'Asia/Kolkata',
    adminEmail: hospitals.b.email,
    adminName: 'Admin B',
    adminPassword,
  });
  hospitalAId = hospitalA.hospitalId;
  hospitalBId = hospitalB.hospitalId;
  tokenA = await login(hospitals.a.code, hospitals.a.email);
  tokenB = await login(hospitals.b.code, hospitals.b.email);

  const membershipB = await database.hospitalMembership.findUniqueOrThrow({
    where: { hospitalId_userId: { hospitalId: hospitalBId, userId: hospitalB.adminUserId } },
  });
  hospitalBAdminMembershipId = membershipB.id;

  const user = await database.user.create({
    data: {
      email: `limited-${unique.toLowerCase()}@example.test`,
      displayName: 'Limited Staff',
      passwordHash: await hashPassword('LimitedPassword123!'),
    },
  });
  const membership = await database.hospitalMembership.create({
    data: { hospitalId: hospitalAId, userId: user.id },
  });
  limitedMembershipId = membership.id;
  const role = await database.role.create({
    data: { hospitalId: hospitalAId, name: `Reader ${unique}` },
  });
  await database.rolePermission.create({
    data: { hospitalId: hospitalAId, roleId: role.id, permissionKey: 'hospital.read' },
  });
  const userRole = await database.userRole.create({
    data: { hospitalId: hospitalAId, membershipId: membership.id, roleId: role.id },
  });
  await database.scopeAssignment.create({
    data: {
      hospitalId: hospitalAId,
      userRoleId: userRole.id,
      scopeType: 'HOSPITAL',
      scopeId: hospitalAId,
    },
  });
  limitedToken = await login(hospitals.a.code, user.email, 'LimitedPassword123!');
});

afterAll(async () => {
  await database.$disconnect();
});

describe('Phase 2 staff authentication and tenant isolation', () => {
  it('requires a valid token and a persisted permission', async () => {
    const noToken = await request(application).get('/admin/roles');
    const invalidToken = await request(application)
      .get('/admin/roles')
      .set('authorization', `Bearer ${'x'.repeat(43)}`);
    const wrongPermission = await request(application)
      .post('/admin/roles')
      .set('authorization', `Bearer ${limitedToken}`)
      .send({ name: 'Unauthorized Role' });
    const allowed = await request(application)
      .get('/admin/hospital')
      .set('authorization', `Bearer ${limitedToken}`);

    expect(noToken.status).toBe(401);
    expect(invalidToken.status).toBe(401);
    expect(wrongPermission.status).toBe(403);
    expect(allowed.status).toBe(200);
  });

  it('returns 404 for unknown public routes and 401 for unauthenticated admin routes', async () => {
    const unknownPublic = await request(application).get('/does-not-exist');
    const unknownAdmin = await request(application).get('/admin/does-not-exist');
    const unknownAdminAuthenticated = await request(application)
      .get('/admin/does-not-exist')
      .set('authorization', `Bearer ${tokenA}`);

    expect(unknownPublic.status).toBe(404);
    expect(unknownAdmin.status).toBe(401);
    expect(unknownAdminAuthenticated.status).toBe(404);
  });

  it('isolates role CREATE, READ, UPDATE, and DELETE', async () => {
    const createA = await request(application)
      .post('/admin/roles')
      .set('authorization', `Bearer ${tokenA}`)
      .send({ name: `Care Manager ${unique}`, permissionKeys: ['hospital.read'] });
    expect(createA.status).toBe(201);
    const roleId = roleResponseSchema.parse(createA.body).role.id;

    const bList = await request(application)
      .get('/admin/roles')
      .set('authorization', `Bearer ${tokenB}`);
    expect(bList.status).toBe(200);
    expect(JSON.stringify(bList.body)).not.toContain(roleId);

    const bRead = await request(application)
      .get(`/admin/roles/${roleId}`)
      .set('authorization', `Bearer ${tokenB}`);
    const bUpdate = await request(application)
      .patch(`/admin/roles/${roleId}`)
      .set('authorization', `Bearer ${tokenB}`)
      .send({ name: 'Stolen' });
    const bDelete = await request(application)
      .delete(`/admin/roles/${roleId}`)
      .set('authorization', `Bearer ${tokenB}`);
    expect([bRead.status, bUpdate.status, bDelete.status]).toEqual([404, 404, 404]);

    const forgedCreate = await request(application)
      .post('/admin/roles')
      .set('authorization', `Bearer ${tokenB}`)
      .send({ hospitalId: hospitalAId, name: 'Forged Role' });
    expect(forgedCreate.status).toBe(400);

    const bCreate = await request(application)
      .post('/admin/roles')
      .set('authorization', `Bearer ${tokenB}`)
      .send({ name: `Care Manager ${unique}` });
    expect(bCreate.status).toBe(201);
    const bRoleId = roleResponseSchema.parse(bCreate.body).role.id;
    const storedB = await database.role.findFirstOrThrow({
      where: { hospitalId: hospitalBId, id: bRoleId },
    });
    expect(storedB.hospitalId).toBe(hospitalBId);

    const aUpdate = await request(application)
      .patch(`/admin/roles/${roleId}`)
      .set('authorization', `Bearer ${tokenA}`)
      .send({ name: `Care Supervisor ${unique}` });
    expect(aUpdate.status).toBe(200);
    const aDelete = await request(application)
      .delete(`/admin/roles/${roleId}`)
      .set('authorization', `Bearer ${tokenA}`);
    expect(aDelete.status).toBe(204);
    expect(
      await database.role.findFirst({ where: { hospitalId: hospitalAId, id: roleId } }),
    ).toBeNull();

    const auditActions = await database.auditLog.findMany({
      where: { hospitalId: hospitalAId, targetType: 'Role', targetId: roleId },
      orderBy: { createdAt: 'asc' },
    });
    expect(auditActions.map((event) => event.action)).toEqual([
      'role.create',
      'role.update',
      'role.delete',
    ]);
  });

  it('rejects a role assignment across hospitals at both API and database boundaries', async () => {
    const createA = await request(application)
      .post('/admin/roles')
      .set('authorization', `Bearer ${tokenA}`)
      .send({ name: `Isolation Test ${unique}` });
    const roleId = roleResponseSchema.parse(createA.body).role.id;

    const apiAttempt = await request(application)
      .post(`/admin/memberships/${hospitalBAdminMembershipId}/roles`)
      .set('authorization', `Bearer ${tokenB}`)
      .send({ roleId });
    expect(apiAttempt.status).toBe(404);

    await expect(
      database.userRole.create({
        data: {
          hospitalId: hospitalBId,
          membershipId: hospitalBAdminMembershipId,
          roleId,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });

    await expect(
      database.rolePermission.create({
        data: { hospitalId: hospitalBId, roleId, permissionKey: 'hospital.read' },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });

    const hospitalAAdminRole = await database.userRole.findFirstOrThrow({
      where: { hospitalId: hospitalAId, role: { systemKey: 'HOSPITAL_MANAGER' } },
    });
    await expect(
      database.scopeAssignment.create({
        data: {
          hospitalId: hospitalBId,
          userRoleId: hospitalAAdminRole.id,
          scopeType: 'HOSPITAL',
          scopeId: hospitalBId,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('derives hospital updates from the active session and audits them', async () => {
    const update = await request(application)
      .patch('/admin/hospital')
      .set('authorization', `Bearer ${tokenA}`)
      .send({ name: `Updated Hospital A ${unique}`, hospitalId: hospitalBId });
    expect(update.status).toBe(400);

    const valid = await request(application)
      .patch('/admin/hospital')
      .set('authorization', `Bearer ${tokenA}`)
      .send({ name: `Updated Hospital A ${unique}` });
    expect(valid.status).toBe(200);
    const bHospital = await database.hospital.findFirstOrThrow({ where: { id: hospitalBId } });
    expect(bHospital.name).toBe(hospitals.b.name);
    expect(
      await database.auditLog.count({
        where: { hospitalId: hospitalAId, action: 'hospital.update' },
      }),
    ).toBe(1);
  });

  it('does not let staff management permission grant privileged roles', async () => {
    const coordinator = await request(application)
      .post('/admin/roles')
      .set('authorization', `Bearer ${tokenA}`)
      .send({ name: `Coordinator ${unique}`, permissionKeys: ['staff.manage'] });
    expect(coordinator.status).toBe(201);
    const coordinatorId = roleResponseSchema.parse(coordinator.body).role.id;
    const assigned = await request(application)
      .post(`/admin/memberships/${limitedMembershipId}/roles`)
      .set('authorization', `Bearer ${tokenA}`)
      .send({ roleId: coordinatorId });
    expect(assigned.status).toBe(201);

    const adminRole = await database.role.findFirstOrThrow({
      where: { hospitalId: hospitalAId, systemKey: 'HOSPITAL_MANAGER' },
    });
    const escalation = await request(application)
      .post(`/admin/memberships/${limitedMembershipId}/roles`)
      .set('authorization', `Bearer ${limitedToken}`)
      .send({ roleId: adminRole.id });
    expect(escalation.status).toBe(403);
  });

  it('rejects sessions for a suspended hospital', async () => {
    await database.hospital.update({
      where: { id: hospitalBId },
      data: { status: 'SUSPENDED' },
    });
    try {
      const response = await request(application)
        .get('/auth/staff/me')
        .set('authorization', `Bearer ${tokenB}`);
      expect(response.status).toBe(401);
    } finally {
      await database.hospital.update({
        where: { id: hospitalBId },
        data: { status: 'ACTIVE' },
      });
    }
  });

  it('revokes a staff session on logout', async () => {
    const token = await login(hospitals.a.code, hospitals.a.email);
    const logout = await request(application)
      .post('/auth/staff/logout')
      .set('authorization', `Bearer ${token}`);
    const afterLogout = await request(application)
      .get('/auth/staff/me')
      .set('authorization', `Bearer ${token}`);
    expect(logout.status).toBe(204);
    expect(afterLogout.status).toBe(401);
  });
});
