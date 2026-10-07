import { type Prisma, type PrismaClient } from '@prisma/client';
import { UnauthorizedError } from '../../common/errors/app-error.js';
import { createOpaqueToken, hashOpaqueToken } from '../../common/opaque-token.js';
import { hospitalIsOpen, logoUrl } from '../hospitals/index.js';
import { AuthRepository } from './auth.repository.js';
import { verifyPasswordOrDummy } from './password.js';
import { type AuthorizationScope, type StaffContext } from './staff-context.js';

const sessionDurationMs = 8 * 60 * 60 * 1000;
const repository = new AuthRepository();

export class StaffAuthService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly auth = repository,
  ) {}

  public async login(input: {
    hospitalCode: string;
    email: string;
    password: string;
  }): Promise<{ token: string; expiresAt: Date }> {
    const hospital = await this.auth.findHospitalByCode(
      this.database,
      input.hospitalCode.toUpperCase(),
    );
    const user = await this.auth.findUserByEmail(this.database, input.email.toLowerCase());

    const passwordOk = await verifyPasswordOrDummy(input.password, user?.passwordHash);
    if (!hospital || !user || !passwordOk) {
      throw new UnauthorizedError();
    }

    const membership = await this.auth.findMembership(this.database, hospital.id, user.id);
    if (!hospitalIsOpen(hospital) || user.status !== 'ACTIVE' || membership?.status !== 'ACTIVE') {
      throw new UnauthorizedError();
    }

    const token = createOpaqueToken();
    const expiresAt = new Date(Date.now() + sessionDurationMs);
    await this.auth.createSession(this.database, {
      hospitalId: hospital.id,
      membershipId: membership.id,
      tokenHash: hashOpaqueToken(token),
      expiresAt,
    });

    return { token, expiresAt };
  }

  public async authenticate(token: string): Promise<StaffContext> {
    // Credential resolution is the single pre-tenant lookup. The session's
    // composite FK establishes trusted hospital/membership context afterward.
    const session = await this.auth.findSessionByTokenHash(this.database, hashOpaqueToken(token));

    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      !hospitalIsOpen(session.hospital) ||
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
    await this.auth.revokeSession(this.database, context.tenant.hospitalId, context.sessionId);
  }
}

// Ends every open session of a staff member, inside the caller's transaction.
export function revokeStaffSessions(
  transaction: Prisma.TransactionClient,
  hospitalId: string,
  membershipId: string,
): Promise<number> {
  return repository.revokeMembershipSessions(transaction, hospitalId, membershipId);
}

// Ends every open staff session in these hospitals (suspension), inside the
// caller's transaction.
export function revokeHospitalSessions(
  transaction: Prisma.TransactionClient,
  hospitalIds: readonly string[],
): Promise<number> {
  return repository.revokeHospitalSessions(transaction, hospitalIds);
}
