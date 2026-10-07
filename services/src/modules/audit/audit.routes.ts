import { Router } from 'express';
import { requirePermission } from '../../middleware/staff-auth.js';
import { type AuditController } from './audit.controller.js';

// Mounted under /admin. The audit log is hospital-wide.
export function createAuditRoutes(controller: AuditController): Router {
  const router = Router();
  router.get('/audit-log', requirePermission('audit.read'), controller.list);
  return router;
}
