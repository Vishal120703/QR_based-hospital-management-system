import { Router, type Response } from 'express';
import { z } from 'zod';
import { rateLimit, type RateLimitOptions } from '../../middleware/rate-limit.js';
import { getRequestId } from '../../middleware/request-id.js';
import { getStaffContext, requirePermission } from '../../middleware/staff-auth.js';
import { type QrCodeService } from './qr.service.js';

const emptyBodySchema = z.object({}).strict();
const bedParamsSchema = z.object({ id: z.string().uuid() }).strict();
const listQuerySchema = z.object({ bedId: z.string().uuid().optional() }).strict();
const resolveSchema = z.object({ token: z.string().min(1).max(256) }).strict();
const batchSchema = z.object({ floorId: z.string().uuid(), wardId: z.string().uuid() }).strict();

// Responses carrying a raw token must never be cached by browsers or proxies.
function noStore(response: Response): Response {
  return response.setHeader('cache-control', 'no-store');
}

// Mounted under /admin.
export function createQrAdminRouter(qrCodes: QrCodeService): Router {
  const router = Router();

  router.get('/qr-codes', requirePermission('bed.read'), async (request, response) => {
    const filter = listQuerySchema.parse(request.query);
    response.status(200).json({ qrCodes: await qrCodes.list(getStaffContext(request), filter) });
  });

  router.post(
    '/qr-codes/batch',
    requirePermission('hospital.manage'),
    requirePermission('qr.generate'),
    async (request, response) => {
      const { floorId, wardId } = batchSchema.parse(request.body);
      const result = await qrCodes.generateForWard(
        getStaffContext(request),
        floorId,
        wardId,
        getRequestId(response),
      );
      noStore(response).status(201).json(result);
    },
  );

  router.post(
    '/beds/:id/qr',
    requirePermission('hospital.manage'),
    requirePermission('qr.generate'),
    async (request, response) => {
      const { id } = bedParamsSchema.parse(request.params);
      emptyBodySchema.parse(request.body ?? {});
      const issue = await qrCodes.generate(getStaffContext(request), id, getRequestId(response));
      noStore(response).status(201).json(issue);
    },
  );

  router.post(
    '/beds/:id/qr/rotate',
    requirePermission('hospital.manage'),
    requirePermission('qr.rotate'),
    async (request, response) => {
      const { id } = bedParamsSchema.parse(request.params);
      emptyBodySchema.parse(request.body ?? {});
      const issue = await qrCodes.rotate(getStaffContext(request), id, getRequestId(response));
      noStore(response).status(200).json(issue);
    },
  );

  router.post(
    '/beds/:id/qr/revoke',
    requirePermission('hospital.manage'),
    requirePermission('qr.revoke'),
    async (request, response) => {
      const { id } = bedParamsSchema.parse(request.params);
      emptyBodySchema.parse(request.body ?? {});
      const qrCode = await qrCodes.revoke(getStaffContext(request), id, getRequestId(response));
      response.status(200).json({ qrCode });
    },
  );

  return router;
}

// Mounted under /public. The token travels in the body, never the URL, so it
// does not appear in access logs.
export function createQrPublicRouter(qrCodes: QrCodeService, limit: RateLimitOptions): Router {
  const router = Router();

  router.post('/qr/resolve', rateLimit(limit), async (request, response) => {
    const { token } = resolveSchema.parse(request.body);
    const resolved = await qrCodes.resolve(token);
    noStore(response).status(201).json({
      guestToken: resolved.guestToken,
      expiresAt: resolved.guest.expiresAt.toISOString(),
      location: resolved.location,
    });
  });

  return router;
}
