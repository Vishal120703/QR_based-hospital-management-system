import express, { Router } from 'express';
import { z } from 'zod';
import { NotFoundError, UnauthorizedError } from '../../common/errors/app-error.js';
import { getRequestId } from '../../middleware/request-id.js';
import { getStaffContext, requirePermission } from '../../middleware/staff-auth.js';
import type { HospitalService } from './hospital.service.js';
import { maxLogoBytes } from './logo.js';

const updateHospitalSchema = z
  .object({
    name: z.string().trim().min(2).max(200).optional(),
    timezone: z
      .string()
      .refine((value) => {
        try {
          new Intl.DateTimeFormat('en-US', { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, 'Invalid IANA time zone')
      .optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required.');

export function createHospitalRouter(hospitals: HospitalService): Router {
  const router = Router();

  router.get('/hospital', requirePermission('hospital.read'), async (request, response) => {
    const context = request.staff;
    if (!context) throw new UnauthorizedError();
    z.object({}).strict().parse(request.query);
    response.status(200).json({ hospital: await hospitals.getCurrent(context) });
  });

  router.patch('/hospital', requirePermission('hospital.manage'), async (request, response) => {
    const context = request.staff;
    if (!context) throw new UnauthorizedError();
    const input = updateHospitalSchema.parse(request.body);
    const hospital = await hospitals.updateCurrent(
      context,
      input,
      String(response.getHeader('x-request-id')),
    );
    response.status(200).json({ hospital });
  });

  // The image is sent as the raw request body; its type is checked from the
  // bytes themselves.
  router.put(
    '/hospital/logo',
    requirePermission('hospital.manage'),
    express.raw({ type: () => true, limit: maxLogoBytes }),
    async (request, response) => {
      const bytes: unknown = request.body;
      const data = Buffer.isBuffer(bytes) ? bytes : Buffer.alloc(0);
      const result = await hospitals.setLogo(
        getStaffContext(request),
        data,
        getRequestId(response),
      );
      response.status(200).json(result);
    },
  );

  router.delete(
    '/hospital/logo',
    requirePermission('hospital.manage'),
    async (request, response) => {
      await hospitals.removeLogo(getStaffContext(request), getRequestId(response));
      response.status(204).send();
    },
  );

  return router;
}

// Mounted under /public, before any router that requires a guest session.
// Logos are shown to patients and printed on labels, so they are public; the
// URL is an unguessable id that changes with every upload.
export function createPublicLogoRouter(hospitals: HospitalService): Router {
  const router = Router();
  router.get('/logos/:publicId', async (request, response) => {
    const parsed = z.object({ publicId: z.string().uuid() }).strict().safeParse(request.params);
    const logo = parsed.success ? await hospitals.readLogo(parsed.data.publicId) : null;
    if (!logo) throw new NotFoundError();
    response
      .status(200)
      .set({
        'content-type': logo.contentType,
        'cache-control': 'public, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
        'cross-origin-resource-policy': 'same-site',
      })
      .send(Buffer.from(logo.data));
  });
  return router;
}
