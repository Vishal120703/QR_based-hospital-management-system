import { type Prisma, type PrismaClient } from '@prisma/client';
import { UnauthorizedError } from '../../common/errors/app-error.js';
import { logoUrl } from '../hospitals/logo.js';
import { verifyPassword } from './password.js';
import { createOpaqueToken, hashOpaqueToken } from '../../common/opaque-token.js';

const sessionDurationMs = 8 * 60 * 60 * 1000;

export interface AuthorizationScope {
  readonly type: 'HOSPITAL' | 'FLOOR' | 'WARD' | 'DEPARTMENT';
  readonly id: string;
}

export interface StaffContext {
  readonly user: { readonly id: string; readonly email: string; readonly displayName: string };
  readonly tenant: {
    readonly hospitalId: string;
    readonly code: string;
    readonly name: string;
    readonly logoUrl: string | null;
  };
  readonly membershipId: string;
  readonly sessionId: string;
  // Every permission held in at least one scope. Only location-aware code
  // (requests, eligibility) may rely on this, together with scopesFor().
  readonly permissions: ReadonlySet<string>;
  // Permissions held hospital-wide. Plain route guards check this set, so a
  // floor- or ward-scoped role never unlocks hospital-wide screens.
  readonly hospitalPermissions: ReadonlySet<string>;
  readonly permissionScopes: ReadonlyMap<string, ReadonlyArray<AuthorizationScope>>;
  readonly scopes: ReadonlyArray<AuthorizationScope>;
}

// The scopes in which the staff member holds one permission.
export function scopesFor(
  context: StaffContext,
  permission: string,
): ReadonlyArray<AuthorizationScope> {
  return context.permissionScopes.get(permission) ?? [];
}

// Whether the permission covers a target: a bed in this ward and floor, and
// for requests also the department that handles it.
export function canAccessLocation(
  context: StaffContext,
  permission: string,
  target: {
    readonly wardId: string;
    readonly floorId: string;
    readonly departmentId?: string | undefined;
  },
): boolean {
  return scopesFor(context, permission).some(
    (scope) =>
      (scope.type === 'HOSPITAL' && scope.id === context.tenant.hospitalId) ||
      (scope.type === 'FLOOR' && scope.id === target.floorId) ||
      (scope.type === 'WARD' && scope.id === target.wardId) ||
      (scope.type === 'DEPARTMENT' && scope.id === target.departmentId),
  );
}

// Prisma filters for "beds this permission covers"; null means none at all.
// Department scopes never cover beds or locations.
export function bedScopeWhere(
  context: StaffContext,
  permission: string,
): { hospitalWide: true } | { wardIds: string[]; floorIds: string[] } | null {
  const scopes = scopesFor(context, permission);
  if (scopes.some((scope) => scope.type === 'HOSPITAL' && scope.id === context.tenant.hospitalId)) {
    return { hospitalWide: true };
  }
  const wardIds = scopes.filter((scope) => scope.type === 'WARD').map((scope) => scope.id);
  const floorIds = scopes.filter((scope) => scope.type === 'FLOOR').map((scope) => scope.id);
  return wardIds.length + floorIds.length > 0 ? { wardIds, floorIds } : null;
}

export class StaffAuthService {
  public constructor(private readonly database: PrismaClient) {}

  public async login(input: {
    hospitalCode: string;
    email: string;
    password: string;
  }): Promise<{ token: string; expiresAt: Date }> {
    const hospital = await this.database.hospital.findUnique({
      where: { code: input.hospitalCode.toUpperCase() },
    });
    const user = await this.database.user.findUnique({
      where: { email: input.email.toLowerCase() },
    });

    if (!hospital || !user || !(await verifyPassword(input.password, user.passwordHash))) {
      throw new UnauthorizedError();
    }

    const membership = await this.database.hospitalMembership.findUnique({
      where: { hospitalId_userId: { hospitalId: hospital.id, userId: user.id } },
    });

    if (
      hospital.status !== 'ACTIVE' ||
      user.status !== 'ACTIVE' ||
      membership?.status !== 'ACTIVE'
    ) {
      throw new UnauthorizedError();
    }

    const token = createOpaqueToken();
    const expiresAt = new Date(Date.now() + sessionDurationMs);
    await this.database.staffSession.create({
      data: {
        hospitalId: hospital.id,
        membershipId: membership.id,
        tokenHash: hashOpaqueToken(token),
        expiresAt,
      },
    });

    return { token, expiresAt };
  }

  public async authenticate(token: string): Promise<StaffContext> {
    // Credential resolution is the single pre-tenant lookup. The session's
    // composite FK establishes trusted hospital/membership context afterward.
    const session = await this.database.staffSession.findUnique({
      where: { tokenHash: hashOpaqueToken(token) },
      include: {
        hospital: { include: { logo: { select: { publicId: true } } } },
        membership: {
          include: {
            user: true,
            userRoles: {
              include: {
                role: { include: { rolePermissions: true } },
                scopes: true,
              },
            },
          },
        },
      },
    });

    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.hospital.status !== 'ACTIVE' ||
      session.membership.status !== 'ACTIVE' ||
      session.membership.user.status !== 'ACTIVE'
    ) {
      throw new UnauthorizedError();
    }

    const activeRoles = session.membership.userRoles.filter(
      (entry) => entry.role.active && entry.scopes.length > 0,
    );
    if (activeRoles.length === 0) {
      throw new UnauthorizedError();
    }

    const permissionScopes = new Map<string, AuthorizationScope[]>();
    for (const entry of activeRoles) {
      const roleScopes = entry.scopes.map((scope) => ({
        type: scope.scopeType,
        id: scope.scopeId,
      }));
      for (const { permissionKey } of entry.role.rolePermissions) {
        permissionScopes.set(permissionKey, [
          ...(permissionScopes.get(permissionKey) ?? []),
          ...roleScopes,
        ]);
      }
    }
    const hospitalPermissions = [...permissionScopes]
      .filter(([, scopes]) =>
        scopes.some((scope) => scope.type === 'HOSPITAL' && scope.id === session.hospitalId),
      )
      .map(([permission]) => permission);

    return {
      user: {
        id: session.membership.user.id,
        email: session.membership.user.email,
        displayName: session.membership.user.displayName,
      },
      tenant: {
        hospitalId: session.hospitalId,
        code: session.hospital.code,
        name: session.hospital.name,
        logoUrl: logoUrl(session.hospital.logo?.publicId),
      },
      membershipId: session.membershipId,
      sessionId: session.id,
      permissions: new Set(permissionScopes.keys()),
      hospitalPermissions: new Set(hospitalPermissions),
      permissionScopes,
      scopes: activeRoles.flatMap((entry) =>
        entry.scopes.map((scope) => ({ type: scope.scopeType, id: scope.scopeId })),
      ),
    };
  }

  public async logout(context: StaffContext): Promise<void> {
    await this.database.staffSession.updateMany({
      where: { id: context.sessionId, hospitalId: context.tenant.hospitalId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

// Ends every open session of a staff member, inside the caller's transaction.
export async function revokeStaffSessions(
  transaction: Prisma.TransactionClient,
  hospitalId: string,
  membershipId: string,
): Promise<number> {
  const revoked = await transaction.staffSession.updateMany({
    where: { hospitalId, membershipId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return revoked.count;
}
