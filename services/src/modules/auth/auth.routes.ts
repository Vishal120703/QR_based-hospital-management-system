import { Router, type Request } from 'express';
import { rateLimit, type RateLimitOptions } from '../../middleware/rate-limit.js';
import { requireStaffAuth } from '../../middleware/staff-auth.js';
import { type AuthController } from './auth.controller.js';
import { type StaffAuthService } from './auth.service.js';

export interface LoginRateLimits {
  // Guesses against one account (hospital code + email), across all addresses.
  readonly perAccount: RateLimitOptions;
  // All sign-ins from one address; generous, since a ward shares one network.
  readonly perAddress: RateLimitOptions;
  // Current-password guesses from one signed-in staff member.
  readonly passwordChange?: RateLimitOptions;
}

const defaultLoginRateLimits: LoginRateLimits = {
  perAccount: { windowMs: 15 * 60_000, max: 10 },
  perAddress: { windowMs: 60_000, max: 120 },
  passwordChange: { windowMs: 15 * 60_000, max: 10 },
};

export function staffAccountKey(request: Request): string {
  const body: unknown = request.body;
  const field = (name: string) =>
    body && typeof body === 'object' && name in body
      ? String((body as Record<string, unknown>)[name])
          .trim()
          .toLowerCase()
      : '';
  return `${field('hospitalCode')}|${field('email')}`;
}

// Mounted at the application root: staff sign-in, current session, sign-out.
export function createAuthRoutes(
  controller: AuthController,
  auth: StaffAuthService,
  limits: LoginRateLimits = defaultLoginRateLimits,
): Router {
  const router = Router();
  // These also work while a reset password is waiting to be replaced.
  const signedIn = requireStaffAuth(auth, { allowPendingPasswordChange: true });
  router.post(
    '/auth/staff/login',
    rateLimit(limits.perAddress),
    rateLimit({ ...limits.perAccount, key: staffAccountKey }),
    controller.login,
  );
  router.get('/auth/staff/me', signedIn, controller.me);
  router.post('/auth/staff/logout', signedIn, controller.logout);
  router.post(
    '/auth/staff/password',
    signedIn,
    rateLimit({
      ...(limits.passwordChange ?? defaultLoginRateLimits.passwordChange!),
      key: (request) => `password|${request.staff?.membershipId ?? request.ip ?? 'unknown'}`,
    }),
    controller.changePassword,
  );
  return router;
}
