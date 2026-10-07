import { type Prisma, type PrismaClient } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../common/errors/app-error.js';
import { recordSystemAudit } from '../audit/index.js';
import { hashPassword } from '../auth/index.js';
import { seedExampleCatalog } from '../catalog/index.js';
import { createExampleDepartments } from '../departments/index.js';
import { createBuiltInRoles, ensurePermissionCatalog, grantRole } from '../roles/index.js';
import { createStaffAccount } from '../staff/index.js';
import { HospitalRepository } from './hospital.repository.js';

// Onboarding a hospital: its client, the hospital itself, and everything it
// starts with (roles, first Hospital Manager, departments, example services).

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

// Creates a hospital in one transaction. Each part is created by the module
// that owns it, so a new hospital always starts complete and consistent.
export async function bootstrapHospital(
  database: PrismaClient,
  input: BootstrapHospitalInput,
  setup?: BootstrapHospitalSetup,
): Promise<{ hospitalId: string; adminUserId: string; clientId: string }> {
  const hospitals = new HospitalRepository();
  const code = input.code.trim().toUpperCase();
  const newClient: NewClientInput | null =
    input.client && 'id' in input.client
      ? null
      : (input.client ?? { name: input.name, code: input.code });
  const clientCode = newClient?.code.trim().toUpperCase();
  const [existingHospital, existingClient] = await Promise.all([
    hospitals.findByCode(database, code),
    clientCode ? hospitals.findClientByCode(database, clientCode) : null,
  ]);
  if (existingHospital) {
    throw new ConflictError('Hospital code or administrator email is already in use.');
  }
  if (existingClient) {
    throw new ConflictError('This client code is already in use.');
  }

  const passwordHash = await hashPassword(input.adminPassword);
  return database.$transaction(
    async (transaction) => {
      const client = newClient
        ? await hospitals.createClient(transaction, {
            name: newClient.name.trim(),
            code: clientCode!,
            contactName: newClient.contactName?.trim() || null,
            contactEmail: newClient.contactEmail?.trim().toLowerCase() || null,
            contactPhone: newClient.contactPhone?.trim() || null,
          })
        : await hospitals.findClient(transaction, (input.client as { id: string }).id);
      if (!client) throw new NotFoundError('The client was not found.');
      if (client.status !== 'ACTIVE') {
        throw new ConflictError('Reactivate this client before adding a hospital to it.');
      }
      const hospital = await hospitals.create(transaction, {
        name: input.name.trim(),
        code,
        timezone: input.timezone,
        clientId: client.id,
      });
      const admin = await createStaffAccount(transaction, {
        hospitalId: hospital.id,
        email: input.adminEmail,
        displayName: input.adminName,
        passwordHash,
      });
      await ensurePermissionCatalog(transaction);
      // The first administrator is the hospital's Hospital Manager.
      const roleIds = await createBuiltInRoles(transaction, hospital.id);
      await grantRole(transaction, {
        hospitalId: hospital.id,
        membershipId: admin.membershipId,
        roleId: roleIds.get('HOSPITAL_MANAGER')!,
        scopeType: 'HOSPITAL',
        scopeId: hospital.id,
      });
      const departmentIds = await createExampleDepartments(transaction, hospital.id);
      await seedExampleCatalog(transaction, hospital.id, departmentIds);
      await recordSystemAudit(transaction, {
        hospitalId: hospital.id,
        action: 'hospital.bootstrap',
        targetType: 'Hospital',
        targetId: hospital.id,
        metadata: { code: hospital.code, adminUserId: admin.userId },
      });
      await setup?.(transaction, {
        hospitalId: hospital.id,
        clientId: client.id,
        newClient: newClient !== null,
        adminUserId: admin.userId,
        adminMembershipId: admin.membershipId,
      });
      return { hospitalId: hospital.id, adminUserId: admin.userId, clientId: client.id };
    },
    { timeout: 30_000 },
  );
}
