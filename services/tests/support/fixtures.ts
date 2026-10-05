import { randomUUID } from 'node:crypto';
import { type PrismaClient } from '@prisma/client';
import { type Express } from 'express';
import request from 'supertest';
import { z } from 'zod';
import { hashPassword } from '../../src/modules/auth/password.js';
import { bootstrapHospital } from '../../src/modules/hospitals/bootstrap.js';

const fixturePassword = 'FixturePassword123!';
const loginSchema = z.object({ token: z.string().min(40) });

export interface HospitalFixture {
  readonly hospitalId: string;
  readonly code: string;
  readonly adminToken: string;
}

export function requireTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error('TEST_DATABASE_URL is required for database integration tests.');
  }
  return url;
}

async function login(application: Express, hospitalCode: string, email: string): Promise<string> {
  const response = await request(application)
    .post('/auth/staff/login')
    .send({ hospitalCode, email, password: fixturePassword });
  if (response.status !== 200) {
    throw new Error(`Fixture login failed with status ${response.status}.`);
  }
  return loginSchema.parse(response.body).token;
}

export async function createHospitalFixture(
  database: PrismaClient,
  application: Express,
  label: string,
): Promise<HospitalFixture> {
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const code = `${label}-${suffix}`;
  const email = `admin-${code}@example.test`.toLowerCase();
  const { hospitalId } = await bootstrapHospital(database, {
    name: `${label} Hospital`,
    code,
    timezone: 'Asia/Kolkata',
    adminEmail: email,
    adminName: `${label} Admin`,
    adminPassword: fixturePassword,
  });
  return { hospitalId, code, adminToken: await login(application, code, email) };
}

// Creates an active staff member holding a hospital-scoped role with exactly these permissions.
export async function createStaffToken(
  database: PrismaClient,
  application: Express,
  hospital: HospitalFixture,
  permissionKeys: readonly string[],
): Promise<string> {
  const { hospitalId } = hospital;
  const suffix = randomUUID().slice(0, 8);
  const user = await database.user.create({
    data: {
      email: `staff-${suffix}@example.test`,
      displayName: 'Fixture Staff',
      passwordHash: await hashPassword(fixturePassword),
    },
  });
  const membership = await database.hospitalMembership.create({
    data: { hospitalId, userId: user.id },
  });
  const role = await database.role.create({ data: { hospitalId, name: `Fixture ${suffix}` } });
  await database.rolePermission.createMany({
    data: permissionKeys.map((permissionKey) => ({ hospitalId, roleId: role.id, permissionKey })),
  });
  const userRole = await database.userRole.create({
    data: { hospitalId, membershipId: membership.id, roleId: role.id },
  });
  await database.scopeAssignment.create({
    data: { hospitalId, userRoleId: userRole.id, scopeType: 'HOSPITAL', scopeId: hospitalId },
  });
  return login(application, hospital.code, user.email);
}

// Creates Floor -> Ward -> Bed directly in the database (no audit entries).
export async function createBedFixture(
  database: PrismaClient,
  hospital: HospitalFixture,
  bedCode = '101',
): Promise<{ bedId: string; wardId: string }> {
  const { hospitalId } = hospital;
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const floor = await database.floor.create({
    data: { hospitalId, code: `F-${suffix}`, name: `Floor ${suffix}` },
  });
  const ward = await database.ward.create({
    data: { hospitalId, floorId: floor.id, code: 'GEN', name: 'General Ward' },
  });
  const bed = await database.bed.create({
    data: { hospitalId, wardId: ward.id, code: bedCode, displayName: `Bed ${bedCode}` },
  });
  return { bedId: bed.id, wardId: ward.id };
}
