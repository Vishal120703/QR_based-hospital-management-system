import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { z } from 'zod';
import { createApp } from '../../src/app.js';
import { createLogger } from '../../src/config/logger.js';
import { createPrismaClient } from '../../src/database/prisma.js';
import { hashOpaqueToken } from '../../src/common/opaque-token.js';
import { RequestService } from '../../src/modules/requests/request.service.js';
import {
  createBedFixture,
  createHospitalFixture,
  createStaffToken,
  requireTestDatabaseUrl,
  type HospitalFixture,
} from '../support/fixtures.js';

const database = createPrismaClient(requireTestDatabaseUrl());
const application = createApp({ logger: createLogger('silent'), database });
const service = new RequestService(database);
const responseSchema = z.object({
  serviceRequest: z
    .object({ id: z.string().uuid(), status: z.string(), version: z.number() })
    .passthrough(),
});

let hospital: HospitalFixture;
let otherHospital: HospitalFixture;
let staffId: string;
let staffToken: string;
let secondStaffId: string;
let secondStaffToken: string;
let serviceId: string;

function as(token: string) {
  return {
    get: (path: string) => request(application).get(path).set('authorization', `Bearer ${token}`),
    post: (path: string, body: object) =>
      request(application).post(path).set('authorization', `Bearer ${token}`).send(body),
  };
}

async function makeEligibleStaff(): Promise<{ id: string; token: string }> {
  const token = await createStaffToken(database, application, hospital, [
    'request.read',
    'request.assign',
    'request.accept',
    'request.start',
    'request.complete',
    'request.close',
    'request.cancel',
    'request.reject',
    'request.transfer',
  ]);
  const session = await database.staffSession.findUniqueOrThrow({
    where: { tokenHash: hashOpaqueToken(token) },
  });
  const department = await database.serviceItem.findUniqueOrThrow({
    where: { hospitalId_id: { hospitalId: hospital.hospitalId, id: serviceId } },
  });
  await database.hospitalMembership.update({
    where: { id: session.membershipId },
    data: { dutyStatus: 'ON_DUTY' },
  });
  await database.staffDepartment.create({
    data: {
      hospitalId: hospital.hospitalId,
      membershipId: session.membershipId,
      departmentId: department.departmentId,
    },
  });
  await database.staffLocationScope.create({
    data: {
      hospitalId: hospital.hospitalId,
      membershipId: session.membershipId,
      scopeType: 'HOSPITAL',
    },
  });
  return { id: session.membershipId, token };
}

async function guestContext() {
  const { bedId } = await createBedFixture(database, hospital);
  const started = await as(hospital.adminToken).post('/admin/bed-sessions', { bedId });
  expect(started.status, JSON.stringify(started.body)).toBe(201);
  const bedSessionId = z
    .object({ bedSession: z.object({ id: z.string().uuid() }) })
    .parse(started.body).bedSession.id;
  const expiresAt = new Date(Date.now() + 3_600_000);
  const guest = await database.guestSession.create({
    data: {
      hospitalId: hospital.hospitalId,
      bedId,
      bedSessionId,
      tokenHash: randomUUID(),
      expiresAt,
    },
  });
  return {
    guestSessionId: guest.id,
    hospitalId: hospital.hospitalId,
    bedId,
    bedSessionId,
    expiresAt,
  };
}

async function submitted() {
  return service.submit(await guestContext(), serviceId, randomUUID());
}

async function command(id: string, name: string, body: object, token = staffToken) {
  return as(token).post(`/admin/requests/${id}/${name}`, body);
}

async function expectCommand(
  id: string,
  name: string,
  body: object,
  status: string,
  token = staffToken,
) {
  const response = await command(id, name, body, token);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  const parsed = responseSchema.parse(response.body).serviceRequest;
  expect(parsed.status).toBe(status);
  return parsed;
}

beforeAll(async () => {
  hospital = await createHospitalFixture(database, application, 'REQ-A');
  otherHospital = await createHospitalFixture(database, application, 'REQ-B');
  serviceId = (
    await database.serviceItem.findFirstOrThrow({
      where: { hospitalId: hospital.hospitalId, name: 'Drinking Water' },
    })
  ).id;
  ({ id: staffId, token: staffToken } = await makeEligibleStaff());
  ({ id: secondStaffId, token: secondStaffToken } = await makeEligibleStaff());
});

afterAll(async () => {
  await database.$disconnect();
});

describe('Phase 7 request state machine', () => {
  it('snapshots the service, deadlines, and initial immutable event; blocks duplicate active submission', async () => {
    const guest = await guestContext();
    const created = await service.submit(guest, serviceId, randomUUID());
    expect(created.status).toBe('SUBMITTED');
    expect(created.version).toBe(1);
    expect(created.publicId).toMatch(/^CR-[A-F0-9]{16}$/);
    expect(created.acceptDueAt.getTime() - created.submittedAt.getTime()).toBe(
      created.acceptMinutes * 60_000,
    );
    expect(created.completeDueAt.getTime() - created.submittedAt.getTime()).toBe(
      created.completeMinutes * 60_000,
    );
    const events = await database.requestEvent.findMany({ where: { requestId: created.id } });
    expect(events).toMatchObject([
      {
        type: 'SUBMITTED',
        previousStatus: null,
        resultingStatus: 'SUBMITTED',
        requestVersion: 1,
        actorType: 'GUEST',
      },
    ]);
    await expect(service.submit(guest, serviceId)).rejects.toMatchObject({ code: 'CONFLICT' });

    const sla = await database.slaPolicy.findUniqueOrThrow({ where: { id: created.slaPolicyId } });
    await database.slaPolicyVersion.create({
      data: {
        hospitalId: hospital.hospitalId,
        slaPolicyId: sla.id,
        version: sla.currentVersion + 1,
        acceptMinutes: 30,
        completeMinutes: 90,
      },
    });
    await database.slaPolicy.update({
      where: { id: sla.id },
      data: { currentVersion: { increment: 1 } },
    });
    await database.serviceItem.update({
      where: { id: serviceId },
      data: { name: `Updated water ${randomUUID()}` },
    });
    const unchanged = await database.serviceRequest.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(unchanged.serviceName).toBe(created.serviceName);
    expect(unchanged.acceptDueAt).toEqual(created.acceptDueAt);
    expect(unchanged.completeDueAt).toEqual(created.completeDueAt);
  });

  it('refuses submissions after the BedSession is closed', async () => {
    const guest = await guestContext();
    const closed = await as(hospital.adminToken).post(
      `/admin/bed-sessions/${guest.bedSessionId}/close`,
      {},
    );
    expect(closed.status).toBe(200);
    await expect(service.submit(guest, serviceId)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('rejects a service from another hospital and an expired guest session', async () => {
    const guest = await guestContext();
    const foreignService = await database.serviceItem.findFirstOrThrow({
      where: { hospitalId: otherHospital.hospitalId },
    });
    await expect(service.submit(guest, foreignService.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await database.guestSession.update({
      where: { id: guest.guestSessionId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(service.submit(guest, serviceId)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('performs the complete happy path and records one event per version', async () => {
    const guest = await guestContext();
    const created = await service.submit(guest, serviceId);
    const assigned = await expectCommand(
      created.id,
      'assign',
      { expectedVersion: 1, assigneeId: staffId },
      'ASSIGNED',
    );
    const accepted = await expectCommand(
      created.id,
      'accept',
      { expectedVersion: assigned.version },
      'ACCEPTED',
    );
    expect(
      (await command(created.id, 'complete', { expectedVersion: accepted.version })).status,
    ).toBe(409);
    const started = await expectCommand(
      created.id,
      'start',
      { expectedVersion: accepted.version },
      'IN_PROGRESS',
    );
    const completed = await expectCommand(
      created.id,
      'complete',
      { expectedVersion: started.version },
      'COMPLETED',
    );
    expect(
      (await command(created.id, 'accept', { expectedVersion: completed.version })).status,
    ).toBe(409);
    const another = await service.submit(guest, serviceId);
    expect(another.id).not.toBe(created.id);
    const closed = await expectCommand(
      created.id,
      'close',
      { expectedVersion: completed.version },
      'CLOSED',
    );
    expect(closed.version).toBe(6);
    const events = await database.requestEvent.findMany({
      where: { requestId: created.id },
      orderBy: { requestVersion: 'asc' },
    });
    expect(events.map((event) => event.type)).toEqual([
      'SUBMITTED',
      'ASSIGNED',
      'ACCEPTED',
      'STARTED',
      'COMPLETED',
      'CLOSED',
    ]);
    expect(events.map((event) => event.requestVersion)).toEqual([1, 2, 3, 4, 5, 6]);
    expect((await command(created.id, 'accept', { expectedVersion: 6 })).status).toBe(409);
    await expect(
      database.requestEvent.update({ where: { id: events[0]!.id }, data: { reason: 'tamper' } }),
    ).rejects.toThrow();
  });

  it('rejects forbidden transitions, stale versions, foreign tenants, and invalid assignees', async () => {
    const created = await submitted();
    for (const action of ['accept', 'start', 'complete', 'close', 'reject', 'transfer']) {
      const body =
        action === 'transfer'
          ? { expectedVersion: 1, assigneeId: staffId, reason: 'Move' }
          : action === 'reject'
            ? { expectedVersion: 1, reason: 'No' }
            : { expectedVersion: 1 };
      expect((await command(created.id, action, body)).status).toBe(409);
    }
    expect(
      (await command(created.id, 'assign', { expectedVersion: 1, assigneeId: randomUUID() }))
        .status,
    ).toBe(400);
    expect(
      (await command(created.id, 'assign', { expectedVersion: 0, assigneeId: staffId })).status,
    ).toBe(400);
    expect(
      (
        await command(created.id, 'assign', {
          expectedVersion: 1,
          assigneeId: staffId,
          status: 'COMPLETED',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await command(
          created.id,
          'assign',
          { expectedVersion: 1, assigneeId: staffId },
          otherHospital.adminToken,
        )
      ).status,
    ).toBe(404);
    expect((await as(otherHospital.adminToken).get(`/admin/requests/${created.id}`)).status).toBe(
      404,
    );
    const readOnly = await createStaffToken(database, application, hospital, ['request.read']);
    expect(
      (await command(created.id, 'assign', { expectedVersion: 1, assigneeId: staffId }, readOnly))
        .status,
    ).toBe(403);
    const assigned = await expectCommand(
      created.id,
      'assign',
      { expectedVersion: 1, assigneeId: staffId },
      'ASSIGNED',
    );
    expect((await command(created.id, 'start', { expectedVersion: assigned.version })).status).toBe(
      409,
    );
    expect((await command(created.id, 'accept', { expectedVersion: 1 })).status).toBe(409);
    expect(
      (
        await command(
          created.id,
          'accept',
          { expectedVersion: assigned.version },
          hospital.adminToken,
        )
      ).status,
    ).toBe(403);
    await database.hospitalMembership.update({
      where: { id: staffId },
      data: { dutyStatus: 'OFF_DUTY' },
    });
    expect(
      (await command(created.id, 'accept', { expectedVersion: assigned.version })).status,
    ).toBe(403);
    await database.hospitalMembership.update({
      where: { id: staffId },
      data: { dutyStatus: 'ON_DUTY' },
    });
    await expectCommand(
      created.id,
      'reject',
      { expectedVersion: assigned.version, reason: 'Unavailable' },
      'REJECTED',
    );
    expect(
      (await command(created.id, 'assign', { expectedVersion: 3, assigneeId: staffId })).status,
    ).toBe(409);
  });

  it('supports cancellation from submitted and assigned, and transfer from accepted and in progress', async () => {
    const first = await submitted();
    await expectCommand(
      first.id,
      'cancel',
      { expectedVersion: 1, reason: 'No longer needed' },
      'CANCELLED',
    );
    const second = await submitted();
    const assigned = await expectCommand(
      second.id,
      'assign',
      { expectedVersion: 1, assigneeId: staffId },
      'ASSIGNED',
    );
    expect((await command(second.id, 'cancel', { expectedVersion: 2 })).status).toBe(400);
    await expectCommand(
      second.id,
      'cancel',
      { expectedVersion: assigned.version, reason: 'Duplicate' },
      'CANCELLED',
    );
    const third = await submitted();
    await expectCommand(
      third.id,
      'assign',
      { expectedVersion: 1, assigneeId: staffId },
      'ASSIGNED',
    );
    await expectCommand(third.id, 'accept', { expectedVersion: 2 }, 'ACCEPTED');
    await expectCommand(
      third.id,
      'transfer',
      { expectedVersion: 3, assigneeId: secondStaffId, reason: 'Shift change' },
      'ASSIGNED',
    );
    const transferred = await database.serviceRequest.findUniqueOrThrow({
      where: { id: third.id },
    });
    expect(transferred.assigneeId).toBe(secondStaffId);
    expect((await command(third.id, 'accept', { expectedVersion: 4 })).status).toBe(403);
    await expectCommand(third.id, 'accept', { expectedVersion: 4 }, 'ACCEPTED', secondStaffToken);
    await expectCommand(third.id, 'start', { expectedVersion: 5 }, 'IN_PROGRESS', secondStaffToken);
    await expectCommand(
      third.id,
      'transfer',
      { expectedVersion: 6, assigneeId: staffId, reason: 'Return to primary' },
      'ASSIGNED',
      secondStaffToken,
    );
  });

  it('allows only one concurrent acceptance and rolls back the state if event insertion fails', async () => {
    const created = await submitted();
    await expectCommand(
      created.id,
      'assign',
      { expectedVersion: 1, assigneeId: staffId },
      'ASSIGNED',
    );
    const results = await Promise.all([
      command(created.id, 'accept', { expectedVersion: 2 }),
      command(created.id, 'accept', { expectedVersion: 2 }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(
      await database.requestEvent.count({ where: { requestId: created.id, type: 'ACCEPTED' } }),
    ).toBe(1);
    await expectCommand(created.id, 'start', { expectedVersion: 3 }, 'IN_PROGRESS');
    await expectCommand(
      created.id,
      'transfer',
      { expectedVersion: 4, assigneeId: secondStaffId, reason: 'Shift change' },
      'ASSIGNED',
    );
    await expectCommand(created.id, 'cancel', { expectedVersion: 5, reason: 'Stop' }, 'CANCELLED');

    const fresh = await submitted();
    await database.requestEvent.create({
      data: {
        hospitalId: hospital.hospitalId,
        requestId: fresh.id,
        type: 'ASSIGNED',
        previousStatus: 'SUBMITTED',
        resultingStatus: 'ASSIGNED',
        actorType: 'SYSTEM',
        requestVersion: 2,
      },
    });
    await expect(
      command(fresh.id, 'assign', { expectedVersion: 1, assigneeId: staffId }),
    ).resolves.toMatchObject({ status: 409 });
    const unchanged = await database.serviceRequest.findUniqueOrThrow({ where: { id: fresh.id } });
    expect([unchanged.status, unchanged.version]).toEqual(['SUBMITTED', 1]);
    expect(await database.requestEvent.count({ where: { requestId: fresh.id } })).toBe(2);
    expect(
      await database.auditLog.count({
        where: { hospitalId: hospital.hospitalId, targetId: fresh.id, action: 'request.assign' },
      }),
    ).toBe(0);
  });
});
