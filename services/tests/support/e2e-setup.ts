// Test data for the browser end-to-end tests (frontend/e2e): two new
// hospitals in the isolated test database, printed as JSON on stdout.
//
//   A: one floor, ward, and two beds; a patient admitted on bed A1 with a
//      printed QR; a Pantry care-staff member on duty.
//   B: another hospital (its staff must never see A's work), holding 30
//      waiting requests so its queue has more than one page.
//
// Run by frontend/e2e/global-setup.ts with DATABASE_URL set to the test
// database. Refuses anything that is not a local database.
import { randomBytes, randomUUID } from 'node:crypto';
import { createOpaqueToken, hashOpaqueToken } from '../../src/common/opaque-token.js';
import { createPrismaClient } from '../../src/database/prisma.js';
import { hashPassword } from '../../src/modules/auth/index.js';
import { bootstrapHospital } from '../../src/modules/hospitals/index.js';
import { fixturePassword } from './fixtures.js';

const url = process.env.DATABASE_URL ?? '';
if (!/^postgres(ql)?:\/\/[^@]*@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
  throw new Error('e2e-setup only runs against a local test database (DATABASE_URL).');
}
const database = createPrismaClient(url);
const suffix = randomUUID().slice(0, 6).toUpperCase();

async function hospital(label: string) {
  const code = `E2E-${label}-${suffix}`;
  const adminEmail = `admin-${code}@example.test`.toLowerCase();
  const { hospitalId, adminUserId } = await bootstrapHospital(database, {
    name: `E2E ${label} Hospital`,
    code,
    timezone: 'Asia/Kolkata',
    adminEmail,
    adminName: `${label} Manager`,
    adminPassword: fixturePassword,
  });
  const admin = await database.hospitalMembership.findFirstOrThrow({
    where: { hospitalId, userId: adminUserId },
  });
  await database.hospitalMembership.update({
    where: { id: admin.id },
    data: { dutyStatus: 'ON_DUTY' },
  });
  const floor = await database.floor.create({
    data: { hospitalId, code: 'F1', name: 'First Floor', level: 1 },
  });
  const ward = await database.ward.create({
    data: { hospitalId, floorId: floor.id, code: 'GW', name: 'General Ward' },
  });
  const bed = (code: string) =>
    database.bed.create({
      data: { hospitalId, wardId: ward.id, code, displayName: `Bed ${code}` },
    });
  return {
    hospitalId,
    code,
    adminEmail,
    adminId: admin.id,
    beds: [await bed('A1'), await bed('A2')],
  };
}

async function main() {
  const a = await hospital('A');
  const b = await hospital('B');
  const operatorEmail = `operator-${suffix}@example.test`.toLowerCase();
  const operator = await database.user.create({
    data: {
      email: operatorEmail,
      displayName: 'E2E Operator',
      passwordHash: await hashPassword(fixturePassword),
    },
  });
  await database.platformAdmin.create({ data: { userId: operator.id } });

  // A: admit a patient on bed A1 and print its QR.
  const bedA1 = a.beds[0]!;
  await database.bed.update({ where: { id: bedA1.id }, data: { status: 'OCCUPIED' } });
  await database.bedSession.create({
    data: { hospitalId: a.hospitalId, bedId: bedA1.id, startedByMembershipId: a.adminId },
  });
  const qrToken = createOpaqueToken();
  await database.bedQrCode.create({
    data: { hospitalId: a.hospitalId, bedId: bedA1.id, tokenHash: hashOpaqueToken(qrToken) },
  });

  // A: a Pantry care-staff member, on duty everywhere in the hospital.
  const nurseEmail = `pantry-${suffix}@example.test`.toLowerCase();
  const user = await database.user.create({
    data: {
      email: nurseEmail,
      displayName: 'Pavan Pantry',
      passwordHash: await hashPassword(fixturePassword),
    },
  });
  const nurse = await database.hospitalMembership.create({
    data: {
      hospitalId: a.hospitalId,
      userId: user.id,
      dutyStatus: 'ON_DUTY',
      dutyChangedAt: new Date(),
    },
  });
  const careStaff = await database.role.findFirstOrThrow({
    where: { hospitalId: a.hospitalId, systemKey: 'CARE_STAFF' },
  });
  const userRole = await database.userRole.create({
    data: { hospitalId: a.hospitalId, membershipId: nurse.id, roleId: careStaff.id },
  });
  await database.scopeAssignment.create({
    data: {
      hospitalId: a.hospitalId,
      userRoleId: userRole.id,
      scopeType: 'HOSPITAL',
      scopeId: a.hospitalId,
    },
  });
  const pantry = await database.department.findFirstOrThrow({
    where: { hospitalId: a.hospitalId, code: 'PANTRY' },
  });
  await database.staffDepartment.create({
    data: { hospitalId: a.hospitalId, membershipId: nurse.id, departmentId: pantry.id },
  });
  await database.staffLocationScope.create({
    data: { hospitalId: a.hospitalId, membershipId: nurse.id, scopeType: 'HOSPITAL' },
  });

  // B: 30 waiting requests, sent 5 hours to 4.5 hours ago (oldest first),
  // each from its own earlier stay on bed A1 of hospital B.
  const water = await database.serviceItem.findFirstOrThrow({
    where: { hospitalId: b.hospitalId, name: 'Drinking Water' },
    include: { slaPolicy: { include: { versions: { orderBy: { version: 'desc' }, take: 1 } } } },
  });
  const sla = water.slaPolicy.versions[0]!;
  const bedB = b.beds[0]!;
  const now = Date.now();
  const waitingPublicIds: string[] = [];
  for (let index = 0; index < 30; index += 1) {
    const stay = await database.bedSession.create({
      data: {
        hospitalId: b.hospitalId,
        bedId: bedB.id,
        status: 'CLOSED',
        startedByMembershipId: b.adminId,
        endedAt: new Date(),
      },
    });
    const publicId = `CR-${randomBytes(8).toString('hex').toUpperCase()}`;
    waitingPublicIds.push(publicId);
    const submittedAt = new Date(now - (300 - index) * 60_000);
    await database.serviceRequest.create({
      data: {
        publicId,
        hospitalId: b.hospitalId,
        bedId: bedB.id,
        bedSessionId: stay.id,
        serviceId: water.id,
        serviceName: water.name,
        categoryName: 'Food and Water',
        departmentId: water.departmentId,
        priority: water.priority,
        slaPolicyId: water.slaPolicyId,
        slaPolicyVersionId: sla.id,
        slaPolicyVersion: sla.version,
        acceptMinutes: sla.acceptMinutes,
        completeMinutes: sla.completeMinutes,
        submittedAt,
        // Still within target, so the order is simply oldest first.
        acceptDueAt: new Date(now + 24 * 60 * 60_000),
        completeDueAt: new Date(now + 48 * 60 * 60_000),
      },
    });
  }

  process.stdout.write(
    JSON.stringify({
      password: fixturePassword,
      operatorEmail,
      a: { code: a.code, adminEmail: a.adminEmail, nurseEmail, qrPath: `/q/${qrToken}` },
      b: { code: b.code, adminEmail: b.adminEmail, waitingPublicIds },
    }),
  );
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => void database.$disconnect());
