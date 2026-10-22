import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { z } from 'zod';
import { createApp } from '../../src/app.js';
import { createLogger } from '../../src/config/logger.js';
import { createPrismaClient } from '../../src/database/prisma.js';
import { StaffAuthService } from '../../src/modules/auth/index.js';
import { NotificationService } from '../../src/modules/notifications/index.js';
import { EscalationService } from '../../src/modules/requests/index.js';
import {
  createBedFixture,
  createHospitalFixture,
  createPatientRequest,
  createStaffToken,
  requireTestDatabaseUrl,
  type HospitalFixture,
} from '../support/fixtures.js';

// The hospital manager's Settings: each switch is enforced on the server.

const database = createPrismaClient(requireTestDatabaseUrl());
const logger = createLogger('silent');
const application = createApp({
  logger,
  database,
  qrResolveRateLimit: { windowMs: 60_000, max: 100_000 },
});
const notifications = new NotificationService(database, logger);
const escalations = new EscalationService(database);
const auth = new StaffAuthService(database);

const settingsSchema = z.object({
  settings: z.object({
    bedOccupancyEnabled: z.boolean(),
    patientRequestsPaused: z.boolean(),
    escalationsPaused: z.boolean(),
    mutedNotificationTypes: z.array(z.string()),
    patientLanguages: z.array(z.string()),
  }),
});
const errorSchema = z.object({ error: z.object({ code: z.string() }) });

function as(token: string) {
  const bearer = `Bearer ${token}`;
  return {
    get: (path: string) => request(application).get(path).set('authorization', bearer),
    post: (path: string, body: object = {}) =>
      request(application).post(path).set('authorization', bearer).send(body),
    patch: (path: string, body: object) =>
      request(application).patch(path).set('authorization', bearer).send(body),
  };
}

async function change(hospital: HospitalFixture, body: object) {
  const response = await as(hospital.adminToken).patch('/admin/hospital/settings', body);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return settingsSchema.parse(response.body).settings;
}

const settingsAudit = (hospital: HospitalFixture) =>
  database.auditLog.findMany({
    where: { hospitalId: hospital.hospitalId, action: 'hospital.settings.update' },
    orderBy: { createdAt: 'asc' },
  });

async function drinkingWater(hospital: HospitalFixture) {
  return (
    await database.serviceItem.findFirstOrThrow({
      where: { hospitalId: hospital.hospitalId, name: 'Drinking Water' },
    })
  ).id;
}

afterAll(async () => {
  await database.$disconnect();
});

describe('Hospital settings', () => {
  it('starts with nothing paused, every notification on, and both languages', async () => {
    const hospital = await createHospitalFixture(database, application, 'SET-DEFAULT');
    const profile = await as(hospital.adminToken).get('/admin/hospital');
    expect(profile.body).toMatchObject({
      hospital: {
        bedOccupancyEnabled: true,
        patientRequestsPaused: false,
        escalationsPaused: false,
        mutedNotificationTypes: [],
        patientLanguages: ['en', 'hi'],
      },
    });
    const me = await as(hospital.adminToken).get('/auth/staff/me');
    expect(me.body).toMatchObject({ tenant: { patientRequestsPaused: false } });
  });

  it('lets only a hospital manager change settings, and checks every value', async () => {
    const hospital = await createHospitalFixture(database, application, 'SET-ACCESS');
    const reader = await createStaffToken(database, application, hospital, [
      'hospital.read',
      'request.read',
    ]);
    expect(
      (await as(reader).patch('/admin/hospital/settings', { escalationsPaused: true })).status,
    ).toBe(403);
    for (const body of [
      {},
      { mutedNotificationTypes: ['NOT_A_KIND'] },
      { mutedNotificationTypes: ['SUBMITTED', 'SUBMITTED'] },
      { patientLanguages: ['hi'] },
      { patientLanguages: ['en', 'fr'] },
      { bedOccupancyEnabled: false },
    ]) {
      const response = await as(hospital.adminToken).patch('/admin/hospital/settings', body);
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    expect(await settingsAudit(hospital)).toEqual([]);
  });

  it('records each change with what it was before, and nothing for no change', async () => {
    const hospital = await createHospitalFixture(database, application, 'SET-AUDIT');
    const saved = await change(hospital, {
      escalationsPaused: true,
      mutedNotificationTypes: ['CANCELLED', 'COMPLETED'],
      patientLanguages: ['en'],
    });
    expect(saved).toMatchObject({
      escalationsPaused: true,
      mutedNotificationTypes: ['CANCELLED', 'COMPLETED'],
      patientLanguages: ['en'],
      patientRequestsPaused: false,
    });
    // Saving the same values again changes nothing and is not logged.
    await change(hospital, { escalationsPaused: true, patientLanguages: ['en'] });
    const audit = await settingsAudit(hospital);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.metadata).toEqual({
      before: {
        escalationsPaused: false,
        mutedNotificationTypes: [],
        patientLanguages: ['en', 'hi'],
      },
      after: {
        escalationsPaused: true,
        mutedNotificationTypes: ['CANCELLED', 'COMPLETED'],
        patientLanguages: ['en'],
      },
    });
  });

  it('pauses new patient requests while existing ones can still be cancelled', async () => {
    const hospital = await createHospitalFixture(database, application, 'SET-PAUSE');
    const { bedId } = await createBedFixture(database, hospital);
    const sent = await createPatientRequest(
      database,
      application,
      hospital,
      bedId,
      'Drinking Water',
    );
    const serviceId = await drinkingWater(hospital);

    await change(hospital, { patientRequestsPaused: true, patientLanguages: ['en'] });
    const session = await as(sent.guestToken).get('/public/session');
    expect(session.body).toMatchObject({ location: { requestsPaused: true, languages: ['en'] } });
    const me = await as(hospital.adminToken).get('/auth/staff/me');
    expect(me.body).toMatchObject({ tenant: { patientRequestsPaused: true } });

    // The open request is returned (no new one), and a new kind is refused.
    const other = await database.serviceItem.findFirstOrThrow({
      where: { hospitalId: hospital.hospitalId, active: true, id: { not: serviceId } },
    });
    const refused = await as(sent.guestToken).post('/public/requests', { serviceId: other.id });
    expect(refused.status).toBe(409);
    expect(errorSchema.parse(refused.body).error.code).toBe('PATIENT_REQUESTS_PAUSED');
    const cancelled = await as(sent.guestToken).post(`/public/requests/${sent.publicId}/cancel`, {
      reason: 'No longer needed',
    });
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);

    await change(hospital, { patientRequestsPaused: false });
    const accepted = await as(sent.guestToken).post('/public/requests', { serviceId: other.id });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);
    expect((await as(sent.guestToken).get('/public/session')).body).toMatchObject({
      location: { requestsPaused: false },
    });
  });

  it('sends no notification of a kind the hospital turned off', async () => {
    const hospital = await createHospitalFixture(database, application, 'SET-NOTIFY');
    const { bedId } = await createBedFixture(database, hospital);
    const manager = await auth.authenticate(hospital.adminToken);
    await database.hospitalMembership.update({
      where: { id: manager.membershipId },
      data: { dutyStatus: 'ON_DUTY' },
    });
    // Processes the request's "sent" event: how many were notified, and how
    // the event was settled.
    const notifiedFor = async (requestId: string) => {
      const event = await database.requestEvent.findFirstOrThrow({ where: { requestId } });
      const sourceKey = `event:${event.id}`;
      await notifications.process({ id: event.id, sourceKey, kind: 'event' });
      const receipt = await database.notificationDispatch.findUniqueOrThrow({
        where: { sourceKey },
      });
      return {
        notified: await database.staffNotification.count({ where: { sourceKey } }),
        outcome: receipt.outcome,
      };
    };

    await change(hospital, { mutedNotificationTypes: ['SUBMITTED'] });
    const quiet = await createPatientRequest(
      database,
      application,
      hospital,
      bedId,
      'Drinking Water',
    );
    // Settled at once, so it is not retried later either.
    expect(await notifiedFor(quiet.id)).toEqual({ notified: 0, outcome: 'NOT_ACTIONABLE' });

    await change(hospital, { mutedNotificationTypes: [] });
    const { bedId: nextBed } = await createBedFixture(database, hospital, '102');
    const heard = await createPatientRequest(
      database,
      application,
      hospital,
      nextBed,
      'Drinking Water',
    );
    expect(await notifiedFor(heard.id)).toEqual({ notified: 1, outcome: 'CREATED' });
  });

  it('does not escalate overdue requests while escalations are paused', async () => {
    const hospital = await createHospitalFixture(database, application, 'SET-ESCALATE');
    const { bedId } = await createBedFixture(database, hospital);
    const roles = await database.role.findMany({
      where: { hospitalId: hospital.hospitalId, systemKey: 'HOSPITAL_MANAGER' },
    });
    const policy = await as(hospital.adminToken).post('/admin/escalation-policies', {
      name: 'Immediate',
      levels: [{ targetType: 'ROLE', roleId: roles[0]!.id, afterMinutes: 0 }],
    });
    expect(policy.status, JSON.stringify(policy.body)).toBe(201);
    const policyId = z.object({ escalationPolicy: z.object({ id: z.string() }) }).parse(policy.body)
      .escalationPolicy.id;
    await as(hospital.adminToken).patch(`/admin/services/${await drinkingWater(hospital)}`, {
      escalationPolicyId: policyId,
    });
    const sent = await createPatientRequest(
      database,
      application,
      hospital,
      bedId,
      'Drinking Water',
    );
    await database.serviceRequest.update({
      where: { id: sent.id },
      data: { acceptDueAt: new Date(Date.now() - 10 * 60_000) },
    });
    const steps = () => database.requestEscalation.count({ where: { requestId: sent.id } });

    await change(hospital, { escalationsPaused: true });
    await escalations.run();
    expect(await steps()).toBe(0);

    // Turned back on, a request that is still overdue escalates.
    await change(hospital, { escalationsPaused: false });
    await escalations.run();
    expect(await steps()).toBe(1);
  });
});
