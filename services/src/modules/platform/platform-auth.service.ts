import { type PrismaClient } from '@prisma/client';
import { UnauthorizedError } from '../../common/errors/app-error.js';
import { createOpaqueToken, hashOpaqueToken } from '../../common/opaque-token.js';
import { verifyPasswordOrDummy } from '../auth/password.js';

const sessionDurationMs = 8 * 60 * 60 * 1000;

// A SaaS platform operator. Platform sessions are separate from hospital staff
// sessions: one never works on the other's routes.
export interface PlatformContext {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly sessionId: string;
}

export class PlatformAuthService {
  public constructor(private readonly database: PrismaClient) {}

  public async login(input: {
    email: string;
    password: string;
  }): Promise<{ token: string; expiresAt: Date }> {
    const user = await this.database.user.findUnique({
      where: { email: input.email.trim().toLowerCase() },
      include: { platformAdmin: true },
    });
    // Same response for unknown email, wrong password, or a non-operator.
    const passwordOk = await verifyPasswordOrDummy(input.password, user?.passwordHash);
    if (!user || !passwordOk || !user.platformAdmin || user.status !== 'ACTIVE') {
      throw new UnauthorizedError();
    }
    const token = createOpaqueToken();
    const expiresAt = new Date(Date.now() + sessionDurationMs);
    await this.database.platformSession.create({
      data: { userId: user.id, tokenHash: hashOpaqueToken(token), expiresAt },
    });
    return { token, expiresAt };
  }

  public async authenticate(token: string): Promise<PlatformContext> {
    const session = await this.database.platformSession.findUnique({
      where: { tokenHash: hashOpaqueToken(token) },
      include: { admin: { include: { user: true } } },
    });
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
    await this.database.platformSession.updateMany({
      where: { id: context.sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
