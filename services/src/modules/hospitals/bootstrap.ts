import { type Prisma, type PrismaClient } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../common/errors/app-error.js';
import { hashPassword } from '../auth/password.js';
import { seedExampleCatalog } from '../catalog/examples.js';
import { exampleDepartments } from '../departments/department.service.js';
import { createBuiltInRoles } from '../roles/built-in-roles.js';
import { permissionCatalog } from '../roles/permissions.js';

export interface NewClientInput {
  readonly name: string;
  readonly code: string;
  readonly contactName?: string | undefined;
  readonly contactEmail?: string | undefined;
  readonly contactPhone?: string | undefined;
}

export interface BootstrapHospitalInput {
  readonly name: string;
  readonly code: string;
  readonly timezone: string;
  readonly adminEmail: string;
  readonly adminName: string;
  readonly adminPassword: string;
  // The client (customer) that owns the hospital: an existing one, or a new
  // one. Without it, a new client is created with the hospital's name and code.
  readonly client?: { readonly id: string } | NewClientInput;
}

export interface BootstrapCreatedHospital {
  readonly hospitalId: string;
  readonly clientId: string;
  readonly newClient: boolean;
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
): Promise<{ hospitalId: string; adminUserId: string; clientId: string }> {
  const email = input.adminEmail.trim().toLowerCase();
  const code = input.code.trim().toUpperCase();
  const newClient: NewClientInput | null =
    input.client && 'id' in input.client
      ? null
      : (input.client ?? { name: input.name, code: input.code });
  const clientCode = newClient?.code.trim().toUpperCase();
  const [existingHospital, existingUser, existingClient] = await Promise.all([
    database.hospital.findUnique({ where: { code } }),
    database.user.findUnique({ where: { email } }),
    clientCode ? database.client.findUnique({ where: { code: clientCode } }) : null,
  ]);
  if (existingHospital || existingUser) {
    throw new ConflictError('Hospital code or administrator email is already in use.');
  }
  if (existingClient) {
    throw new ConflictError('This client code is already in use.');
  }

  const passwordHash = await hashPassword(input.adminPassword);
  return database.$transaction(
    async (transaction) => {
      const client = newClient
        ? await transaction.client.create({
            data: {
              name: newClient.name.trim(),
              code: clientCode!,
              contactName: newClient.contactName?.trim() || null,
              contactEmail: newClient.contactEmail?.trim().toLowerCase() || null,
              contactPhone: newClient.contactPhone?.trim() || null,
            },
          })
        : await transaction.client.findUnique({
            where: { id: (input.client as { id: string }).id },
          });
      if (!client) throw new NotFoundError('The client was not found.');
      if (client.status !== 'ACTIVE') {
        throw new ConflictError('Reactivate this client before adding a hospital to it.');
      }
      const hospital = await transaction.hospital.create({
        data: { name: input.name.trim(), code, timezone: input.timezone, clientId: client.id },
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
        clientId: client.id,
        newClient: newClient !== null,
        adminUserId: user.id,
        adminMembershipId: membership.id,
      });
      return { hospitalId: hospital.id, adminUserId: user.id, clientId: client.id };
    },
    { timeout: 30_000 },
  );
}
