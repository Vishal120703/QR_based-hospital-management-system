import {
  type Prisma,
  type PrismaClient,
  type RoleScopeLevel,
  type ScopeType,
} from '@prisma/client';
import {
  ConflictError,
  ForbiddenError,
  InvalidInputError,
  NotFoundError,
} from '../../common/errors/app-error.js';
import { recordStaffAudit } from '../audit/index.js';
import { type StaffContext } from '../auth/index.js';
import { builtInRoles, lockedRoleKey, type BuiltInRoleKey } from './built-in-roles.js';
import { permissionCatalog } from './permissions.js';
import { RoleRepository, type RoleRow } from './role.repository.js';
import { type CreateRoleInput, type UpdateRoleInput } from './role.schemas.js';

type Transaction = Prisma.TransactionClient;
const repository = new RoleRepository();

function toView({ rolePermissions, _count, ...role }: RoleRow) {
  return {
    ...role,
    permissionKeys: rolePermissions.map((item) => item.permissionKey).sort(),
    // Kept for older clients that read the raw relation.
    rolePermissions,
    memberCount: _count.userRoles,
    builtIn: role.systemKey !== null,
    locked: role.systemKey === lockedRoleKey,
  };
}

const scopeTypeFor: Record<RoleScopeLevel, ScopeType> = {
  HOSPITAL: 'HOSPITAL',
  FLOOR: 'FLOOR',
  WARD: 'WARD',
  DEPARTMENT: 'DEPARTMENT',
};

// Nobody may hand out, change, or take away more power than they hold
// hospital-wide.
const exceedsCaller = (
  context: StaffContext,
  permissions: readonly { readonly permissionKey: string }[],
) => permissions.some((item) => !context.hospitalPermissions.has(item.permissionKey));

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

export class RoleService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly roles = repository,
  ) {}

  public async list(context: StaffContext) {
    const roles = await this.roles.list(this.database, context.tenant.hospitalId);
    // Built-in roles in hierarchy order, then the hospital's own roles by name.
    const rank = (role: RoleRow) => {
      const index = builtInRoles.findIndex((item) => item.key === role.systemKey);
      return index < 0 ? builtInRoles.length : index;
    };
    return roles.sort((left, right) => rank(left) - rank(right)).map(toView);
  }

  public async get(context: StaffContext, id: string) {
    const role = await this.roles.findById(this.database, context.tenant.hospitalId, id);
    if (!role) {
      throw new NotFoundError();
    }
    return toView(role);
  }

  public async create(context: StaffContext, input: CreateRoleInput, requestId: string) {
    const hospitalId = context.tenant.hospitalId;
    const permissionKeys = [...new Set(input.permissionKeys ?? [])];
    await this.validatePermissionGrant(context, permissionKeys);

    return this.database.$transaction(async (transaction) => {
      const role = await this.roles.create(transaction, {
        hospitalId,
        name: input.name,
        ...(input.description !== undefined ? { description: input.description } : {}),
        active: input.active ?? true,
        scopeLevel: input.scopeLevel ?? 'HOSPITAL',
      });
      await this.roles.addPermissions(transaction, hospitalId, role.id, permissionKeys);
      await recordStaffAudit(transaction, context, requestId, {
        action: 'role.create',
        targetType: 'Role',
        targetId: role.id,
        metadata: { name: role.name, scopeLevel: role.scopeLevel, permissionKeys },
      });
      return toView((await this.roles.findById(transaction, hospitalId, role.id))!);
    });
  }

  public async update(
    context: StaffContext,
    id: string,
    input: UpdateRoleInput,
    requestId: string,
  ) {
    const hospitalId = context.tenant.hospitalId;
    const permissionKeys = input.permissionKeys && [...new Set(input.permissionKeys)];
    if (permissionKeys) {
      await this.validatePermissionGrant(context, permissionKeys);
    }

    return this.database.$transaction(
      async (transaction) => {
        const existing = await this.roles.findById(transaction, hospitalId, id);
        if (!existing) {
          throw new NotFoundError();
        }
        if (existing.systemKey === lockedRoleKey) {
          throw new ConflictError(
            'The Hospital Manager role always has every permission and cannot be changed.',
          );
        }
        // Nobody may weaken or reshape a role more powerful than their own.
        if (exceedsCaller(context, existing.rolePermissions)) {
          throw new ForbiddenError();
        }
        if (existing.systemKey && (input.name !== undefined || input.scopeLevel !== undefined)) {
          throw new ConflictError(
            'Built-in roles keep their name and level. Create a new role instead.',
          );
        }
        if (
          input.scopeLevel !== undefined &&
          input.scopeLevel !== existing.scopeLevel &&
          existing._count.userRoles > 0
        ) {
          throw new ConflictError(
            'Remove this role from everyone before changing where it applies.',
          );
        }
        if (input.active === true && !existing.active) {
          const effectivePermissions =
            permissionKeys ?? existing.rolePermissions.map((item) => item.permissionKey);
          if (effectivePermissions.some((key) => !context.hospitalPermissions.has(key))) {
            throw new ForbiddenError();
          }
        }
        await this.roles.update(transaction, hospitalId, id, {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
          ...(input.scopeLevel !== undefined ? { scopeLevel: input.scopeLevel } : {}),
        });
        if (permissionKeys) {
          await this.roles.removePermissions(transaction, hospitalId, id);
          await this.roles.addPermissions(transaction, hospitalId, id, permissionKeys);
        }
        const updated = (await this.roles.findById(transaction, hospitalId, id))!;
        const snapshot = (row: RoleRow) => ({
          name: row.name,
          description: row.description,
          active: row.active,
          scopeLevel: row.scopeLevel,
          permissionKeys: row.rolePermissions.map((item) => item.permissionKey),
        });
        await recordStaffAudit(transaction, context, requestId, {
          action: 'role.update',
          targetType: 'Role',
          targetId: id,
          metadata: { before: snapshot(existing), after: snapshot(updated) },
        });
        return toView(updated);
      },
      { isolationLevel: 'Serializable' },
    );
  }

  public async remove(context: StaffContext, id: string, requestId: string): Promise<void> {
    const hospitalId = context.tenant.hospitalId;
    await this.database.$transaction(
      async (transaction) => {
        const existing = await this.roles.findWithPermissions(transaction, hospitalId, id);
        if (!existing) {
          throw new NotFoundError();
        }
        if (existing.systemKey) {
          throw new ConflictError('Built-in roles cannot be deleted.');
        }
        if (exceedsCaller(context, existing.rolePermissions)) {
          throw new ForbiddenError();
        }
        if ((await this.roles.countAssignments(transaction, hospitalId, id)) > 0) {
          throw new ConflictError('This role is assigned to staff and cannot be deleted.');
        }
        await this.roles.removePermissions(transaction, hospitalId, id);
        if ((await this.roles.delete(transaction, hospitalId, id)) !== 1) {
          throw new NotFoundError();
        }
        await recordStaffAudit(transaction, context, requestId, {
          action: 'role.delete',
          targetType: 'Role',
          targetId: id,
          metadata: { name: existing.name },
        });
      },
      { isolationLevel: 'Serializable' },
    );
  }

  // Gives a role to a staff member for one place. The place must match the
  // role's level: the hospital, a floor, a ward, or a department. The same role
  // can be given for several places (for example two wards).
  public async assignToMembership(
    context: StaffContext,
    membershipId: string,
    roleId: string,
    scopeId: string | undefined,
    requestId: string,
  ) {
    const hospitalId = context.tenant.hospitalId;
    return this.database.$transaction(
      async (transaction) => {
        const [membership, role] = await Promise.all([
          this.roles.findMembership(transaction, hospitalId, membershipId),
          this.roles.findActiveWithPermissions(transaction, hospitalId, roleId),
        ]);
        if (!membership || !role) {
          throw new NotFoundError();
        }
        if (membership.status !== 'ACTIVE') {
          throw new ConflictError('The staff membership is not active.');
        }
        if (exceedsCaller(context, role.rolePermissions)) {
          throw new ForbiddenError();
        }
        const scope = await this.resolveScope(transaction, hospitalId, role.scopeLevel, scopeId);

        const userRole =
          (await this.roles.findUserRole(transaction, hospitalId, membershipId, roleId)) ??
          (await this.roles.createUserRole(transaction, { hospitalId, membershipId, roleId }));
        if (await this.roles.findScope(transaction, hospitalId, userRole.id, scope)) {
          throw new ConflictError('This person already has this role there.');
        }
        await this.roles.createScope(transaction, hospitalId, userRole.id, scope);
        await recordStaffAudit(transaction, context, requestId, {
          action: 'role.assign',
          targetType: 'HospitalMembership',
          targetId: membershipId,
          metadata: { roleId, ...scope },
        });
        return { userRoleId: userRole.id, roleId, ...scope };
      },
      { isolationLevel: 'Serializable' },
    );
  }

  // Removes a role for one place, or everywhere when no place is given.
  public async unassignFromMembership(
    context: StaffContext,
    membershipId: string,
    roleId: string,
    scopeId: string | undefined,
    requestId: string,
  ): Promise<void> {
    if (membershipId === context.membershipId) {
      throw new ConflictError('You cannot remove your own roles.');
    }
    const hospitalId = context.tenant.hospitalId;
    await this.database.$transaction(
      async (transaction) => {
        const userRole = await this.roles.findUserRoleWithScopes(
          transaction,
          hospitalId,
          membershipId,
          roleId,
        );
        if (!userRole) {
          throw new NotFoundError();
        }
        // Symmetric with assignment: nobody can remove a role more privileged than their own.
        if (exceedsCaller(context, userRole.role.rolePermissions)) {
          throw new ForbiddenError();
        }
        const removing = scopeId
          ? userRole.scopes.filter((scope) => scope.scopeId === scopeId)
          : userRole.scopes;
        if (scopeId && removing.length === 0) {
          throw new NotFoundError();
        }
        const removesRole = removing.length === userRole.scopes.length;
        if (removesRole && userRole.role.systemKey === lockedRoleKey) {
          await this.requireAnotherManager(transaction, hospitalId, membershipId);
        }
        await this.roles.deleteScopes(
          transaction,
          hospitalId,
          removing.map((scope) => scope.id),
        );
        if (removesRole) {
          await this.roles.deleteUserRole(transaction, hospitalId, userRole.id);
        }
        await recordStaffAudit(transaction, context, requestId, {
          action: 'role.unassign',
          targetType: 'HospitalMembership',
          targetId: membershipId,
          metadata: { roleId, scopeIds: removing.map((scope) => scope.scopeId) },
        });
      },
      { isolationLevel: 'Serializable' },
    );
  }

  // A hospital must always keep at least one active Hospital Manager.
  private async requireAnotherManager(
    transaction: Transaction,
    hospitalId: string,
    leavingMembershipId: string,
  ): Promise<void> {
    const others = await this.roles.countOtherActiveManagers(
      transaction,
      hospitalId,
      lockedRoleKey,
      leavingMembershipId,
    );
    if (others === 0) {
      throw new ConflictError('A hospital must keep at least one active Hospital Manager.');
    }
  }

  private async resolveScope(
    transaction: Transaction,
    hospitalId: string,
    level: RoleScopeLevel,
    scopeId: string | undefined,
  ): Promise<{ scopeType: ScopeType; scopeId: string }> {
    if (level === 'HOSPITAL') {
      if (scopeId && scopeId !== hospitalId) {
        throw new InvalidInputError(
          'This role applies to the whole hospital; do not pick a place.',
        );
      }
      return { scopeType: 'HOSPITAL', scopeId: hospitalId };
    }
    if (!scopeId) {
      throw new InvalidInputError(`Choose the ${level.toLowerCase()} this role applies to.`);
    }
    const place = await this.roles.findPlace(transaction, hospitalId, level, scopeId);
    if (!place) {
      throw new NotFoundError(`That ${level.toLowerCase()} was not found.`);
    }
    if (!place.active) {
      throw new ConflictError(`That ${level.toLowerCase()} is inactive.`);
    }
    return { scopeType: scopeTypeFor[level], scopeId };
  }

  private async validatePermissionGrant(
    context: StaffContext,
    permissionKeys: readonly string[],
  ): Promise<void> {
    // Only permissions the caller holds hospital-wide can be handed out.
    if (permissionKeys.some((key) => !context.hospitalPermissions.has(key))) {
      throw new ForbiddenError();
    }
    const count = await this.roles.countKnownPermissions(this.database, permissionKeys);
    if (count !== permissionKeys.length) {
      throw new NotFoundError();
    }
  }
}
