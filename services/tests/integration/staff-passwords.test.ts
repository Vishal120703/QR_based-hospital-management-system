import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { z } from 'zod';
import { createApp } from '../../src/app.js';
import { createLogger } from '../../src/config/logger.js';
import { createPrismaClient } from '../../src/database/prisma.js';
import {
  createHospitalFixture,
  createStaffToken,
  fixturePassword,
  requireTestDatabaseUrl,
  type HospitalFixture,
} from '../support/fixtures.js';

// Staff choose their own passwords; a staff manager can reset a forgotten
// one, after which the person must choose a new one before anything else.

const database = createPrismaClient(requireTestDatabaseUrl());
const application = createApp({
  logger: createLogger('silent'),
  database,
  staffLoginRateLimits: {
    perAccount: { windowMs: 60_000, max: 1_000 },
    perAddress: { windowMs: 60_000, max: 1_000 },
    passwordChange: { windowMs: 60_000, max: 5 },
  },
});

let hospital: HospitalFixture;
let careStaffRole: string;

function as(token: string) {
  const bearer = `Bearer ${token}`;
  return {
    get: (path: string) => request(application).get(path).set('authorization', bearer),
    post: (path: string, body: object = {}) =>
      request(application).post(path).set('authorization', bearer).send(body),
  };
}
const signIn = (email: string, password: string, code = hospital.code) =>
  request(application).post('/auth/staff/login').send({ hospitalCode: code, email, password });
const tokenOf = (body: unknown) => z.object({ token: z.string() }).parse(body).token;
const errorOf = (body: unknown) =>
  z.object({ error: z.object({ code: z.string(), message: z.string() }) }).parse(body).error;

// A care-staff member with their own password.
async function careStaff(name: string) {
  const email = `${name.toLowerCase()}-${randomUUID().slice(0, 6)}@example.test`;
  const created = await as(hospital.adminToken).post('/admin/staff', {
    email,
    displayName: name,
    password: fixturePassword,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const id = z.object({ staff: z.object({ id: z.string() }) }).parse(created.body).staff.id;
  const role = await as(hospital.adminToken).post(`/admin/memberships/${id}/roles`, {
    roleId: careStaffRole,
  });
  expect(role.status, JSON.stringify(role.body)).toBe(201);
  return { id, email };
}

async function auditFor(action: string, targetId: string) {
  return database.auditLog.findMany({
    where: { hospitalId: hospital.hospitalId, action, targetId },
  });
}

beforeAll(async () => {
  hospital = await createHospitalFixture(database, application, 'PASSWORD');
  careStaffRole = (
    await database.role.findFirstOrThrow({
      where: { hospitalId: hospital.hospitalId, systemKey: 'CARE_STAFF' },
    })
  ).id;
});

afterAll(async () => {
  await database.$disconnect();
});

describe('Changing your own password', () => {
  it('needs the current password, keeps this session, and ends the others', async () => {
    const nurse = await careStaff('Nisha');
    const here = tokenOf((await signIn(nurse.email, fixturePassword)).body);
    const phone = tokenOf((await signIn(nurse.email, fixturePassword)).body);
    const newPassword = 'A brand new passphrase 42';

    const wrong = await as(here).post('/auth/staff/password', {
      currentPassword: 'not my password',
      newPassword,
    });
    expect(wrong.status).toBe(400);
    expect(errorOf(wrong.body).message).toBe('Your current password is not right.');
    // A wrong current password does not sign the person out.
    expect((await as(here).get('/auth/staff/me')).status).toBe(200);

    const same = await as(here).post('/auth/staff/password', {
      currentPassword: fixturePassword,
      newPassword: fixturePassword,
    });
    expect(same.status).toBe(400);
    const short = await as(here).post('/auth/staff/password', {
      currentPassword: fixturePassword,
      newPassword: 'short',
    });
    expect(short.status).toBe(400);

    const changed = await as(here).post('/auth/staff/password', {
      currentPassword: fixturePassword,
      newPassword,
    });
    expect(changed.status, JSON.stringify(changed.body)).toBe(204);
    expect((await as(here).get('/auth/staff/me')).status).toBe(200);
    expect((await as(phone).get('/auth/staff/me')).status).toBe(401);
    expect((await signIn(nurse.email, fixturePassword)).status).toBe(401);
    expect((await signIn(nurse.email, newPassword)).status).toBe(200);

    const entries = await auditFor('staff.password.change', nurse.id);
    expect(entries).toHaveLength(1);
    const recorded = JSON.stringify(entries);
    expect(recorded).not.toContain(newPassword);
    expect(recorded).not.toContain(fixturePassword);
  });

  it('limits guesses of the current password', async () => {
    const nurse = await careStaff('Guesser');
    const token = tokenOf((await signIn(nurse.email, fixturePassword)).body);
    const guess = () =>
      as(token).post('/auth/staff/password', {
        currentPassword: 'guess',
        newPassword: 'Another long passphrase',
      });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await guess()).status).toBe(400);
    }
    expect((await guess()).status).toBe(429);
  });
});

describe('Resetting a forgotten password', () => {
  it('ends the person’s sessions and makes them choose a new password first', async () => {
    const nurse = await careStaff('Ravi');
    const old = tokenOf((await signIn(nurse.email, fixturePassword)).body);
    const temporary = 'Temporary passphrase 2026';

    const reset = await as(hospital.adminToken).post(`/admin/staff/${nurse.id}/password`, {
      temporaryPassword: temporary,
    });
    expect(reset.status, JSON.stringify(reset.body)).toBe(200);
    expect(JSON.stringify(reset.body)).not.toContain(temporary);
    expect((await as(old).get('/auth/staff/me')).status).toBe(401);
    expect((await signIn(nurse.email, fixturePassword)).status).toBe(401);

    const signedIn = await signIn(nurse.email, temporary);
    expect(signedIn.status).toBe(200);
    const token = tokenOf(signedIn.body);
    const me = await as(token).get('/auth/staff/me');
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ mustChangePassword: true });
    const blocked = await as(token).get('/admin/requests');
    expect(blocked.status).toBe(403);
    expect(errorOf(blocked.body).code).toBe('PASSWORD_CHANGE_REQUIRED');

    const chosen = await as(token).post('/auth/staff/password', {
      currentPassword: temporary,
      newPassword: 'My own passphrase 7781',
    });
    expect(chosen.status, JSON.stringify(chosen.body)).toBe(204);
    expect((await as(token).get('/auth/staff/me')).body).toMatchObject({
      mustChangePassword: false,
    });
    expect((await as(token).get('/admin/requests')).status).toBe(200);

    const entries = await auditFor('staff.password.reset', nurse.id);
    expect(entries).toHaveLength(1);
    expect(JSON.stringify(entries)).not.toContain(temporary);
  });

  it('refuses resets that are not this manager’s to make', async () => {
    const nurse = await careStaff('Meena');
    const body = { temporaryPassword: 'Temporary passphrase 99' };

    // Without staff.manage.
    const viewer = await createStaffToken(database, application, hospital, ['staff.read']);
    expect((await as(viewer).post(`/admin/staff/${nurse.id}/password`, body)).status).toBe(403);

    // Another hospital cannot reach this hospital's staff.
    const other = await createHospitalFixture(database, application, 'PASSWORD-OTHER');
    expect(
      (await as(other.adminToken).post(`/admin/staff/${nurse.id}/password`, body)).status,
    ).toBe(404);

    // Not one's own password (use Change password), nor anyone with more powers.
    const admin = await database.hospitalMembership.findFirstOrThrow({
      where: { hospitalId: hospital.hospitalId, user: { email: { startsWith: 'admin-' } } },
    });
    expect(
      (await as(hospital.adminToken).post(`/admin/staff/${admin.id}/password`, body)).status,
    ).toBe(409);
    const staffManager = await createStaffToken(database, application, hospital, [
      'staff.read',
      'staff.manage',
    ]);
    expect((await as(staffManager).post(`/admin/staff/${admin.id}/password`, body)).status).toBe(
      403,
    );

    // An account that also signs in at another hospital is not this one's to reset.
    const user = await database.hospitalMembership.findUniqueOrThrow({
      where: { id: nurse.id },
      select: { userId: true },
    });
    await database.hospitalMembership.create({
      data: { hospitalId: other.hospitalId, userId: user.userId },
    });
    const shared = await as(hospital.adminToken).post(`/admin/staff/${nurse.id}/password`, body);
    expect(shared.status).toBe(409);
    expect((await signIn(nurse.email, fixturePassword)).status).toBe(200);

    for (const invalid of [{}, { temporaryPassword: 'short' }, { ...body, extra: true }]) {
      expect(
        (await as(hospital.adminToken).post(`/admin/staff/${nurse.id}/password`, invalid)).status,
      ).toBe(400);
    }
  });
});
