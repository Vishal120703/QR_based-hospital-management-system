import { type RequestHandler } from 'express';
import { emptySchema, idParamsSchema } from '../../common/validation.js';
import { getStaffContext } from '../../middleware/staff-auth.js';
import { reportQuerySchema, reportRange, requestLogQuerySchema } from './report.schemas.js';
import { type ReportService } from './report.service.js';

export class ReportController {
  public constructor(private readonly reports: ReportService) {}

  public readonly summary: RequestHandler = async (request, response) => {
    const query = reportQuerySchema.parse(request.query);
    const context = getStaffContext(request);
    response
      .status(200)
      .json(await this.reports.requestReport(context, reportRange(query, context.tenant.timezone)));
  };

  public readonly log: RequestHandler = async (request, response) => {
    const { from, to, ...filter } = requestLogQuerySchema.parse(request.query);
    const context = getStaffContext(request);
    const range = reportRange({ from, to }, context.tenant.timezone);
    response.status(200).json(await this.reports.requestLog(context, range, filter));
  };

  public readonly person: RequestHandler = async (request, response) => {
    const { id } = idParamsSchema.parse(request.params);
    const query = reportQuerySchema.parse(request.query);
    const context = getStaffContext(request);
    response
      .status(200)
      .json(
        await this.reports.personReport(context, id, reportRange(query, context.tenant.timezone)),
      );
  };

  public readonly timeline: RequestHandler = async (request, response) => {
    const { id } = idParamsSchema.parse(request.params);
    emptySchema.parse(request.query);
    response
      .status(200)
      .json({ request: await this.reports.requestTimeline(getStaffContext(request), id) });
  };
}
