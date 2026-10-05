import { type PrismaClient } from '@prisma/client';
import { UnauthorizedError } from '../../common/errors/app-error.js';
import { verifyPassword } from './password.js';
import { createOpaqueToken, hashOpaqueToken } from '../../common/opaque-token.js';

const sessionDurationMs = 8 * 60 * 60 * 1000;

export interface StaffContext {
  readonly user: { readonly id: string; readonly email: string; readonly displayName: string };
  readonly tenant: { readonly hospitalId: string; readonly code: string; readonly name: string };
  readonly membershipId: string;
  readonly sessionId: string;
  readonly permissions: ReadonlySet<string>;
  readonly scopes: ReadonlyArray<{
    readonly type: 'HOSPITAL' | 'FLOOR' | 'WARD';
    readonly id: string;
  }>;
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
        hospital: true,
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

    const activeRoles = session.membership.userRoles.filter((entry) => entry.role.active);
    const scopes = activeRoles.flatMap((entry) =>
      entry.scopes.map((scope) => ({ type: scope.scopeType, id: scope.scopeId })),
    );
    const hospitalScopedRoles = activeRoles.filter((entry) =>
      entry.scopes.some(
        (scope) => scope.scopeType === 'HOSPITAL' && scope.scopeId === session.hospitalId,
      ),
    );
    const hasHospitalScope = hospitalScopedRoles.length > 0;
    if (!hasHospitalScope) {
      throw new UnauthorizedError();
    }

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
      },
      membershipId: session.membershipId,
      sessionId: session.id,
      permissions: new Set(
        hospitalScopedRoles.flatMap((entry) =>
          entry.role.rolePermissions.map((item) => item.permissionKey),
        ),
      ),
      scopes,
    };
  }

  public async logout(context: StaffContext): Promise<void> {
    await this.database.staffSession.updateMany({
      where: { id: context.sessionId, hospitalId: context.tenant.hospitalId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
