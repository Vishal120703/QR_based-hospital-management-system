import { type RequestHandler } from 'express';
import { getStaffContext } from '../../middleware/staff-auth.js';
import { auditQuerySchema } from './audit.schemas.js';
import { type AuditService } from './audit.service.js';

export class AuditController {
  public constructor(private readonly audit: AuditService) {}

  public readonly list: RequestHandler = async (request, response) => {
    const query = auditQuerySchema.parse(request.query);
    response.status(200).json(await this.audit.list(getStaffContext(request), query));
  };
}
