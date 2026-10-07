import { Router } from 'express';
import { requireGuestSession } from '../../middleware/guest-auth.js';
import { requireScopedPermission } from '../../middleware/staff-auth.js';
import { type GuestSessionService } from '../bed-sessions/index.js';
import { type PatientRequestController, type RequestController } from './request.controller.js';
import { requestCommands } from './request.schemas.js';

// Mounted under /admin; there is deliberately no arbitrary status PATCH. The
// permission may be held for part of the hospital: the service checks that
// the request is in the caller's area.
export function createRequestRoutes(controller: RequestController): Router {
  const router = Router();
  const canRead = requireScopedPermission('request.read');
  router.get('/requests', canRead, controller.list);
  router.get('/requests/:id', canRead, controller.get);
  router.get('/requests/:id/events', canRead, controller.events);
  for (const command of requestCommands) {
    router.post(
      `/requests/:id/${command.name}`,
      requireScopedPermission(command.permission),
      controller.command(command.name),
    );
  }
  return router;
}

// Mounted under /public. Every route authenticates a guest session and derives
// hospital, bed, and stay only from that server-side credential.
export function createPatientRequestRoutes(
  controller: PatientRequestController,
  guestSessions: GuestSessionService,
): Router {
  const router = Router();
  const guest = requireGuestSession(guestSessions);
  router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });
  router.get('/requests', guest, controller.list);
  router.post('/requests', guest, controller.submit);
  router.post('/requests/:publicId/cancel', guest, controller.cancel);
  return router;
}
