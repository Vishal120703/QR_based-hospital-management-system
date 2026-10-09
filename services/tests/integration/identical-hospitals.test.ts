import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { z } from 'zod';
import { createApp } from '../../src/app.js';
import { createLogger } from '../../src/config/logger.js';
import { createPrismaClient } from '../../src/database/prisma.js';
import {
  createHospitalFixture,
  requireTestDatabaseUrl,
  type HospitalFixture,
} from '../support/fixtures.js';

// Two hospitals set up exactly alike (same floor, unit, and bed codes, same
// services). A patient's request must reach only the hospital and bed whose
// QR code they scanned: routing uses the QR's own secret, never codes or names.

const database = createPrismaClient(requireTestDatabaseUrl());
const application = createApp({
  logger: createLogger('silent'),
  database,
  qrResolveRateLimit: { windowMs: 60_000, max: 100_000 },
});

const uuid = z.string().uuid();
const withId = z.object({ id: uuid });
const catalogSchema = z.object({
  categories: z.array(
    z.object({ services: z.array(z.object({ id: uuid, name: z.string() }).passthrough()) }),
  ),
});
const requestList = z.object({
  serviceRequests: z.array(z.object({ id: uuid, publicId: z.string() }).passthrough()),
});

function as(token: string) {
  const bearer = `Bearer ${token}`;
  return {
    get: (path: string) => request(application).get(path).set('authorization', bearer),
    post: (path: string, body: object = {}) =>
      request(application).post(path).set('authorization', bearer).send(body),
  };
}

interface Setup {
  hospital: HospitalFixture;
  bedId: string;
  qrToken: string;
}

// The same layout in every hospital: First Floor (F1) → General Ward (GW) →
// Bed 01 (GW-01), with a patient admitted and the bed's QR printed.
async function sameLayout(hospital: HospitalFixture): Promise<Setup> {
  const admin = as(hospital.adminToken);
  const floor = z
    .object({ floor: withId })
    .parse(
      (await admin.post('/admin/floors', { code: 'F1', name: 'First Floor', level: 1 })).body,
    ).floor;
  const ward = z
    .object({ ward: withId })
    .parse(
      (await admin.post('/admin/wards', { floorId: floor.id, code: 'GW', name: 'General Ward' }))
        .body,
    ).ward;
  const bed = z
    .object({ bed: withId })
    .parse(
      (await admin.post('/admin/beds', { wardId: ward.id, code: 'GW-01', displayName: 'Bed 01' }))
        .body,
    ).bed;
  const qr = await admin.post(`/admin/beds/${bed.id}/qr`);
  expect(qr.status, JSON.stringify(qr.body)).toBe(201);
  expect((await admin.post('/admin/bed-sessions', { bedId: bed.id })).status).toBe(201);
  return { hospital, bedId: bed.id, qrToken: z.object({ token: z.string() }).parse(qr.body).token };
}

async function scan(qrToken: string) {
  const response = await request(application).post('/public/qr/resolve').send({ token: qrToken });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return z
    .object({
      guestToken: z.string(),
      location: z.object({ hospitalName: z.string(), bed: z.object({ code: z.string() }) }),
    })
    .parse(response.body);
}

async function patientService(guestToken: string, name: string) {
  const catalog = catalogSchema.parse((await as(guestToken).get('/public/services')).body);
  const service = catalog.categories
    .flatMap((category) => category.services)
    .find((item) => item.name === name);
  expect(service, `${name} is in the patient's catalog`).toBeTruthy();
  return service!.id;
}

async function staffSees(setup: Setup, publicId: string) {
  const list = requestList.parse((await as(setup.hospital.adminToken).get('/admin/requests')).body);
  return list.serviceRequests.some((item) => item.publicId === publicId);
}

let first: Setup;
let second: Setup;

beforeAll(async () => {
  first = await sameLayout(await createHospitalFixture(database, application, 'TWIN-A'));
  second = await sameLayout(await createHospitalFixture(database, application, 'TWIN-B'));
});

afterAll(async () => {
  await database.$disconnect();
});

describe('Hospitals set up exactly alike', () => {
  it('send a patient’s request only to the hospital and bed whose QR was scanned', async () => {
    // Same codes everywhere; different hospitals and different printed QR codes.
    expect(first.qrToken).not.toBe(second.qrToken);

    const patient = await scan(second.qrToken);
    expect(patient.location.hospitalName).toBe('TWIN-B Hospital');
    expect(patient.location.bed.code).toBe('GW-01');

    const serviceId = await patientService(patient.guestToken, 'Drinking Water');
    const sent = await as(patient.guestToken).post('/public/requests', { serviceId });
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    const publicId = z
      .object({ serviceRequest: z.object({ publicId: z.string() }) })
      .parse(sent.body).serviceRequest.publicId;

    const saved = await database.serviceRequest.findUniqueOrThrow({
      where: { publicId },
      select: { hospitalId: true, bedId: true },
    });
    expect(saved).toEqual({ hospitalId: second.hospital.hospitalId, bedId: second.bedId });
    expect(await staffSees(second, publicId)).toBe(true);
    expect(await staffSees(first, publicId)).toBe(false);
  });

  it('keeps each hospital’s requests apart when both patients ask for the same service', async () => {
    const patientA = await scan(first.qrToken);
    expect(patientA.location.hospitalName).toBe('TWIN-A Hospital');
    const sentA = await as(patientA.guestToken).post('/public/requests', {
      serviceId: await patientService(patientA.guestToken, 'Room Cleaning'),
    });
    expect(sentA.status, JSON.stringify(sentA.body)).toBe(201);
    const publicIdA = z
      .object({ serviceRequest: z.object({ publicId: z.string() }) })
      .parse(sentA.body).serviceRequest.publicId;

    expect(await staffSees(first, publicIdA)).toBe(true);
    expect(await staffSees(second, publicIdA)).toBe(false);
    const savedA = await database.serviceRequest.findUniqueOrThrow({
      where: { publicId: publicIdA },
      select: { hospitalId: true, bedId: true },
    });
    expect(savedA).toEqual({ hospitalId: first.hospital.hospitalId, bedId: first.bedId });
  });

  it('refuses a service from the other hospital, even with the same name', async () => {
    const patientB = await scan(second.qrToken);
    const patientA = await scan(first.qrToken);
    const otherHospitalsWater = await patientService(patientA.guestToken, 'Drinking Water');
    const response = await as(patientB.guestToken).post('/public/requests', {
      serviceId: otherHospitalsWater,
    });
    expect(response.status).toBe(404);
  });
});
