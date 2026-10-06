import { type PrismaClient } from '@prisma/client';
import { createOpaqueToken, hashOpaqueToken } from '../../common/opaque-token.js';
import { hashPassword } from '../auth/password.js';
import { type BuiltInRoleKey } from '../roles/built-in-roles.js';
import { bootstrapHospital } from './bootstrap.js';

export const demoHospital = {
  name: 'CARE QR Demo Hospital',
  code: 'CAREQR-DEMO',
  timezone: 'Asia/Kolkata',
  adminEmail: 'admin.demo@careqr.example',
  adminName: 'Demo Administrator',
  managerEmail: 'floor.manager.demo@careqr.example',
  wardManagerEmail: 'ward.manager.demo@careqr.example',
  supervisorEmail: 'pantry.supervisor.demo@careqr.example',
  platformEmail: 'platform.demo@careqr.example',
} as const;

const demoStaff = [
  { email: 'nurse.demo@careqr.example', name: 'Demo Nurse', departmentCode: 'NURSING' },
  { email: 'pantry.demo@careqr.example', name: 'Demo Pantry Staff', departmentCode: 'PANTRY' },
  {
    email: 'housekeeping.demo@careqr.example',
    name: 'Demo Housekeeping Staff',
    departmentCode: 'HOUSEKEEPING',
  },
  {
    email: 'transport.demo@careqr.example',
    name: 'Demo Transport Staff',
    departmentCode: 'TRANSPORT',
  },
] as const;

export interface DemoSeedInput {
  readonly adminPassword: string;
  readonly staffPassword: string;
  readonly publicAppUrl: string;
}

export interface DemoSeedResult {
  readonly hospitalId: string;
  readonly hospitalCode: string;
  readonly adminEmail: string;
  readonly managerEmail: string;
  readonly wardManagerEmail: string;
  readonly supervisorEmail: string;
  readonly staff: readonly { email: string; departmentCode: string }[];
  readonly occupiedBedId: string;
  readonly availableBedId: string;
  readonly bedSessionId: string;
  // Bearer secret: caller must show it only after explicit opt-in.
  readonly qrToken: string;
  readonly qrUrl: string;
}

/**
 * Creates a brand-new, isolated local testing hospital. bootstrapHospital
 * refuses an existing code/email, and its transaction includes every demo
 * record. A failed or repeated run never updates the existing demo hospital.
 */
export async function seedDemoHospital(
  database: PrismaClient,
  input: DemoSeedInput,
): Promise<DemoSeedResult> {
  const qrToken = createOpaqueToken();
  const staffPasswordHashes = await Promise.all(
    demoStaff.map(() => hashPassword(input.staffPassword)),
  );
  const managerPasswordHash = await hashPassword(input.staffPassword);
  let details:
    Pick<DemoSeedResult, 'occupiedBedId' | 'availableBedId' | 'bedSessionId'> | undefined;

  const { hospitalId } = await bootstrapHospital(
    database,
    {
      name: demoHospital.name,
      code: demoHospital.code,
      timezone: demoHospital.timezone,
      adminEmail: demoHospital.adminEmail,
      adminName: demoHospital.adminName,
      adminPassword: input.adminPassword,
    },
    async (transaction, created) => {
      const building = await transaction.building.create({
        data: { hospitalId: created.hospitalId, code: 'DEMO-WING', name: 'Demo Wing' },
      });
      const floor = await transaction.floor.create({
        data: {
          hospitalId: created.hospitalId,
          buildingId: building.id,
          code: 'F1',
          name: 'First Floor',
          level: 1,
        },
      });
      const ward = await transaction.ward.create({
        data: {
          hospitalId: created.hospitalId,
          floorId: floor.id,
          code: 'WARD-A',
          name: 'General Ward',
          unitType: 'GENERAL',
        },
      });
      const room = await transaction.room.create({
        data: {
          hospitalId: created.hospitalId,
          wardId: ward.id,
          code: 'R101',
          name: 'Room 101',
        },
      });
      const occupiedBed = await transaction.bed.create({
        data: {
          hospitalId: created.hospitalId,
          wardId: ward.id,
          roomId: room.id,
          code: 'BED-01',
          displayName: 'Bed 01',
          status: 'OCCUPIED',
        },
      });
      const availableBed = await transaction.bed.create({
        data: {
          hospitalId: created.hospitalId,
          wardId: ward.id,
          roomId: room.id,
          code: 'BED-02',
          displayName: 'Bed 02',
        },
      });
      const bedSession = await transaction.bedSession.create({
        data: {
          hospitalId: created.hospitalId,
          bedId: occupiedBed.id,
          startedByMembershipId: created.adminMembershipId,
        },
      });
      await transaction.bedQrCode.create({
        data: {
          hospitalId: created.hospitalId,
          bedId: occupiedBed.id,
          tokenHash: hashOpaqueToken(qrToken),
        },
      });

      const departments = await transaction.department.findMany({
        where: { hospitalId: created.hospitalId },
        select: { id: true, code: true },
      });
      const departmentIdByCode = new Map(
        departments.map((department) => [department.code, department.id]),
      );
      // Demo people use the built-in role hierarchy every hospital gets.
      const builtIn = await transaction.role.findMany({
        where: { hospitalId: created.hospitalId, systemKey: { not: null } },
        select: { id: true, systemKey: true },
      });
      const roleId = (key: BuiltInRoleKey) => {
        const found = builtIn.find((role) => role.systemKey === key);
        if (!found) throw new Error(`Built-in role ${key} is missing.`);
        return found.id;
      };
      const giveRole = async (
        membershipId: string,
        key: BuiltInRoleKey,
        scope: { scopeType: 'HOSPITAL' | 'FLOOR' | 'WARD' | 'DEPARTMENT'; scopeId: string },
      ) => {
        const userRole = await transaction.userRole.create({
          data: { hospitalId: created.hospitalId, membershipId, roleId: roleId(key) },
        });
        await transaction.scopeAssignment.create({
          data: { hospitalId: created.hospitalId, userRoleId: userRole.id, ...scope },
        });
      };
      const pantryId = departmentIdByCode.get('PANTRY');
      if (!pantryId) throw new Error('Demo department PANTRY was not bootstrapped.');
      const managers = [
        {
          email: demoHospital.managerEmail,
          name: 'Demo Floor Manager',
          key: 'FLOOR_MANAGER',
          scope: { scopeType: 'FLOOR', scopeId: floor.id },
        },
        {
          email: demoHospital.wardManagerEmail,
          name: 'Demo Ward Manager',
          key: 'WARD_MANAGER',
          scope: { scopeType: 'WARD', scopeId: ward.id },
        },
        {
          email: demoHospital.supervisorEmail,
          name: 'Demo Pantry Supervisor',
          key: 'DEPARTMENT_SUPERVISOR',
          scope: { scopeType: 'DEPARTMENT', scopeId: pantryId },
        },
      ] as const;
      for (const manager of managers) {
        const user = await transaction.user.create({
          data: {
            email: manager.email,
            displayName: manager.name,
            passwordHash: managerPasswordHash,
          },
        });
        const membership = await transaction.hospitalMembership.create({
          data: { hospitalId: created.hospitalId, userId: user.id },
        });
        await giveRole(membership.id, manager.key, manager.scope);
      }

      for (const [index, staff] of demoStaff.entries()) {
        const departmentId = departmentIdByCode.get(staff.departmentCode);
        if (!departmentId) {
          throw new Error(`Demo department ${staff.departmentCode} was not bootstrapped.`);
        }
        const user = await transaction.user.create({
          data: {
            email: staff.email,
            displayName: staff.name,
            passwordHash: staffPasswordHashes[index]!,
          },
        });
        const membership = await transaction.hospitalMembership.create({
          data: {
            hospitalId: created.hospitalId,
            userId: user.id,
            dutyStatus: 'ON_DUTY',
            dutyChangedAt: new Date(),
          },
        });
        await transaction.staffDepartment.create({
          data: {
            hospitalId: created.hospitalId,
            membershipId: membership.id,
            departmentId,
          },
        });
        await transaction.staffLocationScope.create({
          data: {
            hospitalId: created.hospitalId,
            membershipId: membership.id,
            scopeType: 'WARD',
            wardId: ward.id,
          },
        });
        await giveRole(membership.id, 'CARE_STAFF', {
          scopeType: 'HOSPITAL',
          scopeId: created.hospitalId,
        });
      }

      await transaction.hospitalSetting.create({
        data: {
          hospitalId: created.hospitalId,
          key: 'demo.seed',
          value: { version: 1, purpose: 'local-manual-testing' },
        },
      });
      await transaction.auditLog.create({
        data: {
          hospitalId: created.hospitalId,
          actorType: 'SYSTEM',
          action: 'demo.seed',
          targetType: 'Hospital',
          targetId: created.hospitalId,
          metadata: {
            occupiedBedId: occupiedBed.id,
            availableBedId: availableBed.id,
            staffCount: demoStaff.length,
          },
        },
      });
      details = {
        occupiedBedId: occupiedBed.id,
        availableBedId: availableBed.id,
        bedSessionId: bedSession.id,
      };
    },
  );

  if (!details) {
    throw new Error('Demo hospital setup did not complete.');
  }
  return {
    hospitalId,
    hospitalCode: demoHospital.code,
    adminEmail: demoHospital.adminEmail,
    managerEmail: demoHospital.managerEmail,
    wardManagerEmail: demoHospital.wardManagerEmail,
    supervisorEmail: demoHospital.supervisorEmail,
    staff: demoStaff.map(({ email, departmentCode }) => ({ email, departmentCode })),
    ...details,
    qrToken,
    qrUrl: `${input.publicAppUrl.replace(/\/+$/, '')}/q/${qrToken}`,
  };
}

// Optional demo platform operator (super admin), for trying client onboarding.
export async function seedDemoPlatformAdmin(
  database: PrismaClient,
  password: string,
): Promise<string> {
  const email = demoHospital.platformEmail;
  const passwordHash = await hashPassword(password);
  await database.$transaction(async (transaction) => {
    if (await transaction.user.findUnique({ where: { email } })) return;
    const user = await transaction.user.create({
      data: { email, displayName: 'Demo Platform Admin', passwordHash },
    });
    await transaction.platformAdmin.create({ data: { userId: user.id } });
  });
  return email;
}
