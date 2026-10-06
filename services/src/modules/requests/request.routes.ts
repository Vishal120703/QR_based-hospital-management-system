import { Router } from 'express';
import { z } from 'zod';
import { getGuestContext, requireGuestSession } from '../../middleware/guest-auth.js';
import { getRequestId } from '../../middleware/request-id.js';
import { getStaffContext, requirePermission } from '../../middleware/staff-auth.js';
import { type GuestSessionService } from '../bed-sessions/guest-session.service.js';
import { type RequestService } from './request.service.js';

const empty = z.object({}).strict();
const params = z.object({ id: z.string().uuid() }).strict();
const version = z.number().int().positive();
const reason = z.string().trim().min(1).max(500);
const simple = z.object({ expectedVersion: version }).strict();
const withReason = simple.extend({ reason }).strict();
const withAssignee = simple.extend({ assigneeId: z.string().uuid() }).strict();
const transfer = withAssignee.extend({ reason }).strict();

// Mounted under /admin; there is deliberately no arbitrary status PATCH.
export function createRequestRouter(requests: RequestService): Router {
  const router = Router();

  router.get('/requests/:id', requirePermission('request.read'), async (request, response) => {
    empty.parse(request.query);
    const { id } = params.parse(request.params);
    response.status(200).json({ serviceRequest: await requests.get(getStaffContext(request), id) });
  });
  router.get(
    '/requests/:id/events',
    requirePermission('request.read'),
    async (request, response) => {
      empty.parse(request.query);
      const { id } = params.parse(request.params);
      response.status(200).json({ events: await requests.events(getStaffContext(request), id) });
    },
  );

  const commands = [
    { name: 'assign', permission: 'request.assign', schema: withAssignee },
    { name: 'accept', permission: 'request.accept', schema: simple },
    { name: 'start', permission: 'request.start', schema: simple },
    { name: 'complete', permission: 'request.complete', schema: simple },
    { name: 'close', permission: 'request.close', schema: simple },
    { name: 'cancel', permission: 'request.cancel', schema: withReason },
    { name: 'reject', permission: 'request.reject', schema: withReason },
    { name: 'transfer', permission: 'request.transfer', schema: transfer },
  ] as const;
  for (const command of commands) {
    router.post(
      `/requests/:id/${command.name}`,
      requirePermission(command.permission),
      async (request, response) => {
        const { id } = params.parse(request.params);
        const input = command.schema.parse(request.body);
        const serviceRequest = await requests[command.name](
          getStaffContext(request),
          id,
          input,
          getRequestId(response),
        );
        response.status(200).json({ serviceRequest });
      },
    );
  }
  return router;
}

// Mounted under /public. Every route authenticates a GuestSession and derives
// tenant/bed/session exclusively from that server-side credential.
export function createPublicRequestRouter(
  requests: RequestService,
  guestSessions: GuestSessionService,
): Router {
  const router = Router();
  router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });

  router.get('/requests', requireGuestSession(guestSessions), async (request, response) => {
    empty.parse(request.query);
    const serviceRequests = await requests.listForGuest(getGuestContext(request));
    response.status(200).json({ serviceRequests });
  });

  router.post('/requests', requireGuestSession(guestSessions), async (request, response) => {
    const { serviceId } = z.object({ serviceId: z.string().uuid() }).strict().parse(request.body);
    const result = await requests.submitForGuest(
      getGuestContext(request),
      serviceId,
      getRequestId(response),
    );
    response.status(result.created ? 201 : 200).json({ serviceRequest: result.serviceRequest });
  });

  router.post(
    '/requests/:publicId/cancel',
    requireGuestSession(guestSessions),
    async (request, response) => {
      const { publicId } = z
        .object({ publicId: z.string().regex(/^CR-[A-F0-9]{16}$/) })
        .strict()
        .parse(request.params);
      const { reason: cancellationReason } = z.object({ reason }).strict().parse(request.body);
      const serviceRequest = await requests.cancelForGuest(
        getGuestContext(request),
        publicId,
        cancellationReason,
        getRequestId(response),
      );
      response.status(200).json({ serviceRequest });
    },
  );

  return router;
}
