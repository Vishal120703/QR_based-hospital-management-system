import { type RequestHandler } from 'express';
import { InvalidInputError } from '../../common/errors/app-error.js';
import { periodEnd, periodStart } from '../../common/time-zone.js';
import { getStaffContext } from '../../middleware/staff-auth.js';
import { auditQuerySchema } from './audit.schemas.js';
import { type AuditService } from './audit.service.js';

export class AuditController {
  public constructor(private readonly audit: AuditService) {}

  public readonly list: RequestHandler = async (request, response) => {
    const { from, to, ...filter } = auditQuerySchema.parse(request.query);
    const context = getStaffContext(request);
    // Days are the hospital's own; the end day is included.
    const start = from ? periodStart(from, context.tenant.timezone) : undefined;
    const end = to ? periodEnd(to, context.tenant.timezone) : undefined;
    if (start && end && start >= end) {
      throw new InvalidInputError('The start must be before the end.');
    }
    response.status(200).json(await this.audit.list(context, { ...filter, from: start, to: end }));
  };
}
