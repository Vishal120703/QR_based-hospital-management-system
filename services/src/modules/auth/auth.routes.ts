import { Router, type Request } from 'express';
import { rateLimit, type RateLimitOptions } from '../../middleware/rate-limit.js';
import { requireStaffAuth } from '../../middleware/staff-auth.js';
import { type AuthController } from './auth.controller.js';
import { type StaffAuthService } from './auth.service.js';

export interface LoginRateLimits {
  // Guesses against one account (hospital code + email), from one address.
  readonly perAccount: RateLimitOptions;
  // All sign-ins from one address; generous, since a ward shares one network.
  readonly perAddress: RateLimitOptions;
}

const defaultLoginRateLimits: LoginRateLimits = {
  perAccount: { windowMs: 15 * 60_000, max: 10 },
  perAddress: { windowMs: 60_000, max: 120 },
};

function accountKey(request: Request): string {
  const body: unknown = request.body;
  const field = (name: string) =>
    body && typeof body === 'object' && name in body
      ? String((body as Record<string, unknown>)[name])
          .trim()
          .toLowerCase()
      : '';
  return `${request.ip ?? 'unknown'}|${field('hospitalCode')}|${field('email')}`;
}

// Mounted at the application root: staff sign-in, current session, sign-out.
export function createAuthRoutes(
  controller: AuthController,
  auth: StaffAuthService,
  limits: LoginRateLimits = defaultLoginRateLimits,
): Router {
  const router = Router();
  const signedIn = requireStaffAuth(auth);
  router.post(
    '/auth/staff/login',
    rateLimit(limits.perAddress),
    rateLimit({ ...limits.perAccount, key: accountKey }),
    controller.login,
  );
  router.get('/auth/staff/me', signedIn, controller.me);
  router.post('/auth/staff/logout', signedIn, controller.logout);
  return router;
}
