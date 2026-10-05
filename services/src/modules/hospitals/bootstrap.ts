import { type PrismaClient } from '@prisma/client';
import { ConflictError } from '../../common/errors/app-error.js';
import { hashPassword } from '../auth/password.js';
import { seedExampleCatalog } from '../catalog/examples.js';
import { exampleDepartments } from '../departments/department.service.js';
import { permissionCatalog } from '../roles/permissions.js';

export interface BootstrapHospitalInput {
  readonly name: string;
  readonly code: string;
  readonly timezone: string;
  readonly adminEmail: string;
  readonly adminName: string;
  readonly adminPassword: string;
}

export async function bootstrapHospital(
  database: PrismaClient,
  input: BootstrapHospitalInput,
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
  return database.$transaction(async (transaction) => {
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
    const role = await transaction.role.create({
      data: { hospitalId: hospital.id, name: 'Hospital Admin' },
    });
    await transaction.rolePermission.createMany({
      data: permissionCatalog.map(([permissionKey]) => ({
        hospitalId: hospital.id,
        roleId: role.id,
        permissionKey,
      })),
    });
    const userRole = await transaction.userRole.create({
      data: {
        hospitalId: hospital.id,
        membershipId: membership.id,
        roleId: role.id,
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
    return { hospitalId: hospital.id, adminUserId: user.id };
  });
}
