import { Router } from 'express';
import { requireGuestSession } from '../../middleware/guest-auth.js';
import { requireScopedPermission } from '../../middleware/staff-auth.js';
import {
  type BedSessionController,
  type GuestSessionController,
} from './bed-session.controller.js';
import { type GuestSessionService } from './guest-session.service.js';

// Mounted under /admin. Floor and ward managers act only in their own area.
export function createBedSessionRoutes(controller: BedSessionController): Router {
  const router = Router();
  const canManage = requireScopedPermission('bedSession.manage');
  router.get('/bed-sessions', requireScopedPermission('bed.read'), controller.list);
  router.post('/bed-sessions', canManage, controller.start);
  router.post('/bed-sessions/:id/close', canManage, controller.close);
  return router;
}

// Mounted under /public. Hospital, bed, and bed session come only from the
// guest session; any client-supplied identifier is rejected by the schema.
export function createGuestSessionRoutes(
  controller: GuestSessionController,
  guestSessions: GuestSessionService,
): Router {
  const router = Router();
  router.get('/session', requireGuestSession(guestSessions), controller.describe);
  return router;
}
