import { type PrismaClient } from '@prisma/client';
import {
  ConflictError,
  InvalidInputError,
  UnauthorizedError,
} from '../../common/errors/app-error.js';
import { createOpaqueToken, hashOpaqueToken } from '../../common/opaque-token.js';
import { hashPassword, lockCredentialAccount, verifyPasswordOrDummy } from '../auth/index.js';
import { PlatformAuthRepository } from './platform-auth.repository.js';

const sessionDurationMs = 8 * 60 * 60 * 1000;

// A SaaS platform operator (super admin). Platform sessions are separate from
// hospital staff sessions: one never works on the other's routes.
export interface PlatformContext {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly sessionId: string;
}

export class PlatformAuthService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly auth = new PlatformAuthRepository(),
  ) {}

  public async login(input: {
    email: string;
    password: string;
  }): Promise<{ token: string; expiresAt: Date }> {
    const user = await this.auth.findUserWithAdmin(this.database, input.email.trim().toLowerCase());
    // Same response for unknown email, wrong password, or a non-operator.
    const passwordOk = await verifyPasswordOrDummy(input.password, user?.passwordHash);
    if (!user || !passwordOk || !user.platformAdmin || user.status !== 'ACTIVE') {
      throw new UnauthorizedError();
    }
    const token = createOpaqueToken();
    const expiresAt = new Date(Date.now() + sessionDurationMs);
    await this.database.$transaction(async (transaction) => {
      await lockCredentialAccount(transaction, user.id);
      const current = await this.auth.findUserWithAdmin(transaction, user.email);
      if (
        !current ||
        !current.platformAdmin ||
        current.status !== 'ACTIVE' ||
        current.passwordHash !== user.passwordHash
      ) {
        throw new UnauthorizedError();
      }
      await this.auth.createSession(transaction, {
        userId: user.id,
        tokenHash: hashOpaqueToken(token),
        expiresAt,
      });
    });
    return { token, expiresAt };
  }

  public async authenticate(token: string): Promise<PlatformContext> {
    const session = await this.auth.findSessionByTokenHash(this.database, hashOpaqueToken(token));
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.admin.user.status !== 'ACTIVE'
    ) {
      throw new UnauthorizedError();
    }
    return {
      userId: session.userId,
      email: session.admin.user.email,
      displayName: session.admin.user.displayName,
      sessionId: session.id,
    };
  }

  public async logout(context: PlatformContext): Promise<void> {
    await this.auth.revokeSession(this.database, context.sessionId);
  }

  // The current operator keeps this session; all their other platform and
  // staff sessions end because every role shares the same credential account.
  public async changePassword(
    context: PlatformContext,
    input: { currentPassword: string; newPassword: string },
  ): Promise<void> {
    const stored = await this.auth.findPasswordHash(this.database, context.userId);
    if (!(await verifyPasswordOrDummy(input.currentPassword, stored?.passwordHash))) {
      throw new InvalidInputError('Your current password is not right.');
    }
    if (input.newPassword === input.currentPassword) {
      throw new InvalidInputError('Choose a new password that is different from the current one.');
    }
    const passwordHash = await hashPassword(input.newPassword);
    await this.database.$transaction(async (transaction) => {
      if (
        !stored ||
        !(await this.auth.replacePasswordIfUnchanged(
          transaction,
          context.userId,
          stored.passwordHash,
          passwordHash,
        ))
      ) {
        throw new ConflictError(
          'Your password changed meanwhile. Try again with your current password.',
        );
      }
      await this.auth.revokeOtherSessions(transaction, context.userId, context.sessionId);
    });
  }
}
