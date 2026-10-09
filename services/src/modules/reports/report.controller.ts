import { type RequestHandler } from 'express';
import { emptySchema, idParamsSchema } from '../../common/validation.js';
import { getStaffContext } from '../../middleware/staff-auth.js';
import { reportQuerySchema, reportRange, requestLogQuerySchema } from './report.schemas.js';
import { type ReportService } from './report.service.js';

export class ReportController {
  public constructor(private readonly reports: ReportService) {}

  public readonly summary: RequestHandler = async (request, response) => {
    const query = reportQuerySchema.parse(request.query);
    response
      .status(200)
      .json(await this.reports.requestReport(getStaffContext(request), reportRange(query)));
  };

  public readonly log: RequestHandler = async (request, response) => {
    const { from, to, ...filter } = requestLogQuerySchema.parse(request.query);
    response
      .status(200)
      .json(
        await this.reports.requestLog(getStaffContext(request), reportRange({ from, to }), filter),
      );
  };

  public readonly person: RequestHandler = async (request, response) => {
    const { id } = idParamsSchema.parse(request.params);
    const query = reportQuerySchema.parse(request.query);
    response
      .status(200)
      .json(await this.reports.personReport(getStaffContext(request), id, reportRange(query)));
  };

  public readonly timeline: RequestHandler = async (request, response) => {
    const { id } = idParamsSchema.parse(request.params);
    emptySchema.parse(request.query);
    response
      .status(200)
      .json({ request: await this.reports.requestTimeline(getStaffContext(request), id) });
  };
}
