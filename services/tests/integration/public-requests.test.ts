import { randomUUID } from 'node:crypto';
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
const application = createApp({
  logger: createLogger('silent'),
  database,
  qrResolveRateLimit: { windowMs: 60_000, max: 100_000 },
});

const uuid = z.string().uuid();
const publicRequestSchema = z
  .object({
    publicId: z.string().regex(/^CR-[A-F0-9]{16}$/),
    serviceId: uuid,
    serviceName: z.string(),
    status: z.string(),
    version: z.number().int().positive(),
  })
  .passthrough();
const oneSchema = z.object({ serviceRequest: publicRequestSchema });
const listSchema = z.object({ serviceRequests: z.array(publicRequestSchema) });
const errorSchema = z.object({ error: z.object({ code: z.string() }) });

let hospitalA: HospitalFixture;
let hospitalB: HospitalFixture;
let departmentIdA: string;
let serviceIdA: string;
let serviceIdB: string;
let staffMembershipId: string;

function as(token: string) {
  const bearer = `Bearer ${token}`;
  return {
    get: (path: string) => request(application).get(path).set('authorization', bearer),
    post: (path: string, body: object = {}) =>
      request(application).post(path).set('authorization', bearer).send(body),
  };
}

async function openGuest(qrToken: string): Promise<string> {
  const response = await request(application).post('/public/qr/resolve').send({ token: qrToken });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return z.object({ guestToken: z.string() }).parse(response.body).guestToken;
}

async function occupiedBed(hospital: HospitalFixture) {
  const { bedId } = await createBedFixture(database, hospital);
  const qr = await as(hospital.adminToken).post(`/admin/beds/${bedId}/qr`);
  expect(qr.status, JSON.stringify(qr.body)).toBe(201);
  const qrToken = z.object({ token: z.string() }).parse(qr.body).token;
  const started = await as(hospital.adminToken).post('/admin/bed-sessions', { bedId });
  expect(started.status, JSON.stringify(started.body)).toBe(201);
  const bedSessionId = z.object({ bedSession: z.object({ id: uuid }) }).parse(started.body)
    .bedSession.id;
  const guestToken = await openGuest(qrToken);
  const session = await as(guestToken).get('/public/session');
  expect(session.status, JSON.stringify(session.body)).toBe(200);
  return { bedId, bedSessionId, qrToken, guestToken };
}

async function submit(token: string, serviceId = serviceIdA) {
  return as(token).post('/public/requests', { serviceId });
}

async function createRequest(token: string, serviceId = serviceIdA) {
  const response = await submit(token, serviceId);
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return oneSchema.parse(response.body).serviceRequest;
}

async function storedRequest(publicId: string) {
  return database.serviceRequest.findUniqueOrThrow({ where: { publicId } });
}

async function staffCommand(id: string, name: string, expectedVersion: number) {
  const body =
    name === 'assign' ? { expectedVersion, assigneeId: staffMembershipId } : { expectedVersion };
  const response = await as(hospitalA.adminToken).post(`/admin/requests/${id}/${name}`, body);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return z
    .object({ serviceRequest: z.object({ status: z.string(), version: z.number() }) })
    .parse(response.body).serviceRequest;
}

beforeAll(async () => {
  hospitalA = await createHospitalFixture(database, application, 'PUB-REQ-A');
  hospitalB = await createHospitalFixture(database, application, 'PUB-REQ-B');
  const serviceA = await database.serviceItem.findFirstOrThrow({
    where: { hospitalId: hospitalA.hospitalId, name: 'Drinking Water' },
  });
  serviceIdA = serviceA.id;
  departmentIdA = serviceA.departmentId;
  serviceIdB = (
    await database.serviceItem.findFirstOrThrow({
      where: { hospitalId: hospitalB.hospitalId, name: 'Drinking Water' },
    })
  ).id;

  const staffSession = await database.staffSession.findUniqueOrThrow({
    where: { tokenHash: hashOpaqueToken(hospitalA.adminToken) },
  });
  staffMembershipId = staffSession.membershipId;
  await database.hospitalMembership.update({
    where: { id: staffMembershipId },
    data: { dutyStatus: 'ON_DUTY' },
  });
  await database.staffDepartment.create({
    data: {
      hospitalId: hospitalA.hospitalId,
      membershipId: staffMembershipId,
      departmentId: serviceA.departmentId,
    },
  });
  await database.staffLocationScope.create({
    data: {
      hospitalId: hospitalA.hospitalId,
      membershipId: staffMembershipId,
      scopeType: 'HOSPITAL',
    },
  });
});

afterAll(async () => {
  await database.$disconnect();
});

describe('Phase 8 public patient requests', () => {
  it('lets a floor-scoped manager see and assign only requests on that floor', async () => {
    const firstBed = await occupiedBed(hospitalA);
    const secondBed = await occupiedBed(hospitalA);
    const first = await createRequest(firstBed.guestToken);
    const second = await createRequest(secondBed.guestToken);
    const firstStored = await storedRequest(first.publicId);
    const secondStored = await storedRequest(second.publicId);
    const floor = await database.bed.findUniqueOrThrow({
      where: { id: firstBed.bedId },
      select: { ward: { select: { floorId: true } } },
    });
    const managerToken = await createStaffToken(database, application, hospitalA, [
      'request.read',
      'request.assign',
      'staff.read',
    ]);
    const managerSession = await database.staffSession.findUniqueOrThrow({
      where: { tokenHash: hashOpaqueToken(managerToken) },
    });
    const managerRole = await database.userRole.findFirstOrThrow({
      where: { membershipId: managerSession.membershipId },
    });
    await database.scopeAssignment.updateMany({
      where: { userRoleId: managerRole.id },
      data: { scopeType: 'FLOOR', scopeId: floor.ward.floorId },
    });

    // A floor-scoped staff.read must not unlock the hospital-wide staff list,
    // but does allow eligibility checks for beds on that floor.
    expect((await as(managerToken).get('/admin/staff')).status).toBe(403);
    const eligibleQuery = (bedId: string) =>
      `/admin/staff/eligible?bedId=${bedId}&departmentId=${departmentIdA}`;
    expect((await as(managerToken).get(eligibleQuery(firstBed.bedId))).status).toBe(200);
    expect((await as(managerToken).get(eligibleQuery(secondBed.bedId))).status).toBe(404);
    const me = await as(managerToken).get('/auth/staff/me');
    expect(me.body).toMatchObject({
      permissions: [],
      scopedPermissions: ['request.assign', 'request.read', 'staff.read'],
    });

    const listed = await as(managerToken).get('/admin/requests');
    expect(listed.status, JSON.stringify(listed.body)).toBe(200);
    const ids = z
      .object({ serviceRequests: z.array(z.object({ id: uuid })) })
      .parse(listed.body)
      .serviceRequests.map((item) => item.id);
    expect(ids).toContain(firstStored.id);
    expect(ids).not.toContain(secondStored.id);

    // A hospital-wide administrator sees requests on every floor.
    const adminList = await as(hospitalA.adminToken).get('/admin/requests');
    expect(adminList.status, JSON.stringify(adminList.body)).toBe(200);
    const adminIds = z
      .object({ serviceRequests: z.array(z.object({ id: uuid })) })
      .parse(adminList.body)
      .serviceRequests.map((item) => item.id);
    expect(adminIds).toEqual(expect.arrayContaining([firstStored.id, secondStored.id]));
    expect(
      (
        await as(managerToken).post(`/admin/requests/${secondStored.id}/assign`, {
          expectedVersion: 1,
          assigneeId: staffMembershipId,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await as(managerToken).post(`/admin/requests/${firstStored.id}/assign`, {
          expectedVersion: 1,
          assigneeId: staffMembershipId,
        })
      ).status,
    ).toBe(200);
  });
  it('creates and tracks a request, then returns the same active request to both guests in one bed session', async () => {
    const bed = await occupiedBed(hospitalA);
    const otherGuest = await openGuest(bed.qrToken);
    const empty = await as(bed.guestToken).get('/public/requests');
    expect(empty.status, JSON.stringify(empty.body)).toBe(200);
    expect(listSchema.parse(empty.body).serviceRequests).toEqual([]);

    const created = await createRequest(bed.guestToken);
    expect(created).toMatchObject({
      serviceId: serviceIdA,
      serviceName: 'Drinking Water',
      status: 'SUBMITTED',
      version: 1,
    });
    const persisted = await storedRequest(created.publicId);
    expect(persisted).toMatchObject({
      hospitalId: hospitalA.hospitalId,
      bedId: bed.bedId,
      bedSessionId: bed.bedSessionId,
      serviceId: serviceIdA,
    });
    const submitter = await database.guestSession.findUniqueOrThrow({
      where: { tokenHash: hashOpaqueToken(bed.guestToken) },
    });
    expect(
      await database.requestEvent.findMany({ where: { requestId: persisted.id } }),
    ).toMatchObject([
      { type: 'SUBMITTED', actorType: 'GUEST', actorId: submitter.id, requestVersion: 1 },
    ]);

    for (const token of [bed.guestToken, otherGuest]) {
      const repeated = await submit(token);
      expect(repeated.status, JSON.stringify(repeated.body)).toBe(200);
      expect(oneSchema.parse(repeated.body).serviceRequest.publicId).toBe(created.publicId);
      const listed = await as(token).get('/public/requests');
      expect(listed.status, JSON.stringify(listed.body)).toBe(200);
      expect(listSchema.parse(listed.body).serviceRequests.map((item) => item.publicId)).toEqual([
        created.publicId,
      ]);
      for (const item of listSchema.parse(listed.body).serviceRequests) {
        expect(item).not.toHaveProperty('hospitalId');
        expect(item).not.toHaveProperty('bedId');
        expect(item).not.toHaveProperty('bedSessionId');
        expect(item).not.toHaveProperty('assigneeId');
        expect(item).not.toHaveProperty('slaPolicyId');
      }
    }
    expect(await database.serviceRequest.count({ where: { bedSessionId: bed.bedSessionId } })).toBe(
      1,
    );
    expect(await database.requestEvent.count({ where: { requestId: persisted.id } })).toBe(1);
  });

  it('returns an existing request on retry even if its service was later unpublished', async () => {
    const bed = await occupiedBed(hospitalA);
    const item = await database.serviceItem.findFirstOrThrow({
      where: { hospitalId: hospitalA.hospitalId, name: 'Nurse Assistance' },
    });
    const created = await createRequest(bed.guestToken, item.id);
    await database.serviceItem.update({ where: { id: item.id }, data: { active: false } });
    try {
      const retried = await submit(bed.guestToken, item.id);
      expect(retried.status, JSON.stringify(retried.body)).toBe(200);
      expect(oneSchema.parse(retried.body).serviceRequest.publicId).toBe(created.publicId);
    } finally {
      await database.serviceItem.update({ where: { id: item.id }, data: { active: true } });
    }
  });

  it('validates service input and never trusts client-supplied tenant or bed identifiers', async () => {
    const bed = await occupiedBed(hospitalA);
    const inactive = await database.serviceItem.findFirstOrThrow({
      where: { hospitalId: hospitalA.hospitalId, name: 'Wheelchair' },
    });
    await database.serviceItem.update({ where: { id: inactive.id }, data: { active: false } });

    for (const body of [
      {},
      { serviceId: 'not-a-uuid' },
      { serviceId: serviceIdA, hospitalId: hospitalB.hospitalId },
      { serviceId: serviceIdA, bedId: bed.bedId },
      { serviceId: serviceIdA, bedSessionId: bed.bedSessionId },
    ]) {
      const response = await as(bed.guestToken).post('/public/requests', body);
      expect(response.status, JSON.stringify(response.body)).toBe(400);
      expect(errorSchema.parse(response.body).error.code).toBe('VALIDATION_ERROR');
    }
    for (const unavailableId of [randomUUID(), serviceIdB, inactive.id]) {
      const response = await submit(bed.guestToken, unavailableId);
      expect(response.status, JSON.stringify(response.body)).toBe(404);
    }
    expect(
      (await as(bed.guestToken).get(`/public/requests?hospitalId=${hospitalB.hospitalId}`)).status,
    ).toBe(400);
    expect(await database.serviceRequest.count({ where: { bedSessionId: bed.bedSessionId } })).toBe(
      0,
    );
  });

  it('isolates lists and cancellation by bed session and hospital', async () => {
    const first = await occupiedBed(hospitalA);
    const second = await occupiedBed(hospitalA);
    const foreign = await occupiedBed(hospitalB);
    const firstRequest = await createRequest(first.guestToken);
    const secondRequest = await createRequest(second.guestToken);
    const foreignRequest = await createRequest(foreign.guestToken, serviceIdB);

    for (const [token, visibleId] of [
      [first.guestToken, firstRequest.publicId],
      [second.guestToken, secondRequest.publicId],
      [foreign.guestToken, foreignRequest.publicId],
    ] as const) {
      const response = await as(token).get('/public/requests');
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(listSchema.parse(response.body).serviceRequests.map((item) => item.publicId)).toEqual([
        visibleId,
      ]);
    }
    for (const [token, inaccessibleId] of [
      [first.guestToken, secondRequest.publicId],
      [first.guestToken, foreignRequest.publicId],
      [foreign.guestToken, firstRequest.publicId],
    ] as const) {
      const response = await as(token).post(`/public/requests/${inaccessibleId}/cancel`, {
        reason: 'Cannot cancel another bed',
      });
      expect(response.status, JSON.stringify(response.body)).toBe(404);
    }
    expect((await storedRequest(firstRequest.publicId)).status).toBe('SUBMITTED');
    expect((await storedRequest(secondRequest.publicId)).status).toBe('SUBMITTED');
    expect((await storedRequest(foreignRequest.publicId)).status).toBe('SUBMITTED');
  });

  it('cancels only early-state requests with a reason, records one event, and permits resubmission', async () => {
    const bed = await occupiedBed(hospitalA);
    const created = await createRequest(bed.guestToken);
    const invalid = await as(bed.guestToken).post(`/public/requests/${created.publicId}/cancel`, {
      reason: '   ',
    });
    expect(invalid.status).toBe(400);
    const extra = await as(bed.guestToken).post(`/public/requests/${created.publicId}/cancel`, {
      reason: 'Changed mind',
      hospitalId: hospitalA.hospitalId,
    });
    expect(extra.status).toBe(400);

    const cancelled = await as(bed.guestToken).post(`/public/requests/${created.publicId}/cancel`, {
      reason: '  No longer needed  ',
    });
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect(oneSchema.parse(cancelled.body).serviceRequest).toMatchObject({
      publicId: created.publicId,
      status: 'CANCELLED',
      version: 2,
    });
    const stored = await storedRequest(created.publicId);
    expect(stored.cancelledAt).not.toBeNull();
    expect(
      await database.requestEvent.findMany({
        where: { requestId: stored.id },
        orderBy: { requestVersion: 'asc' },
      }),
    ).toMatchObject([
      { type: 'SUBMITTED', requestVersion: 1 },
      {
        type: 'CANCELLED',
        previousStatus: 'SUBMITTED',
        resultingStatus: 'CANCELLED',
        actorType: 'GUEST',
        reason: 'No longer needed',
        requestVersion: 2,
      },
    ]);
    expect(
      (
        await as(bed.guestToken).post(`/public/requests/${created.publicId}/cancel`, {
          reason: 'Again',
        })
      ).status,
    ).toBe(409);

    const replacement = await createRequest(bed.guestToken);
    expect(replacement.publicId).not.toBe(created.publicId);
    const assigned = await staffCommand(
      (await storedRequest(replacement.publicId)).id,
      'assign',
      1,
    );
    expect(assigned.status).toBe('ASSIGNED');
    const assignedCancellation = await as(bed.guestToken).post(
      `/public/requests/${replacement.publicId}/cancel`,
      { reason: 'No need now' },
    );
    expect(assignedCancellation.status, JSON.stringify(assignedCancellation.body)).toBe(200);
    expect(oneSchema.parse(assignedCancellation.body).serviceRequest.status).toBe('CANCELLED');
  });

  it('allows a fresh request after completion but not cancellation after acceptance', async () => {
    const bed = await occupiedBed(hospitalA);
    const created = await createRequest(bed.guestToken);
    const stored = await storedRequest(created.publicId);
    await staffCommand(stored.id, 'assign', 1);
    await staffCommand(stored.id, 'accept', 2);
    const lateCancellation = await as(bed.guestToken).post(
      `/public/requests/${created.publicId}/cancel`,
      { reason: 'Too late' },
    );
    expect(lateCancellation.status, JSON.stringify(lateCancellation.body)).toBe(409);
    await staffCommand(stored.id, 'start', 3);
    await staffCommand(stored.id, 'complete', 4);

    const next = await createRequest(bed.guestToken);
    expect(next.publicId).not.toBe(created.publicId);
    const listed = await as(bed.guestToken).get('/public/requests');
    expect(listed.status, JSON.stringify(listed.body)).toBe(200);
    expect(
      listSchema
        .parse(listed.body)
        .serviceRequests.map((item) => item.publicId)
        .sort(),
    ).toEqual([created.publicId, next.publicId].sort());
  });

  it('denies all public request operations after the bed session closes or the guest session expires', async () => {
    const closedBed = await occupiedBed(hospitalA);
    const created = await createRequest(closedBed.guestToken);
    const closed = await as(hospitalA.adminToken).post(
      `/admin/bed-sessions/${closedBed.bedSessionId}/close`,
    );
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    for (const response of [
      await submit(closedBed.guestToken),
      await as(closedBed.guestToken).get('/public/requests'),
      await as(closedBed.guestToken).post(`/public/requests/${created.publicId}/cancel`, {
        reason: 'Too late',
      }),
    ]) {
      expect(response.status, JSON.stringify(response.body)).toBe(401);
    }

    const expiredBed = await occupiedBed(hospitalA);
    const expiring = await createRequest(expiredBed.guestToken);
    await database.guestSession.update({
      where: { tokenHash: hashOpaqueToken(expiredBed.guestToken) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    for (const response of [
      await submit(expiredBed.guestToken),
      await as(expiredBed.guestToken).get('/public/requests'),
      await as(expiredBed.guestToken).post(`/public/requests/${expiring.publicId}/cancel`, {
        reason: 'Too late',
      }),
    ]) {
      expect(response.status, JSON.stringify(response.body)).toBe(401);
    }
    expect((await request(application).get('/public/requests')).status).toBe(401);
    expect(
      (await request(application).post('/public/requests').send({ serviceId: serviceIdA })).status,
    ).toBe(401);
    expect((await as(hospitalA.adminToken).get('/public/requests')).status).toBe(401);
  });

  it('denies public request operations after QR rotation revokes the guest session', async () => {
    const bed = await occupiedBed(hospitalA);
    const created = await createRequest(bed.guestToken);
    const rotated = await as(hospitalA.adminToken).post(`/admin/beds/${bed.bedId}/qr/rotate`);
    expect(rotated.status, JSON.stringify(rotated.body)).toBe(200);
    expect((await submit(bed.guestToken)).status).toBe(401);
    expect((await as(bed.guestToken).get('/public/requests')).status).toBe(401);
    expect(
      (
        await as(bed.guestToken).post(`/public/requests/${created.publicId}/cancel`, {
          reason: 'No longer needed',
        })
      ).status,
    ).toBe(401);
  });

  it('handles simultaneous duplicate submissions and cancellation without extra rows or events', async () => {
    const bed = await occupiedBed(hospitalA);
    const submissions = await Promise.all([submit(bed.guestToken), submit(bed.guestToken)]);
    expect(submissions.map((response) => response.status).sort()).toEqual([200, 201]);
    const identifiers = submissions.map(
      (response) => oneSchema.parse(response.body).serviceRequest.publicId,
    );
    expect(new Set(identifiers).size).toBe(1);
    const id = identifiers[0]!;
    const persisted = await storedRequest(id);
    expect(
      await database.serviceRequest.count({
        where: { bedSessionId: bed.bedSessionId, serviceId: serviceIdA },
      }),
    ).toBe(1);

    const cancellations = await Promise.all([
      as(bed.guestToken).post(`/public/requests/${id}/cancel`, { reason: 'First attempt' }),
      as(bed.guestToken).post(`/public/requests/${id}/cancel`, { reason: 'Second attempt' }),
    ]);
    expect(cancellations.map((response) => response.status).sort()).toEqual([200, 409]);
    expect((await storedRequest(id)).status).toBe('CANCELLED');
    expect(await database.requestEvent.count({ where: { requestId: persisted.id } })).toBe(2);
  });
});
