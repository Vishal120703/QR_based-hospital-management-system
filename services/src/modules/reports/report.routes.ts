import { Router } from 'express';
import { requireScopedPermission } from '../../middleware/staff-auth.js';
import { type ReportController } from './report.controller.js';

// Mounted under /admin. Reports cover the caller's own floor, ward, or
// department (or the whole hospital), so the permission may be area-scoped.
export function createReportRoutes(controller: ReportController): Router {
  const router = Router();
  const canReport = requireScopedPermission('analytics.read');
  router.get('/reports/requests', canReport, controller.summary);
  router.get('/reports/requests/log', canReport, controller.log);
  router.get('/reports/requests/:id', canReport, controller.timeline);
  // One person's work: :id is their staff membership.
  router.get('/reports/people/:id', canReport, controller.person);
  return router;
}
