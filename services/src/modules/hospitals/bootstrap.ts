import { type Prisma, type PrismaClient } from '@prisma/client';
import { ConflictError } from '../../common/errors/app-error.js';
import { hashPassword } from '../auth/password.js';
import { seedExampleCatalog } from '../catalog/examples.js';
import { exampleDepartments } from '../departments/department.service.js';
import { createBuiltInRoles } from '../roles/built-in-roles.js';
import { permissionCatalog } from '../roles/permissions.js';

export interface BootstrapHospitalInput {
  readonly name: string;
  readonly code: string;
  readonly timezone: string;
  readonly adminEmail: string;
  readonly adminName: string;
  readonly adminPassword: string;
}

export interface BootstrapCreatedHospital {
  readonly hospitalId: string;
  readonly adminUserId: string;
  readonly adminMembershipId: string;
}

// Additional first-hospital setup runs inside the bootstrap transaction. A
// failed demo seed therefore cannot leave a partially configured hospital.
export type BootstrapHospitalSetup = (
  transaction: Prisma.TransactionClient,
  created: BootstrapCreatedHospital,
) => Promise<void>;

export async function bootstrapHospital(
  database: PrismaClient,
  input: BootstrapHospitalInput,
  setup?: BootstrapHospitalSetup,
): Promise<{ hospitalId: string; adminUserId: string }> {
  const email = input.adminEmail.trim().toLowerCase();
  const code = input.code.trim().toUpperCase();
  const [existingHospital, existingUser] = await Promise.all([
    database.hospital.findUnique({ where: { code } }),
    database.user.findUnique({ where: { email } }),
  ]);
  if (existingHospital || existingUser) {
    throw new ConflictError('Hospital code or administrator email is already in use.');
  }

  const passwordHash = await hashPassword(input.adminPassword);
  return database.$transaction(
    async (transaction) => {
      const hospital = await transaction.hospital.create({
        data: { name: input.name.trim(), code, timezone: input.timezone },
      });
      const user = await transaction.user.create({
        data: {
          email,
          displayName: input.adminName.trim(),
          passwordHash,
        },
      });
      const membership = await transaction.hospitalMembership.create({
        data: { hospitalId: hospital.id, userId: user.id },
      });
      await Promise.all(
        permissionCatalog.map(([key, description]) =>
          transaction.permission.upsert({
            where: { key },
            create: { key, description },
            update: { description },
          }),
        ),
      );
      // The first administrator is the hospital's Hospital Manager.
      const roleIds = await createBuiltInRoles(transaction, hospital.id);
      const userRole = await transaction.userRole.create({
        data: {
          hospitalId: hospital.id,
          membershipId: membership.id,
          roleId: roleIds.get('HOSPITAL_MANAGER')!,
        },
      });
      await transaction.scopeAssignment.create({
        data: {
          hospitalId: hospital.id,
          userRoleId: userRole.id,
          scopeType: 'HOSPITAL',
          scopeId: hospital.id,
        },
      });
      const departments = await transaction.department.createManyAndReturn({
        data: exampleDepartments.map(([code, name]) => ({ hospitalId: hospital.id, code, name })),
      });
      await seedExampleCatalog(
        transaction,
        hospital.id,
        new Map(departments.map((department) => [department.code, department.id])),
      );
      await transaction.auditLog.create({
        data: {
          hospitalId: hospital.id,
          actorType: 'SYSTEM',
          action: 'hospital.bootstrap',
          targetType: 'Hospital',
          targetId: hospital.id,
          metadata: { code: hospital.code, adminUserId: user.id },
        },
      });
      await setup?.(transaction, {
        hospitalId: hospital.id,
        adminUserId: user.id,
        adminMembershipId: membership.id,
      });
      return { hospitalId: hospital.id, adminUserId: user.id };
    },
    { timeout: 30_000 },
  );
}
