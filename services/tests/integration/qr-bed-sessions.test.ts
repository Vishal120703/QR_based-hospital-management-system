import { randomBytes } from 'node:crypto';
import { type Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { z } from 'zod';
import { createApp } from '../../src/app.js';
import { hashOpaqueToken } from '../../src/common/opaque-token.js';
import { createLogger } from '../../src/config/logger.js';
import { createPrismaClient } from '../../src/database/prisma.js';
import {
  createBedFixture,
  createHospitalFixture,
  createStaffToken,
  requireTestDatabaseUrl,
  type HospitalFixture,
} from '../support/fixtures.js';

const database = createPrismaClient(requireTestDatabaseUrl());
const publicAppUrl = 'https://care.example.test';
const application = createApp({
  logger: createLogger('silent'),
  database,
  publicAppUrl,
  guestSessionTtlMinutes: 120,
  qrResolveRateLimit: { windowMs: 60_000, max: 100_000 },
});

const uuid = z.string().uuid();
const issueSchema = z.object({
  qrCode: z
    .object({ id: uuid, bedId: uuid, status: z.string(), version: z.number() })
    .passthrough(),
  token: z.string(),
  url: z.string(),
});
const qrViewSchema = z.object({ qrCode: issueSchema.shape.qrCode });
const locationSchema = z.object({
  hospitalName: z.string(),
  bed: z.object({ code: z.string(), displayName: z.string() }),
  room: z.string().nullable(),
  ward: z.string(),
  floor: z.string(),
  expiresAt: z.string(),
});
const resolveSchema = z.object({
  guestToken: z.string(),
  expiresAt: z.string(),
  location: locationSchema,
});
const bedSessionSchema = z.object({
  bedSession: z.object({ id: uuid, bedId: uuid, status: z.string() }).passthrough(),
});
const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

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

function resolve(token: string, app: Express = application) {
  return request(app).post('/public/qr/resolve').send({ token });
}

function guestSession(guestToken: string) {
  return request(application).get('/public/session').set('authorization', `Bearer ${guestToken}`);
}

async function issueQr(hospital: HospitalFixture, bedId: string) {
  const response = await as(hospital.adminToken).post(`/admin/beds/${bedId}/qr`);
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return issueSchema.parse(response.body);
}

async function startSession(hospital: HospitalFixture, bedId: string) {
  const response = await as(hospital.adminToken).post('/admin/bed-sessions', { bedId });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return bedSessionSchema.parse(response.body).bedSession;
}

async function openGuest(qrToken: string): Promise<string> {
  const response = await resolve(qrToken);
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return resolveSchema.parse(response.body).guestToken;
}

// A bed with an active QR code, an active bed session, and an open guest session.
async function occupiedBed(hospital: HospitalFixture, bedCode = '101') {
  const { bedId, wardId } = await createBedFixture(database, hospital, bedCode);
  const qr = await issueQr(hospital, bedId);
  const session = await startSession(hospital, bedId);
  const guestToken = await openGuest(qr.token);
  return { bedId, wardId, qr, session, guestToken };
}

function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

beforeAll(async () => {
  hospitalA = await createHospitalFixture(database, application, 'QR-A');
  hospitalB = await createHospitalFixture(database, application, 'QR-B');
});

afterAll(async () => {
  await database.$disconnect();
});

describe('Phase 4 secure QR codes', () => {
  it('issues a QR code once and stores only the SHA-256 hash', async () => {
    const { bedId } = await createBedFixture(database, hospitalA);
    const response = await as(hospitalA.adminToken).post(`/admin/beds/${bedId}/qr`);

    expect(response.status).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    const issue = issueSchema.parse(response.body);
    expect(issue.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(issue.url).toBe(`${publicAppUrl}/q/${issue.token}`);
    expect(issue.qrCode).toMatchObject({ bedId, status: 'ACTIVE', version: 1 });
    expect(Object.keys(issue.qrCode)).not.toContain('tokenHash');

    const stored = await database.bedQrCode.findUniqueOrThrow({ where: { id: issue.qrCode.id } });
    expect(stored.tokenHash).toBe(hashOpaqueToken(issue.token));
    expect(JSON.stringify(stored)).not.toContain(issue.token);

    const listed = await as(hospitalA.adminToken).get(`/admin/qr-codes?bedId=${bedId}`);
    expect(listed.status).toBe(200);
    expect(JSON.stringify(listed.body)).not.toContain(issue.token);
    expect(JSON.stringify(listed.body)).not.toContain(stored.tokenHash);

    const again = await as(hospitalA.adminToken).post(`/admin/beds/${bedId}/qr`);
    expect(again.status).toBe(409);
  });

  it('rejects random, revoked, and rotated tokens with one generic response', async () => {
    const bed = await occupiedBed(hospitalA);

    const unknown = await resolve(randomToken());
    expect(unknown.status).toBe(404);
    const generic = errorSchema.parse(unknown.body).error;
    expect(generic.code).toBe('QR_UNAVAILABLE');

    const rotated = await as(hospitalA.adminToken).post(`/admin/beds/${bed.bedId}/qr/rotate`);
    expect(rotated.status).toBe(200);
    expect(rotated.headers['cache-control']).toBe('no-store');
    const rotation = issueSchema.parse(rotated.body);
    expect(rotation.qrCode.version).toBe(2);

    const oldToken = await resolve(bed.qr.token);
    expect(oldToken.status).toBe(404);
    expect(errorSchema.parse(oldToken.body).error).toEqual(generic);
    expect((await guestSession(bed.guestToken)).status).toBe(401);

    const newGuest = await openGuest(rotation.token);
    expect((await guestSession(newGuest)).status).toBe(200);

    const revoked = await as(hospitalA.adminToken).post(`/admin/beds/${bed.bedId}/qr/revoke`);
    expect(revoked.status).toBe(200);
    expect(qrViewSchema.parse(revoked.body).qrCode.status).toBe('REVOKED');
    const revokedToken = await resolve(rotation.token);
    expect(revokedToken.status).toBe(404);
    expect(errorSchema.parse(revokedToken.body).error).toEqual(generic);
    expect((await guestSession(newGuest)).status).toBe(401);

    const reissued = await issueQr(hospitalA, bed.bedId);
    expect(reissued.qrCode).toMatchObject({ status: 'ACTIVE', version: 3 });
    expect((await resolve(reissued.token)).status).toBe(201);

    expect((await resolve('x'.repeat(257))).status).toBe(400);
    expect((await request(application).post('/public/qr/resolve').send({})).status).toBe(400);
  });

  it('denies resolution for an inactive bed or a suspended hospital', async () => {
    const { bedId } = await createBedFixture(database, hospitalA);
    const qr = await issueQr(hospitalA, bedId);
    const deactivate = await as(hospitalA.adminToken).patch(`/admin/beds/${bedId}`, {
      active: false,
    });
    expect(deactivate.status).toBe(200);
    expect((await resolve(qr.token)).status).toBe(404);

    const suspended = await createHospitalFixture(database, application, 'QR-S');
    const bed = await occupiedBed(suspended);
    await database.hospital.update({
      where: { id: suspended.hospitalId },
      data: { status: 'SUSPENDED' },
    });
    expect((await resolve(bed.qr.token)).status).toBe(404);
    expect((await guestSession(bed.guestToken)).status).toBe(401);
  });

  it('rate-limits QR resolution with a generic error', async () => {
    const limited = createApp({
      logger: createLogger('silent'),
      database,
      qrResolveRateLimit: { windowMs: 60_000, max: 3 },
    });
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      statuses.push((await resolve(randomToken(), limited)).status);
    }
    expect(statuses).toEqual([404, 404, 404, 429, 429]);

    const blocked = await resolve(randomToken(), limited);
    expect(errorSchema.parse(blocked.body).error.code).toBe('RATE_LIMITED');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });
});

describe('Phase 4 bed sessions and guest sessions', () => {
  it('resolves a QR only while the bed has an active session', async () => {
    const { bedId } = await createBedFixture(database, hospitalA, '204');
    const qr = await issueQr(hospitalA, bedId);
    expect((await resolve(qr.token)).status).toBe(404);

    const session = await startSession(hospitalA, bedId);
    expect(session.status).toBe('ACTIVE');
    expect((await database.bed.findUniqueOrThrow({ where: { id: bedId } })).status).toBe(
      'OCCUPIED',
    );

    const resolved = await resolve(qr.token);
    expect(resolved.status).toBe(201);
    expect(resolved.headers['cache-control']).toBe('no-store');
    const body = resolveSchema.parse(resolved.body);
    expect(body.location).toMatchObject({
      bed: { code: '204', displayName: 'Bed 204' },
      ward: 'General Ward',
    });

    const close = await as(hospitalA.adminToken).post(`/admin/bed-sessions/${session.id}/close`);
    expect(close.status).toBe(200);
    expect(bedSessionSchema.parse(close.body).bedSession.status).toBe('CLOSED');
    expect((await database.bed.findUniqueOrThrow({ where: { id: bedId } })).status).toBe(
      'AVAILABLE',
    );
    expect((await guestSession(body.guestToken)).status).toBe(401);
    expect((await resolve(qr.token)).status).toBe(404);

    const closeAgain = await as(hospitalA.adminToken).post(
      `/admin/bed-sessions/${session.id}/close`,
    );
    expect(closeAgain.status).toBe(409);

    // A new admission gets a new session; the previous guest stays locked out.
    await startSession(hospitalA, bedId);
    expect((await resolve(qr.token)).status).toBe(201);
    expect((await guestSession(body.guestToken)).status).toBe(401);
  });

  it('expires guest sessions', async () => {
    const bed = await occupiedBed(hospitalA);
    const stored = await database.guestSession.findUniqueOrThrow({
      where: { tokenHash: hashOpaqueToken(bed.guestToken) },
    });
    const ttlMs = stored.expiresAt.getTime() - stored.createdAt.getTime();
    expect(Math.round(ttlMs / 60_000)).toBe(120);
    expect(stored.tokenHash).not.toBe(bed.guestToken);

    await database.guestSession.update({
      where: { id: stored.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await guestSession(bed.guestToken)).status).toBe(401);
  });

  it('binds a guest session to its own bed and rejects client-supplied identifiers', async () => {
    const bed101 = await occupiedBed(hospitalA, '101');
    const bed305 = await occupiedBed(hospitalA, '305');

    const own = await guestSession(bed101.guestToken);
    expect(own.status).toBe(200);
    expect(z.object({ location: locationSchema }).parse(own.body).location.bed.code).toBe('101');

    const forgedQuery = await request(application)
      .get(`/public/session?bedId=${bed305.bedId}`)
      .set('authorization', `Bearer ${bed101.guestToken}`);
    expect(forgedQuery.status).toBe(400);

    const forgedResolve = await request(application)
      .post('/public/qr/resolve')
      .send({ token: bed101.qr.token, bedId: bed305.bedId, hospitalId: hospitalB.hospitalId });
    expect(forgedResolve.status).toBe(400);

    // Guest and staff credentials are separate domains.
    expect((await as(bed101.guestToken).get('/admin/beds')).status).toBe(401);
    expect((await guestSession(hospitalA.adminToken)).status).toBe(401);
    expect((await request(application).get('/public/session')).status).toBe(401);
  });

  it('allows exactly one active session per bed under concurrent starts', async () => {
    const { bedId } = await createBedFixture(database, hospitalA);
    const admin = as(hospitalA.adminToken);
    const starts = await Promise.all(
      Array.from({ length: 6 }, () => admin.post('/admin/bed-sessions', { bedId })),
    );
    const statuses = starts.map((response) => response.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409, 409, 409]);
    expect(await database.bedSession.count({ where: { bedId, status: 'ACTIVE' } })).toBe(1);

    // The partial unique index rejects a second ACTIVE row even without the API.
    const membership = await database.hospitalMembership.findFirstOrThrow({
      where: { hospitalId: hospitalA.hospitalId },
    });
    await expect(
      database.bedSession.create({
        data: {
          hospitalId: hospitalA.hospitalId,
          bedId,
          startedByMembershipId: membership.id,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    const qrBed = await createBedFixture(database, hospitalA);
    const issues = await Promise.all(
      Array.from({ length: 5 }, () => admin.post(`/admin/beds/${qrBed.bedId}/qr`)),
    );
    expect(issues.map((response) => response.status).sort()).toEqual([201, 409, 409, 409, 409]);
    expect(await database.bedQrCode.count({ where: { bedId: qrBed.bedId } })).toBe(1);
  });

  it('keeps bed occupancy consistent with location rules', async () => {
    const admin = as(hospitalA.adminToken);
    const maintenance = await createBedFixture(database, hospitalA);
    await admin.patch(`/admin/beds/${maintenance.bedId}`, { status: 'MAINTENANCE' });
    expect((await admin.post('/admin/bed-sessions', { bedId: maintenance.bedId })).status).toBe(
      409,
    );

    const inactive = await createBedFixture(database, hospitalA);
    await admin.patch(`/admin/beds/${inactive.bedId}`, { active: false });
    expect((await admin.post('/admin/bed-sessions', { bedId: inactive.bedId })).status).toBe(409);

    const occupied = await occupiedBed(hospitalA);
    expect((await admin.patch(`/admin/beds/${occupied.bedId}`, { active: false })).status).toBe(
      409,
    );
    expect(
      (await admin.patch(`/admin/beds/${occupied.bedId}`, { status: 'AVAILABLE' })).status,
    ).toBe(409);
    expect((await admin.delete(`/admin/beds/${occupied.bedId}`)).status).toBe(409);
  });

  it('isolates QR codes and bed sessions across hospitals', async () => {
    const owned = await occupiedBed(hospitalA);
    const intruder = as(hospitalB.adminToken);

    const attempts = [
      await intruder.post(`/admin/beds/${owned.bedId}/qr`),
      await intruder.post(`/admin/beds/${owned.bedId}/qr/rotate`),
      await intruder.post(`/admin/beds/${owned.bedId}/qr/revoke`),
      await intruder.post('/admin/bed-sessions', { bedId: owned.bedId }),
      await intruder.post(`/admin/bed-sessions/${owned.session.id}/close`),
    ];
    expect(attempts.map((response) => response.status)).toEqual([404, 404, 404, 404, 404]);

    const qrList = await intruder.get('/admin/qr-codes');
    const sessionList = await intruder.get(`/admin/bed-sessions?bedId=${owned.bedId}`);
    expect(JSON.stringify(qrList.body)).not.toContain(owned.bedId);
    expect(z.object({ bedSessions: z.array(z.unknown()) }).parse(sessionList.body)).toEqual({
      bedSessions: [],
    });

    expect((await guestSession(owned.guestToken)).status).toBe(200);
    expect(
      (await database.bedQrCode.findFirstOrThrow({ where: { bedId: owned.bedId } })).status,
    ).toBe('ACTIVE');

    // Composite foreign keys reject cross-tenant and mismatched links.
    const otherBed = await createBedFixture(database, hospitalA);
    await expect(
      database.bedQrCode.create({
        data: {
          hospitalId: hospitalB.hospitalId,
          bedId: otherBed.bedId,
          tokenHash: 'x'.repeat(64),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      database.guestSession.create({
        data: {
          hospitalId: hospitalA.hospitalId,
          bedId: otherBed.bedId,
          bedSessionId: owned.session.id,
          tokenHash: 'y'.repeat(64),
          expiresAt: new Date(Date.now() + 60_000),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('requires the matching permission for each action', async () => {
    const { bedId } = await createBedFixture(database, hospitalA);
    const reader = as(await createStaffToken(database, application, hospitalA, ['bed.read']));
    expect((await reader.get('/admin/qr-codes')).status).toBe(200);
    expect((await reader.get('/admin/bed-sessions')).status).toBe(200);
    expect((await reader.post(`/admin/beds/${bedId}/qr`)).status).toBe(403);
    expect((await reader.post('/admin/bed-sessions', { bedId })).status).toBe(403);

    const issuer = as(await createStaffToken(database, application, hospitalA, ['qr.generate']));
    expect((await issuer.post(`/admin/beds/${bedId}/qr`)).status).toBe(201);
    expect((await issuer.post(`/admin/beds/${bedId}/qr/rotate`)).status).toBe(403);
    expect((await issuer.post(`/admin/beds/${bedId}/qr/revoke`)).status).toBe(403);

    const floorManager = as(
      await createStaffToken(database, application, hospitalA, ['bedSession.manage']),
    );
    expect((await floorManager.post('/admin/bed-sessions', { bedId })).status).toBe(201);
    expect((await floorManager.post(`/admin/beds/${bedId}/qr/rotate`)).status).toBe(403);

    expect((await request(application).post('/admin/bed-sessions').send({ bedId })).status).toBe(
      401,
    );
  });

  it('audits QR and bed-session changes without recording secrets', async () => {
    const bed = await occupiedBed(hospitalA);
    const rotation = issueSchema.parse(
      (await as(hospitalA.adminToken).post(`/admin/beds/${bed.bedId}/qr/rotate`)).body,
    );
    await as(hospitalA.adminToken).post(`/admin/beds/${bed.bedId}/qr/revoke`);
    await as(hospitalA.adminToken).post(`/admin/bed-sessions/${bed.session.id}/close`);

    const entries = await database.auditLog.findMany({
      where: {
        hospitalId: hospitalA.hospitalId,
        OR: [{ targetId: bed.qr.qrCode.id }, { targetId: bed.session.id }],
      },
      orderBy: { createdAt: 'asc' },
    });
    expect(entries.map((entry) => entry.action)).toEqual([
      'qr.generate',
      'bedSession.start',
      'qr.rotate',
      'qr.revoke',
      'bedSession.close',
    ]);
    const serialized = JSON.stringify(entries);
    for (const secret of [bed.qr.token, rotation.token, bed.guestToken]) {
      expect(serialized).not.toContain(secret);
      expect(serialized).not.toContain(hashOpaqueToken(secret));
    }
    expect(entries.find((entry) => entry.action === 'qr.rotate')?.metadata).toMatchObject({
      fromVersion: 1,
      toVersion: 2,
      revokedGuestSessions: 1,
    });
  });
});
