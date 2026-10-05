import { type PrismaClient } from '@prisma/client';
import { ConflictError, ForbiddenError, NotFoundError } from '../../common/errors/app-error.js';
import { type StaffContext } from '../auth/auth.service.js';

export interface RoleInput {
  readonly name?: string | undefined;
  readonly description?: string | null | undefined;
  readonly active?: boolean | undefined;
  readonly permissionKeys?: readonly string[] | undefined;
}

export class RoleService {
  public constructor(private readonly database: PrismaClient) {}

  public async list(context: StaffContext) {
    return this.database.role.findMany({
      where: { hospitalId: context.tenant.hospitalId },
      include: { rolePermissions: { select: { permissionKey: true } } },
      orderBy: { name: 'asc' },
    });
  }

  public async get(context: StaffContext, id: string) {
    const role = await this.database.role.findFirst({
      where: { hospitalId: context.tenant.hospitalId, id },
      include: { rolePermissions: { select: { permissionKey: true } } },
    });
    if (!role) {
      throw new NotFoundError();
    }
    return role;
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
      await transaction.auditLog.create({
        data: {
          hospitalId,
          actorType: 'STAFF',
          actorMembershipId: context.membershipId,
          action: 'role.create',
          targetType: 'Role',
          targetId: role.id,
          metadata: { name: role.name, permissionKeys },
          requestId,
        },
      });
      return role;
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
          include: { rolePermissions: { select: { permissionKey: true } } },
        });
        if (!existing) {
          throw new NotFoundError();
        }
        if (input.active === true && !existing.active) {
          const effectivePermissions =
            permissionKeys ?? existing.rolePermissions.map((item) => item.permissionKey);
          if (effectivePermissions.some((key) => !context.permissions.has(key))) {
            throw new ForbiddenError();
          }
        }
        const changed = await transaction.role.updateMany({
          where: { hospitalId, id },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.active !== undefined ? { active: input.active } : {}),
          },
        });
        if (changed.count !== 1) {
          throw new NotFoundError();
        }
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
          include: { rolePermissions: { select: { permissionKey: true } } },
        });
        await transaction.auditLog.create({
          data: {
            hospitalId,
            actorType: 'STAFF',
            actorMembershipId: context.membershipId,
            action: 'role.update',
            targetType: 'Role',
            targetId: id,
            metadata: {
              before: {
                name: existing.name,
                description: existing.description,
                active: existing.active,
                permissionKeys: existing.rolePermissions.map((item) => item.permissionKey),
              },
              after: {
                name: updated.name,
                description: updated.description,
                active: updated.active,
                permissionKeys: updated.rolePermissions.map((item) => item.permissionKey),
              },
            },
            requestId,
          },
        });
        return updated;
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
        await transaction.auditLog.create({
          data: {
            hospitalId,
            actorType: 'STAFF',
            actorMembershipId: context.membershipId,
            action: 'role.delete',
            targetType: 'Role',
            targetId: id,
            metadata: { name: existing.name },
            requestId,
          },
        });
      },
      { isolationLevel: 'Serializable' },
    );
  }

  public async assignToMembership(
    context: StaffContext,
    membershipId: string,
    roleId: string,
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
        if (role.rolePermissions.some((item) => !context.permissions.has(item.permissionKey))) {
          throw new ForbiddenError();
        }
        const userRole = await transaction.userRole.create({
          data: { hospitalId, membershipId, roleId },
        });
        await transaction.scopeAssignment.create({
          data: { hospitalId, userRoleId: userRole.id, scopeType: 'HOSPITAL', scopeId: hospitalId },
        });
        await transaction.auditLog.create({
          data: {
            hospitalId,
            actorType: 'STAFF',
            actorMembershipId: context.membershipId,
            action: 'role.assign',
            targetType: 'HospitalMembership',
            targetId: membershipId,
            metadata: { roleId, scopeType: 'HOSPITAL', scopeId: hospitalId },
            requestId,
          },
        });
        return userRole;
      },
      { isolationLevel: 'Serializable' },
    );
  }

  private async validatePermissionGrant(
    context: StaffContext,
    permissionKeys: readonly string[],
  ): Promise<void> {
    if (permissionKeys.some((key) => !context.permissions.has(key))) {
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
