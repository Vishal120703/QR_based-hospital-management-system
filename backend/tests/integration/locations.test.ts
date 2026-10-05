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
  requireTestDatabaseUrl,
  type HospitalFixture,
} from '../support/fixtures.js';

const database = createPrismaClient(requireTestDatabaseUrl());
const application = createApp({ logger: createLogger('silent'), database });

const recordSchema = z
  .object({
    id: z.string().uuid(),
    hospitalId: z.string().uuid(),
    code: z.string(),
    active: z.boolean(),
  })
  .passthrough();
type LocationRecord = z.infer<typeof recordSchema>;

let hospitalA: HospitalFixture;
let hospitalB: HospitalFixture;
let readerTokenA: string;

function as(token: string) {
  const bearer = `Bearer ${token}`;
  return {
    get: (path: string) => request(application).get(path).set('authorization', bearer),
    post: (path: string, body: object) =>
      request(application).post(path).set('authorization', bearer).send(body),
    patch: (path: string, body: object) =>
      request(application).patch(path).set('authorization', bearer).send(body),
    delete: (path: string) => request(application).delete(path).set('authorization', bearer),
  };
}

function single(response: { body: unknown }, key: string): LocationRecord {
  const item = z.record(z.string(), recordSchema).parse(response.body)[key];
  if (!item) {
    throw new Error(`Response has no "${key}".`);
  }
  return item;
}

function many(response: { body: unknown }, key: string): LocationRecord[] {
  return z.record(z.string(), z.array(recordSchema)).parse(response.body)[key] ?? [];
}

async function create(
  token: string,
  path: string,
  key: string,
  body: object,
): Promise<LocationRecord> {
  const response = await as(token).post(path, body);
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return single(response, key);
}

async function createHierarchy(hospital: HospitalFixture, prefix: string) {
  const token = hospital.adminToken;
  const building = await create(token, '/admin/buildings', 'building', {
    code: `${prefix}-BLD`,
    name: 'Main Block',
  });
  const floor = await create(token, '/admin/floors', 'floor', {
    buildingId: building.id,
    code: `${prefix}-F1`,
    name: 'First Floor',
  });
  const ward = await create(token, '/admin/wards', 'ward', {
    floorId: floor.id,
    code: 'GEN',
    name: 'General Ward',
  });
  const room = await create(token, '/admin/rooms', 'room', {
    wardId: ward.id,
    code: '101',
    name: 'Room 101',
  });
  const bed = await create(token, '/admin/beds', 'bed', {
    wardId: ward.id,
    roomId: room.id,
    code: '101-A',
    displayName: 'Bed 101-A',
  });
  return { building, floor, ward, room, bed };
}

beforeAll(async () => {
  hospitalA = await createHospitalFixture(database, application, 'LOC-A');
  hospitalB = await createHospitalFixture(database, application, 'LOC-B');
  readerTokenA = await createStaffToken(database, application, hospitalA, [
    'location.read',
    'bed.read',
  ]);
});

afterAll(async () => {
  await database.$disconnect();
});

describe('Phase 3 location hierarchy', () => {
  it('creates the full hierarchy and supports optional building and room layers', async () => {
    const full = await createHierarchy(hospitalA, 'FULL');
    expect(full.bed).toMatchObject({
      hospitalId: hospitalA.hospitalId,
      wardId: full.ward.id,
      roomId: full.room.id,
      code: '101-A',
      status: 'AVAILABLE',
      active: true,
    });

    const floor = await create(hospitalA.adminToken, '/admin/floors', 'floor', {
      code: 'flat-f1',
      name: 'Floor without building',
    });
    expect(floor).toMatchObject({ code: 'FLAT-F1', buildingId: null });
    const ward = await create(hospitalA.adminToken, '/admin/wards', 'ward', {
      floorId: floor.id,
      code: 'ICU',
      name: 'Intensive Care',
    });
    const bed = await create(hospitalA.adminToken, '/admin/beds', 'bed', {
      wardId: ward.id,
      code: 'ICU-1',
      displayName: 'ICU Bed 1',
    });
    expect(bed).toMatchObject({ roomId: null, hospitalId: hospitalA.hospitalId });

    const listed = await as(hospitalA.adminToken).get(`/admin/beds?wardId=${ward.id}`);
    expect(listed.status).toBe(200);
    expect(many(listed, 'beds').map((item) => item.id)).toEqual([bed.id]);

    const wards = await as(hospitalA.adminToken).get(`/admin/wards?floorId=${floor.id}`);
    expect(many(wards, 'wards').map((item) => item.id)).toEqual([ward.id]);

    const read = await as(hospitalA.adminToken).get(`/admin/beds/${bed.id}`);
    expect(read.status).toBe(200);
    expect(single(read, 'bed').id).toBe(bed.id);
  });

  it('isolates READ, UPDATE, and DELETE of every level across hospitals', async () => {
    const owned = await createHierarchy(hospitalA, 'ISO');
    const levels = [
      ['buildings', owned.building, { name: 'Stolen' }],
      ['floors', owned.floor, { name: 'Stolen' }],
      ['wards', owned.ward, { name: 'Stolen' }],
      ['rooms', owned.room, { name: 'Stolen' }],
      ['beds', owned.bed, { displayName: 'Stolen' }],
    ] as const;
    const intruder = as(hospitalB.adminToken);

    for (const [path, entity, change] of levels) {
      const list = await intruder.get(`/admin/${path}`);
      expect(list.status).toBe(200);
      expect(JSON.stringify(list.body)).not.toContain(entity.id);

      const read = await intruder.get(`/admin/${path}/${entity.id}`);
      const update = await intruder.patch(`/admin/${path}/${entity.id}`, change);
      const remove = await intruder.delete(`/admin/${path}/${entity.id}`);
      expect([read.status, update.status, remove.status], path).toEqual([404, 404, 404]);
    }

    const filteredByForeignWard = await intruder.get(`/admin/beds?wardId=${owned.ward.id}`);
    expect(many(filteredByForeignWard, 'beds')).toEqual([]);

    const storedBed = await database.bed.findUniqueOrThrow({ where: { id: owned.bed.id } });
    expect(storedBed).toMatchObject({ displayName: 'Bed 101-A', hospitalId: hospitalA.hospitalId });
    const storedBuilding = await database.building.findUniqueOrThrow({
      where: { id: owned.building.id },
    });
    expect(storedBuilding.name).toBe('Main Block');
  });

  it('rejects parents that belong to another hospital', async () => {
    const owned = await createHierarchy(hospitalA, 'XPAR');
    const foreign = await createHierarchy(hospitalB, 'XPAR');
    const intruder = as(hospitalB.adminToken);

    const attempts = [
      await intruder.post('/admin/floors', {
        buildingId: owned.building.id,
        code: 'X1',
        name: 'X',
      }),
      await intruder.post('/admin/wards', { floorId: owned.floor.id, code: 'X1', name: 'X' }),
      await intruder.post('/admin/rooms', { wardId: owned.ward.id, code: 'X1', name: 'X' }),
      await intruder.post('/admin/beds', { wardId: owned.ward.id, code: 'X1', displayName: 'X' }),
      await as(hospitalA.adminToken).post('/admin/beds', {
        wardId: owned.ward.id,
        roomId: foreign.room.id,
        code: 'MIXED-1',
        displayName: 'Mixed',
      }),
    ];
    expect(attempts.map((response) => response.status)).toEqual([404, 404, 404, 404, 404]);

    const forged = await intruder.post('/admin/buildings', {
      hospitalId: hospitalA.hospitalId,
      code: 'FORGED',
      name: 'Forged',
    });
    expect(forged.status).toBe(400);
    expect(await database.building.count({ where: { code: 'FORGED' } })).toBe(0);
  });

  it('rejects a bed whose room belongs to a different ward', async () => {
    const owned = await createHierarchy(hospitalA, 'ROOM');
    const otherWard = await create(hospitalA.adminToken, '/admin/wards', 'ward', {
      floorId: owned.floor.id,
      code: 'OTHER',
      name: 'Other Ward',
    });

    const response = await as(hospitalA.adminToken).post('/admin/beds', {
      wardId: otherWard.id,
      roomId: owned.room.id,
      code: 'R-1',
      displayName: 'Wrong room',
    });

    expect(response.status).toBe(404);
  });

  it('enforces tenant-safe relationships in the database itself', async () => {
    const owned = await createHierarchy(hospitalA, 'DBFK');
    const otherWard = await database.ward.create({
      data: { hospitalId: hospitalA.hospitalId, floorId: owned.floor.id, code: 'W2', name: 'W2' },
    });
    const foreignHospitalId = hospitalB.hospitalId;

    await expect(
      database.floor.create({
        data: {
          hospitalId: foreignHospitalId,
          buildingId: owned.building.id,
          code: 'X',
          name: 'X',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      database.ward.create({
        data: { hospitalId: foreignHospitalId, floorId: owned.floor.id, code: 'X', name: 'X' },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      database.room.create({
        data: { hospitalId: foreignHospitalId, wardId: owned.ward.id, code: 'X', name: 'X' },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      database.bed.create({
        data: {
          hospitalId: hospitalA.hospitalId,
          wardId: otherWard.id,
          roomId: owned.room.id,
          code: 'X',
          displayName: 'X',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('rejects duplicate codes within a parent and allows them elsewhere', async () => {
    const owned = await createHierarchy(hospitalA, 'DUP');
    const admin = as(hospitalA.adminToken);

    const duplicateBed = await admin.post('/admin/beds', {
      wardId: owned.ward.id,
      code: '101-a',
      displayName: 'Duplicate (case-insensitive)',
    });
    expect(duplicateBed.status).toBe(409);

    const duplicateBuilding = await admin.post('/admin/buildings', {
      code: 'dup-bld',
      name: 'Duplicate',
    });
    expect(duplicateBuilding.status).toBe(409);

    const otherWard = await create(hospitalA.adminToken, '/admin/wards', 'ward', {
      floorId: owned.floor.id,
      code: 'DUP-2',
      name: 'Second Ward',
    });
    await create(hospitalA.adminToken, '/admin/beds', 'bed', {
      wardId: otherWard.id,
      code: '101-A',
      displayName: 'Same code, other ward',
    });

    const otherHospital = await createHierarchy(hospitalB, 'DUP');
    expect(otherHospital.bed.code).toBe('101-A');

    const sibling = await create(hospitalA.adminToken, '/admin/beds', 'bed', {
      wardId: owned.ward.id,
      code: '101-B',
      displayName: 'Bed 101-B',
    });
    const rename = await admin.patch(`/admin/beds/${sibling.id}`, { code: '101-A' });
    expect(rename.status).toBe(409);
  });

  it('validates inactive parents in both directions', async () => {
    const owned = await createHierarchy(hospitalA, 'INACT');
    const admin = as(hospitalA.adminToken);
    const status = async (pending: Promise<{ status: number }>) => (await pending).status;

    // A parent with active children cannot be deactivated.
    expect(await status(admin.patch(`/admin/wards/${owned.ward.id}`, { active: false }))).toBe(409);
    expect(await status(admin.patch(`/admin/floors/${owned.floor.id}`, { active: false }))).toBe(
      409,
    );
    expect(
      await status(admin.patch(`/admin/buildings/${owned.building.id}`, { active: false })),
    ).toBe(409);

    expect(await status(admin.patch(`/admin/beds/${owned.bed.id}`, { active: false }))).toBe(200);
    expect(await status(admin.patch(`/admin/rooms/${owned.room.id}`, { active: false }))).toBe(200);
    expect(await status(admin.patch(`/admin/wards/${owned.ward.id}`, { active: false }))).toBe(200);

    // No new children under an inactive parent.
    expect(
      await status(
        admin.post('/admin/beds', { wardId: owned.ward.id, code: 'NEW-1', displayName: 'New' }),
      ),
    ).toBe(409);
    expect(
      await status(admin.post('/admin/rooms', { wardId: owned.ward.id, code: 'NEW', name: 'New' })),
    ).toBe(409);

    // A child cannot be reactivated while any parent is inactive.
    expect(await status(admin.patch(`/admin/beds/${owned.bed.id}`, { active: true }))).toBe(409);
    expect(await status(admin.patch(`/admin/wards/${owned.ward.id}`, { active: true }))).toBe(200);
    expect(await status(admin.patch(`/admin/beds/${owned.bed.id}`, { active: true }))).toBe(409);
    expect(await status(admin.patch(`/admin/rooms/${owned.room.id}`, { active: true }))).toBe(200);
    expect(await status(admin.patch(`/admin/beds/${owned.bed.id}`, { active: true }))).toBe(200);

    // Floors cannot be added to an inactive building.
    const emptyBuilding = await create(hospitalA.adminToken, '/admin/buildings', 'building', {
      code: 'INACT-EMPTY',
      name: 'Closed Block',
    });
    expect(
      await status(admin.patch(`/admin/buildings/${emptyBuilding.id}`, { active: false })),
    ).toBe(200);
    expect(
      await status(
        admin.post('/admin/floors', { buildingId: emptyBuilding.id, code: 'INACT-X', name: 'X' }),
      ),
    ).toBe(409);

    const inactive = await admin.get('/admin/buildings?active=false');
    expect(many(inactive, 'buildings').map((item) => item.id)).toContain(emptyBuilding.id);
    expect(many(inactive, 'buildings').every((item) => !item.active)).toBe(true);
  });

  it('protects locations that still contain children from deletion', async () => {
    const owned = await createHierarchy(hospitalA, 'DEL');
    const admin = as(hospitalA.adminToken);

    const parents = [
      ['buildings', owned.building.id],
      ['floors', owned.floor.id],
      ['wards', owned.ward.id],
      ['rooms', owned.room.id],
    ] as const;
    for (const [path, id] of parents) {
      expect((await admin.delete(`/admin/${path}/${id}`)).status, path).toBe(409);
    }
    expect(
      await database.auditLog.count({
        where: { hospitalId: hospitalA.hospitalId, action: 'ward.delete', targetId: owned.ward.id },
      }),
    ).toBe(0);

    const leafFirst = [['beds', owned.bed.id], ...parents.slice().reverse()] as const;
    for (const [path, id] of leafFirst) {
      expect((await admin.delete(`/admin/${path}/${id}`)).status, path).toBe(204);
    }
    expect(await database.building.count({ where: { id: owned.building.id } })).toBe(0);
  });

  it('never leaves an active bed inside an inactive ward under concurrent writes', async () => {
    const owned = await createHierarchy(hospitalA, 'RACE');
    const admin = as(hospitalA.adminToken);

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const ward = await create(hospitalA.adminToken, '/admin/wards', 'ward', {
        floorId: owned.floor.id,
        code: `RACE-${attempt}`,
        name: `Race Ward ${attempt}`,
      });

      const [deactivate, createBed] = await Promise.all([
        admin.patch(`/admin/wards/${ward.id}`, { active: false }),
        admin.post('/admin/beds', { wardId: ward.id, code: 'R-1', displayName: 'Race Bed' }),
      ]);

      expect([200, 409]).toContain(deactivate.status);
      expect([201, 409]).toContain(createBed.status);
      const storedWard = await database.ward.findUniqueOrThrow({ where: { id: ward.id } });
      const activeBeds = await database.bed.count({ where: { wardId: ward.id, active: true } });
      expect(!storedWard.active && activeBeds > 0, `attempt ${attempt}`).toBe(false);
    }
  });

  it('keeps OCCUPIED reserved for the bed-session lifecycle', async () => {
    const owned = await createHierarchy(hospitalA, 'STAT');
    const admin = as(hospitalA.adminToken);
    const bedPath = `/admin/beds/${owned.bed.id}`;

    const maintenance = await admin.patch(bedPath, { status: 'MAINTENANCE' });
    expect(maintenance.status).toBe(200);
    expect(single(maintenance, 'bed')).toMatchObject({ status: 'MAINTENANCE' });
    const filtered = await admin.get(`/admin/beds?wardId=${owned.ward.id}&status=MAINTENANCE`);
    expect(many(filtered, 'beds').map((item) => item.id)).toEqual([owned.bed.id]);

    expect((await admin.patch(bedPath, { status: 'OCCUPIED' })).status).toBe(400);

    await database.bed.update({ where: { id: owned.bed.id }, data: { status: 'OCCUPIED' } });
    expect((await admin.patch(bedPath, { status: 'AVAILABLE' })).status).toBe(409);
    expect((await admin.patch(bedPath, { active: false })).status).toBe(409);
    expect((await admin.patch(bedPath, { displayName: 'Renamed' })).status).toBe(200);
  });

  it('requires authentication and the matching permission', async () => {
    const owned = await createHierarchy(hospitalA, 'PERM');
    const reader = as(readerTokenA);

    expect((await request(application).get('/admin/beds')).status).toBe(401);
    expect(
      (await request(application).get('/admin/beds').set('authorization', 'Bearer invalid')).status,
    ).toBe(401);

    expect((await reader.get('/admin/buildings')).status).toBe(200);
    expect((await reader.get(`/admin/beds/${owned.bed.id}`)).status).toBe(200);
    expect((await reader.post('/admin/buildings', { code: 'READER', name: 'X' })).status).toBe(403);
    expect((await reader.patch(`/admin/beds/${owned.bed.id}`, { displayName: 'X' })).status).toBe(
      403,
    );
    expect((await reader.delete(`/admin/rooms/${owned.room.id}`)).status).toBe(403);

    const locationOnly = as(
      await createStaffToken(database, application, hospitalA, ['location.read']),
    );
    expect((await locationOnly.get('/admin/wards')).status).toBe(200);
    expect((await locationOnly.get('/admin/beds')).status).toBe(403);
  });

  it('rejects malformed, unknown, and forged input', async () => {
    const admin = as(hospitalA.adminToken);
    const responses = [
      await admin.post('/admin/buildings', { code: 'bad code!', name: 'X' }),
      await admin.post('/admin/buildings', { code: 'OK-CODE', name: '' }),
      await admin.post('/admin/buildings', { code: 'OK-CODE', name: 'X', extra: true }),
      await admin.post('/admin/floors', { buildingId: 'not-a-uuid', code: 'X', name: 'X' }),
      await admin.post('/admin/beds', { code: 'X', displayName: 'Missing ward' }),
      await admin.post('/admin/buildings?code=X', { code: 'Q-CODE', name: 'X' }),
      await admin.get('/admin/beds?unknown=1'),
      await admin.get('/admin/beds?active=yes'),
      await admin.get('/admin/beds/not-a-uuid'),
      await admin.patch(`/admin/beds/${randomUUID()}`, {}),
      await admin.patch(`/admin/beds/${randomUUID()}`, { hospitalId: hospitalB.hospitalId }),
    ];
    expect(responses.map((response) => response.status)).toEqual(Array(11).fill(400));
  });

  it('writes an audit entry in the same transaction as every change', async () => {
    const owned = await createHierarchy(hospitalA, 'AUD');
    const admin = as(hospitalA.adminToken);
    await admin.patch(`/admin/beds/${owned.bed.id}`, { displayName: 'Audited Bed' });
    await admin.delete(`/admin/beds/${owned.bed.id}`);

    const bedEntries = await database.auditLog.findMany({
      where: { hospitalId: hospitalA.hospitalId, targetType: 'Bed', targetId: owned.bed.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(bedEntries.map((entry) => entry.action)).toEqual([
      'bed.create',
      'bed.update',
      'bed.delete',
    ]);
    for (const entry of bedEntries) {
      expect(entry.actorType).toBe('STAFF');
      expect(entry.actorMembershipId).toEqual(expect.any(String));
      expect(entry.requestId).toEqual(expect.any(String));
    }
    expect(bedEntries[1]?.metadata).toMatchObject({
      before: { displayName: 'Bed 101-A' },
      after: { displayName: 'Audited Bed' },
    });

    for (const [level, entity] of [
      ['building', owned.building],
      ['floor', owned.floor],
      ['ward', owned.ward],
      ['room', owned.room],
    ] as const) {
      expect(
        await database.auditLog.count({
          where: {
            hospitalId: hospitalA.hospitalId,
            action: `${level}.create`,
            targetId: entity.id,
          },
        }),
      ).toBe(1);
    }
    expect(
      await database.auditLog.count({
        where: { hospitalId: hospitalB.hospitalId, targetId: owned.bed.id },
      }),
    ).toBe(0);
  });
});
