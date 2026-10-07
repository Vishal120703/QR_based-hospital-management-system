import { Router } from 'express';
import { registerCrudRoutes } from '../../http/crud.js';
import { requirePermission, requireScopedPermission } from '../../middleware/staff-auth.js';
import { type LocationController } from './location.controller.js';

// Mounted under /admin. Reads accept a floor- or ward-level permission; the
// service then returns only that area. Changes need hospital-wide permission.
export function createLocationRoutes(controller: LocationController): Router {
  const router = Router();
  const locations = {
    read: requireScopedPermission('location.read'),
    manage: requirePermission('location.manage'),
  };
  registerCrudRoutes(router, '/buildings', controller.buildings, locations);
  registerCrudRoutes(router, '/floors', controller.floors, locations);
  registerCrudRoutes(router, '/wards', controller.wards, locations);
  registerCrudRoutes(router, '/rooms', controller.rooms, locations);
  registerCrudRoutes(router, '/beds', controller.beds, {
    read: requireScopedPermission('bed.read'),
    manage: requirePermission('bed.manage'),
  });
  router.post('/wards/:id/bulk-beds', requirePermission('bed.manage'), controller.bulkBeds);
  return router;
}
