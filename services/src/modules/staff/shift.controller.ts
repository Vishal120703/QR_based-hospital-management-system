import { type RequestHandler } from 'express';
import { emptySchema, idParamsSchema } from '../../common/validation.js';
import { getRequestId } from '../../middleware/request-id.js';
import { getStaffContext } from '../../middleware/staff-auth.js';
import { createShiftSchema, shiftQuerySchema } from './shift.schemas.js';
import { type ShiftService } from './shift.service.js';

export class ShiftController {
  public constructor(private readonly shifts: ShiftService) {}

  public readonly list: RequestHandler = async (request, response) => {
    const filter = shiftQuerySchema.parse(request.query);
    response.status(200).json({ shifts: await this.shifts.list(getStaffContext(request), filter) });
  };

  public readonly create: RequestHandler = async (request, response) => {
    const input = createShiftSchema.parse(request.body);
    const shift = await this.shifts.create(getStaffContext(request), input, getRequestId(response));
    response.status(201).json({ shift });
  };

  public readonly remove: RequestHandler = async (request, response) => {
    const { id } = idParamsSchema.parse(request.params);
    emptySchema.parse(request.body ?? {});
    await this.shifts.remove(getStaffContext(request), id, getRequestId(response));
    response.status(204).send();
  };
}
