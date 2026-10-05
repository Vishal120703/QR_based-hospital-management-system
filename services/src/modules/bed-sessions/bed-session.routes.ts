import { Router } from 'express';
import { z } from 'zod';
import { getGuestContext, requireGuestSession } from '../../middleware/guest-auth.js';
import { getRequestId } from '../../middleware/request-id.js';
import { getStaffContext, requirePermission } from '../../middleware/staff-auth.js';
import { type BedSessionService } from './bed-session.service.js';
import { type GuestSessionService } from './guest-session.service.js';

const emptySchema = z.object({}).strict();
const idParamsSchema = z.object({ id: z.string().uuid() }).strict();
const listQuerySchema = z
  .object({
    bedId: z.string().uuid().optional(),
    status: z.enum(['ACTIVE', 'CLOSED']).optional(),
  })
  .strict();
const startSchema = z.object({ bedId: z.string().uuid() }).strict();

// Mounted under /admin.
export function createBedSessionRouter(bedSessions: BedSessionService): Router {
  const router = Router();

  router.get('/bed-sessions', requirePermission('bed.read'), async (request, response) => {
    const filter = listQuerySchema.parse(request.query);
    const sessions = await bedSessions.list(getStaffContext(request), filter);
    response.status(200).json({ bedSessions: sessions });
  });

  router.post(
    '/bed-sessions',
    requirePermission('bedSession.manage'),
    async (request, response) => {
      const { bedId } = startSchema.parse(request.body);
      const session = await bedSessions.start(
        getStaffContext(request),
        bedId,
        getRequestId(response),
      );
      response.status(201).json({ bedSession: session });
    },
  );

  router.post(
    '/bed-sessions/:id/close',
    requirePermission('bedSession.manage'),
    async (request, response) => {
      const { id } = idParamsSchema.parse(request.params);
      emptySchema.parse(request.body ?? {});
      const session = await bedSessions.close(getStaffContext(request), id, getRequestId(response));
      response.status(200).json({ bedSession: session });
    },
  );

  return router;
}

// Mounted under /public. Hospital, bed, and BedSession come only from the
// guest session; any client-supplied identifier is rejected by the schema.
export function createGuestSessionRouter(guestSessions: GuestSessionService): Router {
  const router = Router();

  router.get('/session', requireGuestSession(guestSessions), async (request, response) => {
    emptySchema.parse(request.query);
    const location = await guestSessions.describe(getGuestContext(request));
    response.status(200).json({ location });
  });

  return router;
}
