import { type Prisma, type PrismaClient } from '@prisma/client';
import { InvalidInputError, UnauthorizedError } from '../../common/errors/app-error.js';
import { createOpaqueToken, hashOpaqueToken } from '../../common/opaque-token.js';
import { recordStaffAudit } from '../audit/index.js';
import { hospitalIsOpen, logoUrl } from '../hospitals/index.js';
import { AuthRepository } from './auth.repository.js';
import { hashPassword, verifyPasswordOrDummy } from './password.js';
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
        timezone: session.hospital.timezone,
      },
      membershipId: session.membershipId,
      sessionId: session.id,
      mustChangePassword: session.membership.user.mustChangePassword,
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

  // A signed-in person chooses a new password. Their other sessions end (for
  // example a phone left signed in); this one stays. Clears a pending reset.
  public async changePassword(
    context: StaffContext,
    input: { currentPassword: string; newPassword: string },
    requestId: string,
  ): Promise<void> {
    const stored = await this.auth.findPasswordHash(this.database, context.user.id);
    // A wrong current password is a mistake in the form, not an expired
    // session, so it is not answered with 401 (that would sign them out).
    if (!(await verifyPasswordOrDummy(input.currentPassword, stored?.passwordHash))) {
      throw new InvalidInputError('Your current password is not right.');
    }
    if (input.newPassword === input.currentPassword) {
      throw new InvalidInputError('Choose a new password that is different from the current one.');
    }
    const passwordHash = await hashPassword(input.newPassword);
    const hospitalId = context.tenant.hospitalId;
    await this.database.$transaction(async (transaction) => {
      await this.auth.replacePassword(transaction, context.user.id, {
        passwordHash,
        mustChangePassword: false,
      });
      const signedOut = await this.auth.revokeOtherSessions(
        transaction,
        hospitalId,
        context.membershipId,
        context.sessionId,
      );
      await recordStaffAudit(transaction, context, requestId, {
        action: 'staff.password.change',
        targetType: 'HospitalMembership',
        targetId: context.membershipId,
        metadata: { otherSessionsEnded: signedOut, afterReset: context.mustChangePassword },
      });
    });
  }
}

// An administrator gives a staff member a temporary password, inside the
// caller's transaction: every session of theirs ends, and they must choose
// their own password when they next sign in. Refused for an account that also
// signs in outside this hospital, whose password is not this hospital's.
export async function resetStaffPassword(
  transaction: Prisma.TransactionClient,
  target: { hospitalId: string; membershipId: string; userId: string },
  passwordHash: string,
): Promise<{ allowed: false } | { allowed: true; sessionsEnded: number }> {
  if (await repository.usedOutside(transaction, target.userId, target.hospitalId)) {
    return { allowed: false };
  }
  await repository.replacePassword(transaction, target.userId, {
    passwordHash,
    mustChangePassword: true,
  });
  const sessionsEnded = await repository.revokeMembershipSessions(
    transaction,
    target.hospitalId,
    target.membershipId,
  );
  return { allowed: true, sessionsEnded };
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
