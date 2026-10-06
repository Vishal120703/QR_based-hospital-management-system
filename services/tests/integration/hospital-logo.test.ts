import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
const application = createApp({ logger: createLogger('silent'), database });

// A valid 1×1 PNG.
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

let hospitalA: HospitalFixture;
let hospitalB: HospitalFixture;

const logoSchema = z.object({ logoUrl: z.string().regex(/^\/public\/logos\/[0-9a-f-]{36}$/) });

function upload(token: string, body: Buffer, type = 'image/png') {
  return request(application)
    .put('/admin/hospital/logo')
    .set('authorization', `Bearer ${token}`)
    .set('content-type', type)
    .send(body);
}

beforeAll(async () => {
  hospitalA = await createHospitalFixture(database, application, 'LOGO-A');
  hospitalB = await createHospitalFixture(database, application, 'LOGO-B');
});

afterAll(async () => {
  await database.$disconnect();
});

describe('Hospital logo (SaaS branding)', () => {
  it('stores a logo, serves it publicly by an unguessable URL, and shows it to staff', async () => {
    const uploaded = await upload(hospitalA.adminToken, png);
    expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(200);
    const { logoUrl } = logoSchema.parse(uploaded.body);

    const served = await request(application).get(logoUrl).buffer(true);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(served.headers['cache-control']).toContain('immutable');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(served.headers['content-security-policy']).toContain('sandbox');
    expect(Buffer.from(served.body as Buffer).equals(png)).toBe(true);

    const me = await request(application)
      .get('/auth/staff/me')
      .set('authorization', `Bearer ${hospitalA.adminToken}`);
    expect(me.body).toMatchObject({ tenant: { logoUrl } });
    const hospital = await request(application)
      .get('/admin/hospital')
      .set('authorization', `Bearer ${hospitalA.adminToken}`);
    expect(hospital.body).toMatchObject({ hospital: { logoUrl } });

    // Another hospital is unaffected.
    const other = await request(application)
      .get('/auth/staff/me')
      .set('authorization', `Bearer ${hospitalB.adminToken}`);
    expect(other.body).toMatchObject({ tenant: { logoUrl: null } });

    expect(
      await database.auditLog.count({
        where: { hospitalId: hospitalA.hospitalId, action: 'hospital.logo.update' },
      }),
    ).toBe(1);
  });

  it('retires the old URL when the logo is replaced, and removes it on delete', async () => {
    const first = logoSchema.parse((await upload(hospitalA.adminToken, png)).body).logoUrl;
    const second = await upload(hospitalA.adminToken, jpeg, 'image/jpeg');
    expect(second.status).toBe(200);
    const replaced = logoSchema.parse(second.body).logoUrl;
    expect(replaced).not.toBe(first);
    expect((await request(application).get(first)).status).toBe(404);
    expect((await request(application).get(replaced)).headers['content-type']).toBe('image/jpeg');

    const admin = (path: string) =>
      request(application).delete(path).set('authorization', `Bearer ${hospitalA.adminToken}`);
    expect((await admin('/admin/hospital/logo')).status).toBe(204);
    expect((await request(application).get(replaced)).status).toBe(404);
    expect((await admin('/admin/hospital/logo')).status).toBe(404);
  });

  it('accepts only real PNG, JPEG, or WebP files up to 1 MB', async () => {
    // The declared type is ignored; the bytes decide.
    expect((await upload(hospitalA.adminToken, svg, 'image/svg+xml')).status).toBe(400);
    expect((await upload(hospitalA.adminToken, svg, 'image/png')).status).toBe(400);
    expect((await upload(hospitalA.adminToken, Buffer.alloc(0))).status).toBe(400);
    const huge = Buffer.concat([png, Buffer.alloc(1024 * 1024)]);
    expect((await upload(hospitalA.adminToken, huge)).status).toBe(413);
    expect((await request(application).get('/public/logos/not-a-uuid')).status).toBe(404);
  });

  it('needs hospital.manage to change the logo', async () => {
    const reader = await createStaffToken(database, application, hospitalA, ['hospital.read']);
    expect((await upload(reader, png)).status).toBe(403);
    expect(
      (
        await request(application)
          .put('/admin/hospital/logo')
          .set('content-type', 'image/png')
          .send(png)
      ).status,
    ).toBe(401);
  });

  it('shows the logo on the patient page', async () => {
    const { logoUrl } = logoSchema.parse((await upload(hospitalB.adminToken, png)).body);
    const { bedId } = await createBedFixture(database, hospitalB);
    const admin = (path: string, body: object) =>
      request(application)
        .post(path)
        .set('authorization', `Bearer ${hospitalB.adminToken}`)
        .send(body);
    const qr = z
      .object({ token: z.string() })
      .parse((await admin(`/admin/beds/${bedId}/qr`, {})).body);
    expect((await admin('/admin/bed-sessions', { bedId })).status).toBe(201);
    const resolved = await request(application)
      .post('/public/qr/resolve')
      .send({ token: qr.token });
    expect(resolved.status, JSON.stringify(resolved.body)).toBe(201);
    expect(resolved.body).toMatchObject({ location: { hospitalLogoUrl: logoUrl } });
  });

  it('refuses anything but raster images in the database itself', async () => {
    await expect(
      database.hospitalLogo.upsert({
        where: { hospitalId: hospitalB.hospitalId },
        create: {
          hospitalId: hospitalB.hospitalId,
          contentType: 'image/svg+xml',
          data: svg,
          byteSize: svg.length,
        },
        update: { contentType: 'image/svg+xml', data: svg, byteSize: svg.length },
      }),
    ).rejects.toThrow();
  });
});
