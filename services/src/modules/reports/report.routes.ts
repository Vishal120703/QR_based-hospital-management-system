import { Router } from 'express';
import { z } from 'zod';
import { InvalidInputError } from '../../common/errors/app-error.js';
import {
  getStaffContext,
  requirePermission,
  requireScopedPermission,
} from '../../middleware/staff-auth.js';
import { type AuditLogService } from './audit-log.service.js';
import { type ReportRange, type ReportService } from './report.service.js';

const dayMs = 24 * 60 * 60 * 1000;
const rangeShape = {
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
};
const reportQuery = z.object(rangeShape).strict();
const logQuery = z
  .object({
    ...rangeShape,
    outcome: z.enum(['open', 'completed', 'cancelled', 'rejected', 'overdue']).optional(),
    departmentId: z.string().uuid().optional(),
    membershipId: z.string().uuid().optional(),
    search: z.string().trim().max(100).optional(),
  })
  .strict();
const auditQuery = z
  .object({
    ...rangeShape,
    category: z
      .string()
      .regex(/^[a-zA-Z]+$/)
      .optional(),
    membershipId: z.string().uuid().optional(),
    before: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

// Defaults to the last 7 days; at most a year at a time.
function range(input: { from?: Date | undefined; to?: Date | undefined }): ReportRange {
  const to = input.to ?? new Date();
  const from = input.from ?? new Date(to.getTime() - 7 * dayMs);
  if (from >= to) throw new InvalidInputError('The start must be before the end.');
  if (to.getTime() - from.getTime() > 366 * dayMs) {
    throw new InvalidInputError('Choose a period of at most one year.');
  }
  return { from, to };
}

// Mounted under /admin. Reports cover the caller's own floor, ward, or
// department (or the whole hospital); the audit log is hospital-wide.
export function createReportRouter(reports: ReportService, audit: AuditLogService): Router {
  const router = Router();
  const canReport = requireScopedPermission('analytics.read');

  router.get('/reports/requests', canReport, async (request, response) => {
    const query = reportQuery.parse(request.query);
    response.status(200).json(await reports.requestReport(getStaffContext(request), range(query)));
  });

  router.get('/reports/requests/log', canReport, async (request, response) => {
    const { from, to, ...filter } = logQuery.parse(request.query);
    response
      .status(200)
      .json(await reports.requestLog(getStaffContext(request), range({ from, to }), filter));
  });

  router.get('/reports/requests/:id', canReport, async (request, response) => {
    const { id } = z.object({ id: z.string().uuid() }).strict().parse(request.params);
    z.object({}).strict().parse(request.query);
    response
      .status(200)
      .json({ request: await reports.requestTimeline(getStaffContext(request), id) });
  });

  router.get('/audit-log', requirePermission('audit.read'), async (request, response) => {
    const query = auditQuery.parse(request.query);
    response.status(200).json(await audit.list(getStaffContext(request), query));
  });

  return router;
}
