import { Router } from 'express';
import { registerCrudRoutes } from '../../http/crud.js';
import { requirePermission } from '../../middleware/staff-auth.js';
import { type SlaController } from './sla.controller.js';

// Mounted under /admin. Reading policies needs only service.read, because the
// catalog screens show them; changing them needs sla.manage.
export function createSlaRoutes(controller: SlaController): Router {
  const router = Router();
  const guards = {
    read: requirePermission('service.read'),
    manage: requirePermission('sla.manage'),
  };
  registerCrudRoutes(router, '/sla-policies', controller.policies, guards);
  registerCrudRoutes(router, '/escalation-policies', controller.escalations, guards);
  return router;
}
