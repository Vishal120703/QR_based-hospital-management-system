import { Router } from 'express';
import { z } from 'zod';
import { UnauthorizedError } from '../../common/errors/app-error.js';
import { requireStaffAuth } from '../../middleware/staff-auth.js';
import { type StaffAuthService } from './auth.service.js';

const loginSchema = z
  .object({
    hospitalCode: z
      .string()
      .trim()
      .min(2)
      .max(32)
      .regex(/^[A-Za-z0-9-]+$/),
    email: z.string().trim().email().max(320),
    password: z.string().min(1),
  })
  .strict();
const emptyBodySchema = z.object({}).strict();

export function createAuthRouter(auth: StaffAuthService): Router {
  const router = Router();

  router.post('/auth/staff/login', async (request, response) => {
    const input = loginSchema.parse(request.body);
    const result = await auth.login(input);
    response.status(200).json({ token: result.token, expiresAt: result.expiresAt.toISOString() });
  });

  router.get('/auth/staff/me', requireStaffAuth(auth), (request, response) => {
    z.object({}).strict().parse(request.query);
    const context = request.staff;
    if (!context) {
      throw new UnauthorizedError();
    }
    response.status(200).json({
      user: context.user,
      membershipId: context.membershipId,
      tenant: context.tenant,
      // Hospital-wide permissions; scopedPermissions also lists the ones held
      // only for some floors or wards (used by request work screens).
      permissions: [...context.hospitalPermissions].sort(),
      scopedPermissions: [...context.permissions].sort(),
      scopes: context.scopes,
    });
  });

  router.post('/auth/staff/logout', requireStaffAuth(auth), async (request, response) => {
    emptyBodySchema.parse(request.body ?? {});
    const context = request.staff;
    if (!context) {
      throw new UnauthorizedError();
    }
    await auth.logout(context);
    response.status(204).send();
  });

  return router;
}
