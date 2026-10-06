import express, { Router } from 'express';
import { z } from 'zod';
import { getPlatformContext, requirePlatformAuth } from '../../middleware/platform-auth.js';
import { rateLimit, type RateLimitOptions } from '../../middleware/rate-limit.js';
import { getRequestId } from '../../middleware/request-id.js';
import { maxLogoBytes } from '../hospitals/logo.js';
import { type PlatformAuthService } from './platform-auth.service.js';
import { type PlatformService } from './platform.service.js';

const empty = z.object({}).strict();
const idParams = z.object({ id: z.string().uuid() }).strict();
const timezone = z
  .string()
  .trim()
  .min(1)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Invalid IANA time zone');
const person = {
  managerName: z.string().trim().min(2).max(120),
  managerEmail: z.string().trim().email().max(320),
  managerPassword: z.string().min(12).max(200),
};
const createSchema = z
  .object({
    name: z.string().trim().min(2).max(200),
    code: z
      .string()
      .trim()
      .min(2)
      .max(32)
      .regex(/^[A-Za-z0-9-]+$/),
    timezone,
    ...person,
  })
  .strict();
const updateSchema = z
  .object({
    name: z.string().trim().min(2).max(200).optional(),
    timezone: timezone.optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required.');
const managerSchema = z
  .object({
    displayName: person.managerName,
    email: person.managerEmail,
    password: person.managerPassword,
  })
  .strict();
const loginSchema = z
  .object({ email: z.string().trim().email().max(320), password: z.string().min(1) })
  .strict();

// Mounted at the application root. Platform tokens are required only under
// /auth/platform (except login) and /platform; staff and guest routes never see them.
export function createPlatformRouter(
  auth: PlatformAuthService,
  platform: PlatformService,
  loginLimit: RateLimitOptions,
): Router {
  const signedIn = requirePlatformAuth(auth);

  const session = Router();
  session.post('/login', rateLimit(loginLimit), async (request, response) => {
    const result = await auth.login(loginSchema.parse(request.body));
    response.status(200).json({ token: result.token, expiresAt: result.expiresAt.toISOString() });
  });
  session.get('/me', signedIn, (request, response) => {
    empty.parse(request.query);
    const { userId, email, displayName } = getPlatformContext(request);
    response.status(200).json({ user: { id: userId, email, displayName } });
  });
  session.post('/logout', signedIn, async (request, response) => {
    empty.parse(request.body ?? {});
    await auth.logout(getPlatformContext(request));
    response.status(204).send();
  });

  const operator = Router();
  operator.use(signedIn);
  operator.get('/hospitals', async (request, response) => {
    empty.parse(request.query);
    response.status(200).json({ hospitals: await platform.listHospitals() });
  });
  operator.post('/hospitals', async (request, response) => {
    const input = createSchema.parse(request.body);
    const hospital = await platform.createHospital(
      getPlatformContext(request),
      input,
      getRequestId(response),
    );
    response.status(201).json({ hospital });
  });
  operator.get('/hospitals/:id', async (request, response) => {
    const { id } = idParams.parse(request.params);
    empty.parse(request.query);
    response.status(200).json({ hospital: await platform.getHospital(id) });
  });
  operator.patch('/hospitals/:id', async (request, response) => {
    const { id } = idParams.parse(request.params);
    const hospital = await platform.updateHospital(
      getPlatformContext(request),
      id,
      updateSchema.parse(request.body),
      getRequestId(response),
    );
    response.status(200).json({ hospital });
  });
  operator.put(
    '/hospitals/:id/logo',
    express.raw({ type: () => true, limit: maxLogoBytes }),
    async (request, response) => {
      const { id } = idParams.parse(request.params);
      const body: unknown = request.body;
      const bytes = Buffer.isBuffer(body) ? body : Buffer.alloc(0);
      const result = await platform.setLogo(
        getPlatformContext(request),
        id,
        bytes,
        getRequestId(response),
      );
      response.status(200).json(result);
    },
  );
  operator.delete('/hospitals/:id/logo', async (request, response) => {
    const { id } = idParams.parse(request.params);
    empty.parse(request.body ?? {});
    await platform.removeLogo(getPlatformContext(request), id, getRequestId(response));
    response.status(204).send();
  });
  operator.post('/hospitals/:id/managers', async (request, response) => {
    const { id } = idParams.parse(request.params);
    const hospital = await platform.addManager(
      getPlatformContext(request),
      id,
      managerSchema.parse(request.body),
      getRequestId(response),
    );
    response.status(201).json({ hospital });
  });

  const router = Router();
  router.use('/auth/platform', session);
  router.use('/platform', operator);
  return router;
}
