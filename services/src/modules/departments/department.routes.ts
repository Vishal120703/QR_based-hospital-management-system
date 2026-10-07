import { Router } from 'express';
import { registerCrudRoutes } from '../../http/crud.js';
import { requirePermission } from '../../middleware/staff-auth.js';
import { type DepartmentController } from './department.controller.js';

// Mounted under /admin. Departments are staff organization, so they use the
// staff permissions.
export function createDepartmentRoutes(controller: DepartmentController): Router {
  const router = Router();
  registerCrudRoutes(router, '/departments', controller, {
    read: requirePermission('staff.read'),
    manage: requirePermission('staff.manage'),
  });
  return router;
}
