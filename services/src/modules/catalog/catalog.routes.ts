import { Router } from 'express';
import { registerCrudRoutes } from '../../http/crud.js';
import { requireGuestSession } from '../../middleware/guest-auth.js';
import { requirePermission } from '../../middleware/staff-auth.js';
import { type GuestSessionService } from '../bed-sessions/index.js';
import { type CatalogController } from './catalog.controller.js';

// Mounted under /admin.
export function createCatalogRoutes(controller: CatalogController): Router {
  const router = Router();
  const guards = {
    read: requirePermission('service.read'),
    manage: requirePermission('service.manage'),
  };
  registerCrudRoutes(router, '/service-categories', controller.categories, guards);
  registerCrudRoutes(router, '/services', controller.services, guards);
  return router;
}

// Mounted under /public: the service buttons a patient sees.
export function createPublicCatalogRoutes(
  controller: CatalogController,
  guestSessions: GuestSessionService,
): Router {
  const router = Router();
  router.get('/services', requireGuestSession(guestSessions), controller.patientCatalog);
  return router;
}
