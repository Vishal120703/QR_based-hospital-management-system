import { type Prisma, type ScopeType } from '@prisma/client';
import { builtInRoles, type BuiltInRoleKey } from './built-in-roles.js';
import { permissionCatalog } from './permissions.js';
import { RoleRepository } from './role.repository.js';

// Hospital setup: the permission catalog, the built-in roles, and granting a
// role without the checks a staff member is held to. For hospital onboarding,
// seeding, and super admin actions only; staff use RoleService.

type Transaction = Prisma.TransactionClient;
const repository = new RoleRepository();

// Makes sure every permission in the catalog exists. Runs when a hospital is
// created, inside its transaction.
export function ensurePermissionCatalog(transaction: Transaction): Promise<void> {
  return repository.upsertPermissions(transaction, permissionCatalog);
}

// Creates the built-in roles for a new hospital, inside its bootstrap transaction.
export async function createBuiltInRoles(
  transaction: Transaction,
  hospitalId: string,
): Promise<Map<BuiltInRoleKey, string>> {
  const ids = new Map<BuiltInRoleKey, string>();
  for (const definition of builtInRoles) {
    const role = await repository.create(transaction, {
      hospitalId,
      name: definition.name,
      description: definition.description,
      scopeLevel: definition.scopeLevel,
      systemKey: definition.key,
    });
    await repository.addPermissions(transaction, hospitalId, role.id, definition.permissions);
    ids.set(definition.key, role.id);
  }
  return ids;
}

// Gives a role to a person for one place, without the checks a staff member
// is held to: for hospital setup, seeding, and super admin actions.
export async function grantRole(
  transaction: Transaction,
  grant: {
    readonly hospitalId: string;
    readonly membershipId: string;
    readonly roleId: string;
    readonly scopeType: ScopeType;
    readonly scopeId: string;
  },
): Promise<void> {
  const userRole =
    (await repository.findUserRole(
      transaction,
      grant.hospitalId,
      grant.membershipId,
      grant.roleId,
    )) ??
    (await repository.createUserRole(transaction, {
      hospitalId: grant.hospitalId,
      membershipId: grant.membershipId,
      roleId: grant.roleId,
    }));
  await repository.createScope(transaction, grant.hospitalId, userRole.id, {
    scopeType: grant.scopeType,
    scopeId: grant.scopeId,
  });
}
