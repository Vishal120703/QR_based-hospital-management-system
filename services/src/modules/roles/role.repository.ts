import { type Prisma, type RoleScopeLevel, type ScopeType } from '@prisma/client';
import { type Db } from '../../database/client.js';

export const roleInclude = {
  rolePermissions: { select: { permissionKey: true } },
  _count: { select: { userRoles: true } },
} satisfies Prisma.RoleInclude;

export type RoleRow = Prisma.RoleGetPayload<{ include: typeof roleInclude }>;

const withPermissions = { rolePermissions: { select: { permissionKey: true } } } as const;

// Roles, their permissions, and who holds them where (user roles and scopes).
export class RoleRepository {
  public list(db: Db, hospitalId: string) {
    return db.role.findMany({
      where: { hospitalId },
      include: roleInclude,
      orderBy: { name: 'asc' },
    });
  }

  public findById(db: Db, hospitalId: string, id: string) {
    return db.role.findFirst({ where: { hospitalId, id }, include: roleInclude });
  }

  public findActiveWithPermissions(db: Db, hospitalId: string, id: string) {
    return db.role.findFirst({ where: { hospitalId, id, active: true }, include: withPermissions });
  }

  public findWithPermissions(db: Db, hospitalId: string, id: string) {
    return db.role.findFirst({ where: { hospitalId, id }, include: withPermissions });
  }

  public create(
    db: Db,
    data: {
      hospitalId: string;
      name: string;
      description?: string | null;
      active?: boolean;
      scopeLevel: RoleScopeLevel;
      systemKey?: string;
    },
  ) {
    return db.role.create({ data });
  }

  public async update(
    db: Db,
    hospitalId: string,
    id: string,
    data: {
      name?: string;
      description?: string | null;
      active?: boolean;
      scopeLevel?: RoleScopeLevel;
    },
  ): Promise<void> {
    await db.role.update({ where: { hospitalId_id: { hospitalId, id } }, data });
  }

  public async addPermissions(
    db: Db,
    hospitalId: string,
    roleId: string,
    permissionKeys: readonly string[],
  ): Promise<void> {
    if (permissionKeys.length === 0) return;
    await db.rolePermission.createMany({
      data: permissionKeys.map((permissionKey) => ({ hospitalId, roleId, permissionKey })),
    });
  }

  public async removePermissions(db: Db, hospitalId: string, roleId: string): Promise<void> {
    await db.rolePermission.deleteMany({ where: { hospitalId, roleId } });
  }

  // Deletes the role row; returns how many were removed (0 or 1).
  public async delete(db: Db, hospitalId: string, id: string): Promise<number> {
    return (await db.role.deleteMany({ where: { hospitalId, id } })).count;
  }

  public countAssignments(db: Db, hospitalId: string, roleId: string) {
    return db.userRole.count({ where: { hospitalId, roleId } });
  }

  // Permission keys that exist in the catalog, out of these.
  public countKnownPermissions(db: Db, keys: readonly string[]) {
    return db.permission.count({ where: { key: { in: [...keys] } } });
  }

  public async upsertPermissions(
    db: Db,
    catalog: readonly (readonly [key: string, description: string])[],
  ): Promise<void> {
    await Promise.all(
      catalog.map(([key, description]) =>
        db.permission.upsert({
          where: { key },
          create: { key, description },
          update: { description },
        }),
      ),
    );
  }

  public findMembership(db: Db, hospitalId: string, id: string) {
    return db.hospitalMembership.findFirst({ where: { hospitalId, id } });
  }

  public findUserRole(db: Db, hospitalId: string, membershipId: string, roleId: string) {
    return db.userRole.findUnique({
      where: { hospitalId_membershipId_roleId: { hospitalId, membershipId, roleId } },
    });
  }

  public findUserRoleWithScopes(db: Db, hospitalId: string, membershipId: string, roleId: string) {
    return db.userRole.findUnique({
      where: { hospitalId_membershipId_roleId: { hospitalId, membershipId, roleId } },
      include: { role: { include: withPermissions }, scopes: true },
    });
  }

  public createUserRole(
    db: Db,
    data: { hospitalId: string; membershipId: string; roleId: string },
  ) {
    return db.userRole.create({ data });
  }

  public async deleteUserRole(db: Db, hospitalId: string, id: string): Promise<void> {
    await db.userRole.delete({ where: { hospitalId_id: { hospitalId, id } } });
  }

  public findScope(
    db: Db,
    hospitalId: string,
    userRoleId: string,
    scope: { scopeType: ScopeType; scopeId: string },
  ) {
    return db.scopeAssignment.findFirst({ where: { hospitalId, userRoleId, ...scope } });
  }

  public async createScope(
    db: Db,
    hospitalId: string,
    userRoleId: string,
    scope: { scopeType: ScopeType; scopeId: string },
  ): Promise<void> {
    await db.scopeAssignment.create({ data: { hospitalId, userRoleId, ...scope } });
  }

  public async deleteScopes(db: Db, hospitalId: string, ids: readonly string[]): Promise<void> {
    await db.scopeAssignment.deleteMany({ where: { hospitalId, id: { in: [...ids] } } });
  }

  // Active Hospital Managers other than this person.
  public countOtherActiveManagers(
    db: Db,
    hospitalId: string,
    managerRoleKey: string,
    exceptMembershipId: string,
  ) {
    return db.userRole.count({
      where: {
        hospitalId,
        role: { systemKey: managerRoleKey },
        membershipId: { not: exceptMembershipId },
        membership: { status: 'ACTIVE' },
      },
    });
  }

  // The floor, ward, or department a role is given for.
  public findPlace(db: Db, hospitalId: string, level: RoleScopeLevel, id: string) {
    const key = { where: { hospitalId_id: { hospitalId, id } } };
    return level === 'FLOOR'
      ? db.floor.findUnique(key)
      : level === 'WARD'
        ? db.ward.findUnique(key)
        : db.department.findUnique(key);
  }
}
