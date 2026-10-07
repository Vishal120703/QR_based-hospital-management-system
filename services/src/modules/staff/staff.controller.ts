import { type RequestHandler } from 'express';
import { emptySchema, idParamsSchema } from '../../common/validation.js';
import { getRequestId } from '../../middleware/request-id.js';
import { getStaffContext } from '../../middleware/staff-auth.js';
import {
  coverageParamsSchema,
  coverageSchema,
  createStaffSchema,
  dutySchema,
  eligibleQuerySchema,
  staffDepartmentParamsSchema,
  staffDepartmentSchema,
  staffListQuerySchema,
  staffStatusSchema,
} from './staff.schemas.js';
import { type StaffService } from './staff.service.js';

export class StaffController {
  public constructor(private readonly staff: StaffService) {}

  public readonly list: RequestHandler = async (request, response) => {
    const filter = staffListQuerySchema.parse(request.query);
    response.status(200).json({ staff: await this.staff.list(getStaffContext(request), filter) });
  };

  public readonly eligible: RequestHandler = async (request, response) => {
    const query = eligibleQuerySchema.parse(request.query);
    response
      .status(200)
      .json({ staff: await this.staff.eligible(getStaffContext(request), query) });
  };

  public readonly get: RequestHandler = async (request, response) => {
    const { id } = idParamsSchema.parse(request.params);
    emptySchema.parse(request.query);
    response.status(200).json({ staff: await this.staff.get(getStaffContext(request), id) });
  };

  public readonly create: RequestHandler = async (request, response) => {
    const input = createStaffSchema.parse(request.body);
    const created = await this.staff.create(
      getStaffContext(request),
      input,
      getRequestId(response),
    );
    response.status(201).json({ staff: created });
  };

  public readonly setStatus: RequestHandler = async (request, response) => {
    const { id } = idParamsSchema.parse(request.params);
    const { status } = staffStatusSchema.parse(request.body);
    const updated = await this.staff.setStatus(
      getStaffContext(request),
      id,
      status,
      getRequestId(response),
    );
    response.status(200).json({ staff: updated });
  };

  public readonly setDuty: RequestHandler = async (request, response) => {
    const { id } = idParamsSchema.parse(request.params);
    const { dutyStatus } = dutySchema.parse(request.body);
    const updated = await this.staff.setDuty(
      getStaffContext(request),
      id,
      dutyStatus,
      getRequestId(response),
    );
    response.status(200).json({ staff: updated });
  };

  public readonly addDepartment: RequestHandler = async (request, response) => {
    const { id } = idParamsSchema.parse(request.params);
    const { departmentId } = staffDepartmentSchema.parse(request.body);
    const updated = await this.staff.addDepartment(
      getStaffContext(request),
      id,
      departmentId,
      getRequestId(response),
    );
    response.status(201).json({ staff: updated });
  };

  public readonly removeDepartment: RequestHandler = async (request, response) => {
    const { id, departmentId } = staffDepartmentParamsSchema.parse(request.params);
    emptySchema.parse(request.body ?? {});
    const updated = await this.staff.removeDepartment(
      getStaffContext(request),
      id,
      departmentId,
      getRequestId(response),
    );
    response.status(200).json({ staff: updated });
  };

  public readonly addCoverage: RequestHandler = async (request, response) => {
    const { id } = idParamsSchema.parse(request.params);
    const input = coverageSchema.parse(request.body);
    const updated = await this.staff.addCoverage(
      getStaffContext(request),
      id,
      input,
      getRequestId(response),
    );
    response.status(201).json({ staff: updated });
  };

  public readonly removeCoverage: RequestHandler = async (request, response) => {
    const { id, coverageId } = coverageParamsSchema.parse(request.params);
    emptySchema.parse(request.body ?? {});
    const updated = await this.staff.removeCoverage(
      getStaffContext(request),
      id,
      coverageId,
      getRequestId(response),
    );
    response.status(200).json({ staff: updated });
  };
}
