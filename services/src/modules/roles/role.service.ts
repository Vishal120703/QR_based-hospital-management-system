import { type Prisma, type PrismaClient, type RoleScopeLevel } from '@prisma/client';
import {
  ConflictError,
  ForbiddenError,
  InvalidInputError,
  NotFoundError,
} from '../../common/errors/app-error.js';
import { type StaffContext } from '../auth/auth.service.js';
import { builtInRoles, lockedRoleKey } from './built-in-roles.js';

export interface RoleInput {
  readonly name?: string | undefined;
  readonly description?: string | null | undefined;
  readonly active?: boolean | undefined;
  readonly scopeLevel?: RoleScopeLevel | undefined;
  readonly permissionKeys?: readonly string[] | undefined;
}

type Transaction = Prisma.TransactionClient;

const roleInclude = {
  rolePermissions: { select: { permissionKey: true } },
  _count: { select: { userRoles: true } },
} satisfies Prisma.RoleInclude;

type RoleRow = Prisma.RoleGetPayload<{ include: typeof roleInclude }>;

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

const scopeTypeFor: Record<RoleScopeLevel, 'HOSPITAL' | 'FLOOR' | 'WARD' | 'DEPARTMENT'> = {
  HOSPITAL: 'HOSPITAL',
  FLOOR: 'FLOOR',
  WARD: 'WARD',
  DEPARTMENT: 'DEPARTMENT',
};

export class RoleService {
  public constructor(private readonly database: PrismaClient) {}

  public async list(context: StaffContext) {
    const roles = await this.database.role.findMany({
      where: { hospitalId: context.tenant.hospitalId },
      include: roleInclude,
      orderBy: { name: 'asc' },
    });
    // Built-in roles in hierarchy order, then the hospital's own roles by name.
    const rank = (role: RoleRow) => {
      const index = builtInRoles.findIndex((item) => item.key === role.systemKey);
      return index < 0 ? builtInRoles.length : index;
    };
    return roles.sort((left, right) => rank(left) - rank(right)).map(toView);
  }

  public async get(context: StaffContext, id: string) {
    const role = await this.database.role.findFirst({
      where: { hospitalId: context.tenant.hospitalId, id },
      include: roleInclude,
    });
    if (!role) {
      throw new NotFoundError();
    }
    return toView(role);
  }

  public async create(
    context: StaffContext,
    input: RoleInput & { name: string },
    requestId: string,
  ) {
    const hospitalId = context.tenant.hospitalId;
    const permissionKeys = [...new Set(input.permissionKeys ?? [])];
    await this.validatePermissionGrant(context, permissionKeys);

    return this.database.$transaction(async (transaction) => {
      const role = await transaction.role.create({
        data: {
          hospitalId,
          name: input.name,
          ...(input.description !== undefined ? { description: input.description } : {}),
          active: input.active ?? true,
          scopeLevel: input.scopeLevel ?? 'HOSPITAL',
        },
      });
      if (permissionKeys.length > 0) {
        await transaction.rolePermission.createMany({
          data: permissionKeys.map((permissionKey) => ({
            hospitalId,
            roleId: role.id,
            permissionKey,
          })),
        });
      }
      await this.audit(transaction, context, requestId, 'role.create', 'Role', role.id, {
        name: role.name,
        scopeLevel: role.scopeLevel,
        permissionKeys,
      });
      return toView(
        await transaction.role.findFirstOrThrow({
          where: { hospitalId, id: role.id },
          include: roleInclude,
        }),
      );
    });
  }

  public async update(context: StaffContext, id: string, input: RoleInput, requestId: string) {
    const hospitalId = context.tenant.hospitalId;
    const permissionKeys = input.permissionKeys && [...new Set(input.permissionKeys)];
    if (permissionKeys) {
      await this.validatePermissionGrant(context, permissionKeys);
    }

    return this.database.$transaction(
      async (transaction) => {
        const existing = await transaction.role.findFirst({
          where: { hospitalId, id },
          include: roleInclude,
        });
        if (!existing) {
          throw new NotFoundError();
        }
        if (existing.systemKey === lockedRoleKey) {
          throw new ConflictError(
            'The Hospital Manager role always has every permission and cannot be changed.',
          );
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
        await transaction.role.update({
          where: { hospitalId_id: { hospitalId, id } },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.active !== undefined ? { active: input.active } : {}),
            ...(input.scopeLevel !== undefined ? { scopeLevel: input.scopeLevel } : {}),
          },
        });
        if (permissionKeys) {
          await transaction.rolePermission.deleteMany({ where: { hospitalId, roleId: id } });
          if (permissionKeys.length > 0) {
            await transaction.rolePermission.createMany({
              data: permissionKeys.map((permissionKey) => ({
                hospitalId,
                roleId: id,
                permissionKey,
              })),
            });
          }
        }
        const updated = await transaction.role.findFirstOrThrow({
          where: { hospitalId, id },
          include: roleInclude,
        });
        const snapshot = (row: RoleRow) => ({
          name: row.name,
          description: row.description,
          active: row.active,
          scopeLevel: row.scopeLevel,
          permissionKeys: row.rolePermissions.map((item) => item.permissionKey),
        });
        await this.audit(transaction, context, requestId, 'role.update', 'Role', id, {
          before: snapshot(existing),
          after: snapshot(updated),
        });
        return toView(updated);
      },
      { isolationLevel: 'Serializable' },
    );
  }

  public async delete(context: StaffContext, id: string, requestId: string): Promise<void> {
    const hospitalId = context.tenant.hospitalId;
    await this.database.$transaction(
      async (transaction) => {
        const existing = await transaction.role.findFirst({ where: { hospitalId, id } });
        if (!existing) {
          throw new NotFoundError();
        }
        if (existing.systemKey) {
          throw new ConflictError('Built-in roles cannot be deleted.');
        }
        const assignmentCount = await transaction.userRole.count({
          where: { hospitalId, roleId: id },
        });
        if (assignmentCount > 0) {
          throw new ConflictError('This role is assigned to staff and cannot be deleted.');
        }
        await transaction.rolePermission.deleteMany({ where: { hospitalId, roleId: id } });
        const deleted = await transaction.role.deleteMany({ where: { hospitalId, id } });
        if (deleted.count !== 1) {
          throw new NotFoundError();
        }
        await this.audit(transaction, context, requestId, 'role.delete', 'Role', id, {
          name: existing.name,
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
          transaction.hospitalMembership.findFirst({ where: { hospitalId, id: membershipId } }),
          transaction.role.findFirst({
            where: { hospitalId, id: roleId, active: true },
            include: { rolePermissions: { select: { permissionKey: true } } },
          }),
        ]);
        if (!membership || !role) {
          throw new NotFoundError();
        }
        if (membership.status !== 'ACTIVE') {
          throw new ConflictError('The staff membership is not active.');
        }
        if (
          role.rolePermissions.some((item) => !context.hospitalPermissions.has(item.permissionKey))
        ) {
          throw new ForbiddenError();
        }
        const scope = await this.resolveScope(transaction, hospitalId, role.scopeLevel, scopeId);

        const userRole =
          (await transaction.userRole.findUnique({
            where: { hospitalId_membershipId_roleId: { hospitalId, membershipId, roleId } },
          })) ??
          (await transaction.userRole.create({ data: { hospitalId, membershipId, roleId } }));
        const duplicate = await transaction.scopeAssignment.findFirst({
          where: { hospitalId, userRoleId: userRole.id, ...scope },
        });
        if (duplicate) {
          throw new ConflictError('This person already has this role there.');
        }
        await transaction.scopeAssignment.create({
          data: { hospitalId, userRoleId: userRole.id, ...scope },
        });
        await this.audit(
          transaction,
          context,
          requestId,
          'role.assign',
          'HospitalMembership',
          membershipId,
          { roleId, ...scope },
        );
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
        const userRole = await transaction.userRole.findUnique({
          where: { hospitalId_membershipId_roleId: { hospitalId, membershipId, roleId } },
          include: {
            role: { include: { rolePermissions: { select: { permissionKey: true } } } },
            scopes: true,
          },
        });
        if (!userRole) {
          throw new NotFoundError();
        }
        // Symmetric with assignment: nobody can remove a role more privileged than their own.
        if (
          userRole.role.rolePermissions.some(
            (item) => !context.hospitalPermissions.has(item.permissionKey),
          )
        ) {
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
        await transaction.scopeAssignment.deleteMany({
          where: { hospitalId, id: { in: removing.map((scope) => scope.id) } },
        });
        if (removesRole) {
          await transaction.userRole.delete({
            where: { hospitalId_id: { hospitalId, id: userRole.id } },
          });
        }
        await this.audit(
          transaction,
          context,
          requestId,
          'role.unassign',
          'HospitalMembership',
          membershipId,
          { roleId, scopeIds: removing.map((scope) => scope.scopeId) },
        );
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
    const others = await transaction.userRole.count({
      where: {
        hospitalId,
        role: { systemKey: lockedRoleKey },
        membershipId: { not: leavingMembershipId },
        membership: { status: 'ACTIVE' },
      },
    });
    if (others === 0) {
      throw new ConflictError('A hospital must keep at least one active Hospital Manager.');
    }
  }

  private async resolveScope(
    transaction: Transaction,
    hospitalId: string,
    level: RoleScopeLevel,
    scopeId: string | undefined,
  ): Promise<{ scopeType: 'HOSPITAL' | 'FLOOR' | 'WARD' | 'DEPARTMENT'; scopeId: string }> {
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
    const key = { where: { hospitalId_id: { hospitalId, id: scopeId } } };
    const place =
      level === 'FLOOR'
        ? await transaction.floor.findUnique(key)
        : level === 'WARD'
          ? await transaction.ward.findUnique(key)
          : await transaction.department.findUnique(key);
    if (!place) {
      throw new NotFoundError(`That ${level.toLowerCase()} was not found.`);
    }
    if (!place.active) {
      throw new ConflictError(`That ${level.toLowerCase()} is inactive.`);
    }
    return { scopeType: scopeTypeFor[level], scopeId };
  }

  private async audit(
    transaction: Transaction,
    context: StaffContext,
    requestId: string,
    action: string,
    targetType: string,
    targetId: string,
    metadata: Prisma.InputJsonObject,
  ) {
    await transaction.auditLog.create({
      data: {
        hospitalId: context.tenant.hospitalId,
        actorType: 'STAFF',
        actorMembershipId: context.membershipId,
        action,
        targetType,
        targetId,
        metadata,
        requestId,
      },
    });
  }

  private async validatePermissionGrant(
    context: StaffContext,
    permissionKeys: readonly string[],
  ): Promise<void> {
    // Only permissions the caller holds hospital-wide can be handed out.
    if (permissionKeys.some((key) => !context.hospitalPermissions.has(key))) {
      throw new ForbiddenError();
    }
    const count = await this.database.permission.count({
      where: { key: { in: [...permissionKeys] } },
    });
    if (count !== permissionKeys.length) {
      throw new NotFoundError();
    }
  }
}
