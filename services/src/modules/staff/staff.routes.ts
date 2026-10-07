import { Router } from 'express';
import { requirePermission, requireScopedPermission } from '../../middleware/staff-auth.js';
import { type ShiftController } from './shift.controller.js';
import { type StaffController } from './staff.controller.js';

// Mounted under /admin: staff, their duty, departments, coverage, and shifts.
export function createStaffRoutes(staff: StaffController, shifts: ShiftController): Router {
  const router = Router();
  const canRead = requirePermission('staff.read');
  const canManage = requirePermission('staff.manage');

  router.get('/staff', canRead, staff.list);
  // Registered before /staff/:id so "eligible" is not parsed as an ID. A floor
  // or ward manager may check eligibility for beds inside their own scope.
  router.get('/staff/eligible', requireScopedPermission('staff.read'), staff.eligible);
  router.get('/staff/:id', canRead, staff.get);
  router.post('/staff', canManage, staff.create);
  router.post('/staff/:id/status', canManage, staff.setStatus);
  router.post('/staff/:id/duty', canManage, staff.setDuty);
  router.post('/staff/:id/departments', canManage, staff.addDepartment);
  router.delete('/staff/:id/departments/:departmentId', canManage, staff.removeDepartment);
  router.post('/staff/:id/coverage', canManage, staff.addCoverage);
  router.delete('/staff/:id/coverage/:coverageId', canManage, staff.removeCoverage);

  router.get('/shifts', canRead, shifts.list);
  router.post('/shifts', canManage, shifts.create);
  router.delete('/shifts/:id', canManage, shifts.remove);
  return router;
}
