import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { z } from 'zod';
import { createApp } from '../../src/app.js';
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
const application = createApp({
  logger: createLogger('silent'),
  database,
  qrResolveRateLimit: { windowMs: 60_000, max: 100_000 },
});

const changeSchema = z.object({
  bedOccupancy: z.object({
    enabled: z.boolean(),
    releasedBeds: z.number(),
    closedStays: z.number(),
    revokedGuestSessions: z.number(),
  }),
});
const errorSchema = z.object({ error: z.object({ code: z.string() }) });
const requestSchema = z.object({
  serviceRequest: z.object({ publicId: z.string(), status: z.string() }).passthrough(),
});
const listSchema = z.object({ serviceRequests: z.array(z.object({ publicId: z.string() })) });

function as(token: string) {
  const bearer = `Bearer ${token}`;
  return {
    get: (path: string) => request(application).get(path).set('authorization', bearer),
    post: (path: string, body: object = {}) =>
      request(application).post(path).set('authorization', bearer).send(body),
    put: (path: string, body: object) =>
      request(application).put(path).set('authorization', bearer).send(body),
    patch: (path: string, body: object) =>
      request(application).patch(path).set('authorization', bearer).send(body),
  };
}

async function setOccupancy(hospital: HospitalFixture, enabled: boolean) {
  const response = await as(hospital.adminToken).put('/admin/bed-occupancy', { enabled });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return changeSchema.parse(response.body).bedOccupancy;
}

async function bedWithQr(hospital: HospitalFixture, bedCode = '101') {
  const { bedId } = await createBedFixture(database, hospital, bedCode);
  const issued = await as(hospital.adminToken).post(`/admin/beds/${bedId}/qr`);
  expect(issued.status, JSON.stringify(issued.body)).toBe(201);
  return { bedId, qrToken: z.object({ token: z.string() }).parse(issued.body).token };
}

function scan(qrToken: string) {
  return request(application).post('/public/qr/resolve').send({ token: qrToken });
}

async function openGuest(qrToken: string): Promise<string> {
  const response = await scan(qrToken);
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return z.object({ guestToken: z.string() }).parse(response.body).guestToken;
}

async function drinkingWater(hospital: HospitalFixture): Promise<string> {
  return (
    await database.serviceItem.findFirstOrThrow({
      where: { hospitalId: hospital.hospitalId, name: 'Drinking Water' },
    })
  ).id;
}

async function ask(guestToken: string, serviceId: string) {
  return as(guestToken).post('/public/requests', { serviceId });
}

async function bedStatus(bedId: string) {
  return (await database.bed.findUniqueOrThrow({ where: { id: bedId } })).status;
}

async function activeStays(bedId: string) {
  return database.bedSession.findMany({ where: { bedId, status: 'ACTIVE' } });
}

afterAll(async () => {
  await database.$disconnect();
});

describe('Optional bed occupancy management', () => {
  it('is on by default, and only a hospital manager may change it', async () => {
    const hospital = await createHospitalFixture(database, application, 'OCC-DEFAULT');
    const me = await as(hospital.adminToken).get('/auth/staff/me');
    expect(me.body).toMatchObject({ tenant: { bedOccupancyEnabled: true } });
    const profile = await as(hospital.adminToken).get('/admin/hospital');
    expect(profile.body).toMatchObject({ hospital: { bedOccupancyEnabled: true } });

    // A QR on a bed nobody admitted does not work while it is on.
    const { qrToken } = await bedWithQr(hospital);
    expect(errorSchema.parse((await scan(qrToken)).body).error.code).toBe('QR_UNAVAILABLE');

    const bedManager = await createStaffToken(database, application, hospital, [
      'bed.read',
      'bed.manage',
      'bedSession.manage',
      'hospital.read',
    ]);
    expect((await as(bedManager).put('/admin/bed-occupancy', { enabled: false })).status).toBe(403);
    const invalid = await as(hospital.adminToken).put('/admin/bed-occupancy', { enabled: 'no' });
    expect(invalid.status).toBe(400);
    expect(
      (await database.hospital.findUniqueOrThrow({ where: { id: hospital.hospitalId } }))
        .bedOccupancyEnabled,
    ).toBe(true);
  });

  it('turning it off keeps admitted patients connected and stops admissions', async () => {
    const hospital = await createHospitalFixture(database, application, 'OCC-OFF');
    const serviceId = await drinkingWater(hospital);
    const { bedId, qrToken } = await bedWithQr(hospital);
    const admitted = await as(hospital.adminToken).post('/admin/bed-sessions', { bedId });
    expect(admitted.status).toBe(201);
    const stayId = z.object({ bedSession: z.object({ id: z.string() }) }).parse(admitted.body)
      .bedSession.id;
    const guestToken = await openGuest(qrToken);

    expect(await setOccupancy(hospital, false)).toEqual({
      enabled: false,
      releasedBeds: 1,
      closedStays: 0,
      revokedGuestSessions: 0,
    });
    // The bed no longer shows as occupied; the patient keeps using their QR.
    expect(await bedStatus(bedId)).toBe('AVAILABLE');
    expect((await as(guestToken).get('/public/session')).status).toBe(200);
    expect((await ask(guestToken, serviceId)).status).toBe(201);
    const me = await as(hospital.adminToken).get('/auth/staff/me');
    expect(me.body).toMatchObject({ tenant: { bedOccupancyEnabled: false } });

    // Nobody admits or discharges while it is off.
    const { bedId: freeBed } = await createBedFixture(database, hospital, '102');
    const admit = await as(hospital.adminToken).post('/admin/bed-sessions', { bedId: freeBed });
    expect(admit.status).toBe(409);
    expect(errorSchema.parse(admit.body).error.code).toBe('BED_OCCUPANCY_OFF');
    const discharge = await as(hospital.adminToken).post(`/admin/bed-sessions/${stayId}/close`);
    expect(discharge.status).toBe(409);
    expect(await activeStays(freeBed)).toEqual([]);

    const audit = await database.auditLog.findMany({
      where: { hospitalId: hospital.hospitalId, action: { startsWith: 'hospital.bedOccupancy' } },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'hospital.bedOccupancy.disable',
      targetType: 'Hospital',
      targetId: hospital.hospitalId,
      metadata: { releasedBeds: 1, closedStays: 0, revokedGuestSessions: 0 },
    });

    // Setting it to what it already is changes nothing and is not logged.
    expect((await setOccupancy(hospital, false)).releasedBeds).toBe(0);
    expect(
      await database.auditLog.count({
        where: { hospitalId: hospital.hospitalId, action: { startsWith: 'hospital.bedOccupancy' } },
      }),
    ).toBe(1);
  });

  it('while off, a scan works without admission and the bed never shows occupied', async () => {
    const hospital = await createHospitalFixture(database, application, 'OCC-QR-ONLY');
    const serviceId = await drinkingWater(hospital);
    await setOccupancy(hospital, false);
    const { bedId, qrToken } = await bedWithQr(hospital);

    const patient = await openGuest(qrToken);
    expect(await bedStatus(bedId)).toBe('AVAILABLE');
    const [stay] = await activeStays(bedId);
    expect(stay?.startedByMembershipId).toBeNull();
    const sent = await ask(patient, serviceId);
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    const publicId = requestSchema.parse(sent.body).serviceRequest.publicId;
    const stored = await database.serviceRequest.findUniqueOrThrow({ where: { publicId } });
    expect(stored.bedSessionId).toBe(stay?.id);

    // An attendant scanning meanwhile joins the same stay and sees the request.
    const attendant = await openGuest(qrToken);
    expect(await activeStays(bedId)).toHaveLength(1);
    const seen = listSchema.parse((await as(attendant).get('/public/requests')).body);
    expect(seen.serviceRequests.map((item) => item.publicId)).toEqual([publicId]);

    // A bed taken out of use stops working, as with admissions on.
    await database.bed.update({ where: { id: bedId }, data: { status: 'MAINTENANCE' } });
    expect(errorSchema.parse((await scan(qrToken)).body).error.code).toBe('QR_UNAVAILABLE');
    expect((await ask(patient, serviceId)).status).toBe(401);
  });

  it('starts a fresh stay for the next patient once nobody is using the bed', async () => {
    const hospital = await createHospitalFixture(database, application, 'OCC-NEXT');
    const serviceId = await drinkingWater(hospital);
    await setOccupancy(hospital, false);
    const { bedId, qrToken } = await bedWithQr(hospital);
    const first = await openGuest(qrToken);
    const publicId = requestSchema.parse((await ask(first, serviceId)).body).serviceRequest
      .publicId;
    const [firstStay] = await activeStays(bedId);
    const expire = () =>
      database.guestSession.updateMany({
        where: { bedId },
        data: { expiresAt: new Date(Date.now() - 60_000) },
      });

    // The connection expired but the request is still open: the patient who
    // scans again stays on the same stay and still sees it.
    await expire();
    const back = await openGuest(qrToken);
    expect((await activeStays(bedId)).map((item) => item.id)).toEqual([firstStay?.id]);
    expect(listSchema.parse((await as(back).get('/public/requests')).body).serviceRequests).toEqual(
      [expect.objectContaining({ publicId })],
    );

    // Once nothing is open and nobody is connected, the next scan starts a
    // fresh stay: the next patient does not see the earlier requests.
    const cancelled = await as(back).post(`/public/requests/${publicId}/cancel`, {
      reason: 'No longer needed',
    });
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    await expire();
    const next = await openGuest(qrToken);
    const stays = await activeStays(bedId);
    expect(stays).toHaveLength(1);
    expect(stays[0]?.id).not.toBe(firstStay?.id);
    expect(
      (await database.bedSession.findUniqueOrThrow({ where: { id: firstStay!.id } })).status,
    ).toBe('CLOSED');
    expect(listSchema.parse((await as(next).get('/public/requests')).body).serviceRequests).toEqual(
      [],
    );
  });

  it('turning it back on ends scan-opened stays until patients are admitted', async () => {
    const hospital = await createHospitalFixture(database, application, 'OCC-ON');
    const other = await createHospitalFixture(database, application, 'OCC-OTHER');
    await setOccupancy(hospital, false);
    const { bedId, qrToken } = await bedWithQr(hospital);
    const guestToken = await openGuest(qrToken);
    // Another hospital keeps admissions on throughout.
    const { qrToken: otherQr } = await bedWithQr(other);
    expect(errorSchema.parse((await scan(otherQr)).body).error.code).toBe('QR_UNAVAILABLE');

    expect(await setOccupancy(hospital, true)).toEqual({
      enabled: true,
      releasedBeds: 0,
      closedStays: 1,
      revokedGuestSessions: 1,
    });
    expect((await as(guestToken).get('/public/session')).status).toBe(401);
    expect(await activeStays(bedId)).toEqual([]);
    expect(errorSchema.parse((await scan(qrToken)).body).error.code).toBe('QR_UNAVAILABLE');

    // Admitting works again, and then the QR does too.
    expect((await as(hospital.adminToken).post('/admin/bed-sessions', { bedId })).status).toBe(201);
    expect(await bedStatus(bedId)).toBe('OCCUPIED');
    await openGuest(qrToken);
    const audit = await database.auditLog.findMany({
      where: { hospitalId: hospital.hospitalId, action: { startsWith: 'hospital.bedOccupancy' } },
      orderBy: { createdAt: 'asc' },
    });
    expect(audit.map((entry) => entry.action)).toEqual([
      'hospital.bedOccupancy.disable',
      'hospital.bedOccupancy.enable',
    ]);
  });

  it('never leaves a scan-opened stay behind when it is turned on during scans', async () => {
    const hospital = await createHospitalFixture(database, application, 'OCC-RACE');
    await setOccupancy(hospital, false);
    const beds = await Promise.all(
      ['201', '202', '203', '204'].map((code) => bedWithQr(hospital, code)),
    );
    const scans = beds.flatMap((bed) => [scan(bed.qrToken), scan(bed.qrToken)]);
    const [change, ...results] = await Promise.all([setOccupancy(hospital, true), ...scans]);
    expect(change.enabled).toBe(true);
    // Each scan either finished before the change (and its stay was ended) or
    // came after it (and was refused): none is left open on a free bed.
    for (const result of results) expect([201, 404]).toContain(result.status);
    const left = await database.bedSession.count({
      where: { hospitalId: hospital.hospitalId, status: 'ACTIVE' },
    });
    expect(left).toBe(0);
    expect(change.closedStays).toBe(
      await database.bedSession.count({ where: { hospitalId: hospital.hospitalId } }),
    );
  });
});
