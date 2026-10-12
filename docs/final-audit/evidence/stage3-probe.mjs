// Read-only source audit; all fixture writes go to a disposable audit database.
// From services/: TEST_DATABASE_URL=<disposable audit URL> node --import tsx ../docs/final-audit/evidence/stage3-probe.mjs
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from '../../../services/node_modules/supertest/index.js';
import { createApp } from '../../../services/src/app.ts';
import { createLogger } from '../../../services/src/config/logger.ts';
import { createPrismaClient } from '../../../services/src/database/prisma.ts';
import {
  createHospitalFixture,
  createPlatformToken,
  fixturePassword,
  loginStaff,
} from '../../../services/tests/support/fixtures.ts';

const url = new URL(process.env.TEST_DATABASE_URL ?? '');
assert.equal(url.pathname, '/careqr_final_audit');
assert.match(url.searchParams.get('host') ?? '', /^\/private\/tmp\/careqr-audit\.[A-Za-z0-9]+$/);
const db = createPrismaClient(url.toString());
const app = createApp({ logger: createLogger('silent'), database: db });
const results = [];
const leaks = [];
const api = (token, method, path, body) => {
  const call = request(app)[method](path);
  if (token) call.set('authorization', `Bearer ${token}`);
  return body === undefined ? call : call.send(body);
};
async function setup(token, method, path, body, expected = 201) {
  const response = await api(token, method, path, body);
  assert.equal(response.status, expected, `Fixture setup ${method} ${path}`);
  return response.body;
}
async function check(label, token, method, path, body, expected, predicate = () => true) {
  const response = await api(token, method, path, body);
  const pass = (Array.isArray(expected) ? expected.includes(response.status) : response.status === expected) && predicate(response.body);
  results.push({ label, expected, actual: response.status, pass });
  return response;
}
async function layout(hospital, code = 'F1', buildingId) {
  const token = hospital.adminToken;
  const floor = (await setup(token, 'post', '/admin/floors', {
    code, name: 'Same floor', ...(buildingId ? { buildingId } : {}),
  })).floor;
  const ward = (await setup(token, 'post', '/admin/wards', {
    floorId: floor.id, code: 'WARD', name: 'Same ward',
  })).ward;
  const room = (await setup(token, 'post', '/admin/rooms', {
    wardId: ward.id, code: 'ROOM', name: 'Same room',
  })).room;
  const bed = (await setup(token, 'post', '/admin/beds', {
    wardId: ward.id, roomId: room.id, code: 'BED', displayName: 'Same bed',
  })).bed;
  const stay = (await setup(token, 'post', '/admin/bed-sessions', { bedId: bed.id })).bedSession;
  const issued = await setup(token, 'post', `/admin/beds/${bed.id}/qr`, {});
  const scanned = await setup(null, 'post', '/public/qr/resolve', { token: issued.token });
  return { floor, ward, room, bed, stay, guest: scanned.guestToken };
}
async function member(hospital, roleKey, scopeId, departmentId, floorId) {
  const created = (await setup(hospital.adminToken, 'post', '/admin/staff', {
    email: `audit-${randomUUID()}@example.test`, displayName: 'Same staff', password: fixturePassword,
  })).staff;
  const role = await db.role.findFirstOrThrow({ where: { hospitalId: hospital.hospitalId, systemKey: roleKey } });
  await setup(hospital.adminToken, 'post', `/admin/memberships/${created.id}/roles`, {
    roleId: role.id, ...(scopeId ? { scopeId } : {}),
  });
  if (departmentId) {
    await setup(hospital.adminToken, 'post', `/admin/staff/${created.id}/departments`, { departmentId });
    await setup(hospital.adminToken, 'post', `/admin/staff/${created.id}/coverage`, { scopeType: 'FLOOR', floorId });
    await setup(hospital.adminToken, 'post', `/admin/staff/${created.id}/duty`, { dutyStatus: 'ON_DUTY' }, 200);
  }
  return { id: created.id, token: await loginStaff(app, hospital.code, created.email) };
}
async function submitted(guest, serviceId) {
  const sent = await setup(guest, 'post', '/public/requests', { serviceId });
  return db.serviceRequest.findUniqueOrThrow({ where: { publicId: sent.serviceRequest.publicId } });
}
try {
  const a = await createHospitalFixture(db, app, 'AUDIT-SAME-A');
  const b = await createHospitalFixture(db, app, 'AUDIT-SAME-B');
  const buildingA = (await setup(a.adminToken, 'post', '/admin/buildings', { code: 'BLDG', name: 'Same building' })).building;
  const buildingB = (await setup(b.adminToken, 'post', '/admin/buildings', { code: 'BLDG', name: 'Same building' })).building;
  const a1 = await layout(a, 'F1', buildingA.id);
  const b1 = await layout(b, 'F1', buildingB.id);
  const a2 = await layout(a, 'F2', buildingA.id);
  const departments = async (h) => db.department.findMany({ where: { hospitalId: h.hospitalId } });
  const departmentsA = await departments(a);
  const departmentsB = await departments(b);
  const pantryA = departmentsA.find((item) => item.name === 'Pantry');
  const nursingA = departmentsA.find((item) => item.name === 'Nursing');
  const pantryB = departmentsB.find((item) => item.name === 'Pantry');
  const waterA = await db.serviceItem.findFirstOrThrow({ where: { hospitalId: a.hospitalId, name: 'Drinking Water' } });
  const nurseA = await db.serviceItem.findFirstOrThrow({ where: { hospitalId: a.hospitalId, name: 'Nurse Assistance' } });
  const waterB = await db.serviceItem.findFirstOrThrow({ where: { hospitalId: b.hospitalId, name: 'Drinking Water' } });
  const worker1 = await member(a, 'CARE_STAFF', undefined, pantryA.id, a1.floor.id);
  const worker2 = await member(a, 'CARE_STAFF', undefined, nursingA.id, a2.floor.id);
  const workerB = await member(b, 'CARE_STAFF', undefined, pantryB.id, b1.floor.id);
  const floorManager = await member(a, 'FLOOR_MANAGER', a1.floor.id);
  const wardManager = await member(a, 'WARD_MANAGER', a1.ward.id);
  const supervisor = await member(a, 'DEPARTMENT_SUPERVISOR', pantryA.id);
  const request1 = await submitted(a1.guest, waterA.id);
  const request2 = await submitted(a2.guest, nurseA.id);
  const requestB = await submitted(b1.guest, waterB.id);
  const platform = await createPlatformToken(db, app);

  // Same names and local codes; known foreign UUIDs for every location layer.
  for (const [resource, row, edit] of [
    ['buildings', buildingB, { name: 'Forbidden edit' }],
    ['floors', b1.floor, { name: 'Forbidden edit' }],
    ['wards', b1.ward, { name: 'Forbidden edit' }],
    ['rooms', b1.room, { name: 'Forbidden edit' }],
    ['beds', b1.bed, { displayName: 'Forbidden edit' }],
  ]) {
    const list = await check(`tenant ${resource} list`, a.adminToken, 'get', `/admin/${resource}`, undefined, 200,
      (body) => body[resource].every((item) => item.hospitalId === a.hospitalId));
    assert(!list.body[resource].some((item) => item.id === row.id));
    for (const method of ['get', 'patch', 'delete']) {
      await check(`tenant ${resource} ${method} foreign UUID`, a.adminToken, method, `/admin/${resource}/${row.id}`,
        method === 'patch' ? edit : undefined, 404);
    }
  }
  const foreignRole = await db.role.findFirstOrThrow({ where: { hospitalId: b.hospitalId, systemKey: 'CARE_STAFF' } });
  const foreignPolicy = await db.slaPolicy.findFirstOrThrow({ where: { hospitalId: b.hospitalId } });
  for (const [resource, id, patch] of [
    ['departments', pantryB.id, { name: 'Forbidden edit' }],
    ['services', waterB.id, { name: 'Forbidden edit' }],
    ['roles', foreignRole.id, { description: 'Forbidden edit' }],
    ['sla-policies', foreignPolicy.id, { name: 'Forbidden edit' }],
  ]) {
    for (const method of ['get', 'patch', 'delete']) {
      await check(`tenant ${resource} ${method} foreign UUID`, a.adminToken, method, `/admin/${resource}/${id}`,
        method === 'patch' ? patch : undefined, 404);
    }
  }
  await check('tenant create foreign floor relation', a.adminToken, 'post', '/admin/wards', { floorId: b1.floor.id, code: 'BAD', name: 'Forbidden' }, 404);
  await check('tenant create foreign staff department', a.adminToken, 'post', `/admin/staff/${worker1.id}/departments`, { departmentId: pantryB.id }, 404);
  await check('tenant create foreign role assignment', a.adminToken, 'post', `/admin/memberships/${worker1.id}/roles`, { roleId: foreignRole.id }, 404);
  await check('tenant generate foreign bed QR', a.adminToken, 'post', `/admin/beds/${b1.bed.id}/qr`, {}, 404);
  await check('tenant close foreign stay', a.adminToken, 'post', `/admin/bed-sessions/${b1.stay.id}/close`, {}, 404);
  await check('tenant staff direct foreign UUID', a.adminToken, 'get', `/admin/staff/${workerB.id}`, undefined, 404);
  await check('tenant request direct foreign UUID', a.adminToken, 'get', `/admin/requests/${requestB.id}`, undefined, 404);
  await check('tenant request events foreign UUID', a.adminToken, 'get', `/admin/requests/${requestB.id}/events`, undefined, 404);
  await check('tenant report timeline foreign UUID', a.adminToken, 'get', `/admin/reports/requests/${requestB.id}`, undefined, 404);
  await check('tenant report person foreign UUID', a.adminToken, 'get', `/admin/reports/people/${workerB.id}`, undefined, 404);
  await check('tenant guest submit foreign service', a1.guest, 'post', '/public/requests', { serviceId: waterB.id }, 404);
  await check('tenant guest cancel foreign request', a1.guest, 'post', `/public/requests/${requestB.publicId}/cancel`, { reason: 'Forbidden cancellation' }, 404);
  await check('bed guest cancel another stay request', a1.guest, 'post', `/public/requests/${request2.publicId}/cancel`, { reason: 'Forbidden cancellation' }, 404);
  await check('tenant requests list', a.adminToken, 'get', '/admin/requests', undefined, 200,
    (body) => body.serviceRequests.length === 2 && body.serviceRequests.every((item) => item.id !== requestB.id));
  await check('tenant report total', a.adminToken, 'get', '/admin/reports/requests', undefined, 200,
    (body) => body.summary.total === 2);
  await check('tenant audit foreign target filter', a.adminToken, 'get', `/admin/audit-log?targetId=${b1.stay.id}`, undefined, 200,
    (body) => body.entries.length === 0);

  // Floors, wards and departments: list AND direct known out-of-scope UUID.
  for (const [name, manager] of [['floor', floorManager], ['ward', wardManager], ['department', supervisor]]) {
    await check(`${name} request list`, manager.token, 'get', '/admin/requests', undefined, 200,
      (body) => body.serviceRequests.length === 1 && body.serviceRequests[0].id === request1.id);
    await check(`${name} request direct outside scope`, manager.token, 'get', `/admin/requests/${request2.id}`, undefined, 404);
    await check(`${name} report list`, manager.token, 'get', '/admin/reports/requests', undefined, 200,
      (body) => body.summary.total === 1);
    await check(`${name} report timeline outside scope`, manager.token, 'get', `/admin/reports/requests/${request2.id}`, undefined, 404);
    await check(`${name} assign outside scope`, manager.token, 'post', `/admin/requests/${request2.id}/assign`, { assigneeId: worker2.id, expectedVersion: 1 }, 404);
    await check(`${name} audit permission`, manager.token, 'get', '/admin/audit-log', undefined, 403);
    const response = await check(`${name} person identity outside scope`, manager.token, 'get', `/admin/reports/people/${worker2.id}`, undefined, 404);
    if (response.status === 200) leaks.push({ role: name, disclosedName: response.body.person?.name, activityRows: response.body.activity?.length, assigned: response.body.work?.assigned });
  }
  for (const [name, manager] of [['floor', floorManager], ['ward', wardManager]]) {
    await check(`${name} beds list`, manager.token, 'get', '/admin/beds', undefined, 200,
      (body) => body.beds.length === 1 && body.beds[0].id === a1.bed.id);
    await check(`${name} bed direct outside scope`, manager.token, 'get', `/admin/beds/${a2.bed.id}`, undefined, 404);
    await check(`${name} close stay outside scope`, manager.token, 'post', `/admin/bed-sessions/${a2.stay.id}/close`, {}, 404);
    await check(`${name} staff directory permission`, manager.token, 'get', '/admin/staff', undefined, 403);
  }
  await check('foreign assignee rejected', a.adminToken, 'post', `/admin/requests/${request1.id}/assign`, { assigneeId: workerB.id, expectedVersion: 1 }, [400, 404]);
  await setup(a.adminToken, 'post', `/admin/requests/${request1.id}/assign`, { assigneeId: worker1.id, expectedVersion: 1 }, 200);
  await setup(a.adminToken, 'post', `/admin/requests/${request2.id}/assign`, { assigneeId: worker2.id, expectedVersion: 1 }, 200);
  await check('care staff own request list', worker1.token, 'get', '/admin/requests', undefined, 200,
    (body) => body.serviceRequests.length === 1 && body.serviceRequests[0].id === request1.id);
  await check('care staff other request UUID', worker1.token, 'get', `/admin/requests/${request2.id}`, undefined, 404);
  await check('care staff other request accept', worker1.token, 'post', `/admin/requests/${request2.id}/accept`, { expectedVersion: 2 }, 403);
  await check('care staff reports permission', worker1.token, 'get', '/admin/reports/requests', undefined, 403);

  // Auth-domain matrix belongs to Stage 2; session lifecycle is deferred.
  for (const [name, token, paths] of [
    ['platform', platform.token, ['/auth/staff/me', '/public/session']],
    ['staff', a.adminToken, ['/auth/platform/me', '/public/session']],
    ['guest', a1.guest, ['/auth/platform/me', '/auth/staff/me']],
  ]) {
    for (const path of paths) await check(`${name} token wrong domain ${path}`, token, 'get', path, undefined, 401);
  }
  for (const path of ['/admin/beds', '/admin/requests', '/admin/reports/requests', '/admin/audit-log', '/platform/clients', '/public/session']) {
    await check(`anonymous denied ${path}`, null, 'get', path, undefined, 401);
  }
  console.log(JSON.stringify({ assertions: results.length, passed: results.filter((r) => r.pass).length, failed: results.filter((r) => !r.pass), identityLeaks: leaks }, null, 2));
} finally {
  await db.$disconnect();
}
