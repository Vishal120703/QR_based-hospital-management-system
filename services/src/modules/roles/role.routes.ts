import { Router } from 'express';
import { requirePermission } from '../../middleware/staff-auth.js';
import { type RoleController } from './role.controller.js';

// Mounted under /admin. Giving or taking away a role needs both staff and
// role management.
export function createRoleRoutes(controller: RoleController): Router {
  const router = Router();
  const canRead = requirePermission('role.read');
  const canManage = requirePermission('role.manage');
  const canAssign = [requirePermission('staff.manage'), canManage];

  router.get('/roles', canRead, controller.list);
  router.get('/roles/:id', canRead, controller.get);
  router.post('/roles', canManage, controller.create);
  router.patch('/roles/:id', canManage, controller.update);
  router.delete('/roles/:id', canManage, controller.remove);

  router.post('/memberships/:id/roles', ...canAssign, controller.assign);
  router.delete('/memberships/:id/roles/:roleId', ...canAssign, controller.unassign);
  router.delete(
    '/memberships/:id/roles/:roleId/scopes/:scopeId',
    ...canAssign,
    controller.unassign,
  );
  return router;
}
