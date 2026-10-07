import { type RequestHandler } from 'express';
import { emptySchema, idParamsSchema } from '../../common/validation.js';
import { getGuestContext } from '../../middleware/guest-auth.js';
import { getRequestId } from '../../middleware/request-id.js';
import { getStaffContext } from '../../middleware/staff-auth.js';
import {
  guestCancelSchema,
  publicIdParamsSchema,
  requestCommands,
  submitRequestSchema,
  type RequestCommand,
} from './request.schemas.js';
import { type RequestService } from './request.service.js';

// Staff work on requests: lists, one request, its history, and the commands.
export class RequestController {
  public constructor(private readonly requests: RequestService) {}

  public readonly list: RequestHandler = async (request, response) => {
    emptySchema.parse(request.query);
    response
      .status(200)
      .json({ serviceRequests: await this.requests.list(getStaffContext(request)) });
  };

  public readonly get: RequestHandler = async (request, response) => {
    const { id } = idParamsSchema.parse(request.params);
    emptySchema.parse(request.query);
    response
      .status(200)
      .json({ serviceRequest: await this.requests.get(getStaffContext(request), id) });
  };

  public readonly events: RequestHandler = async (request, response) => {
    const { id } = idParamsSchema.parse(request.params);
    emptySchema.parse(request.query);
    response.status(200).json({ events: await this.requests.events(getStaffContext(request), id) });
  };

  // One handler per command (assign, accept, …), each with its own body schema.
  public command(name: RequestCommand): RequestHandler {
    const definition = requestCommands.find((command) => command.name === name)!;
    return async (request, response) => {
      const { id } = idParamsSchema.parse(request.params);
      const input = definition.schema.parse(request.body);
      const serviceRequest = await this.requests[name](
        getStaffContext(request),
        id,
        input,
        getRequestId(response),
      );
      response.status(200).json({ serviceRequest });
    };
  }
}

// The patient's own requests, for their bed stay only.
export class PatientRequestController {
  public constructor(private readonly requests: RequestService) {}

  public readonly list: RequestHandler = async (request, response) => {
    emptySchema.parse(request.query);
    const serviceRequests = await this.requests.listForGuest(getGuestContext(request));
    response.status(200).json({ serviceRequests });
  };

  public readonly submit: RequestHandler = async (request, response) => {
    const { serviceId } = submitRequestSchema.parse(request.body);
    const result = await this.requests.submitForGuest(
      getGuestContext(request),
      serviceId,
      getRequestId(response),
    );
    response.status(result.created ? 201 : 200).json({ serviceRequest: result.serviceRequest });
  };

  public readonly cancel: RequestHandler = async (request, response) => {
    const { publicId } = publicIdParamsSchema.parse(request.params);
    const { reason } = guestCancelSchema.parse(request.body);
    const serviceRequest = await this.requests.cancelForGuest(
      getGuestContext(request),
      publicId,
      reason,
      getRequestId(response),
    );
    response.status(200).json({ serviceRequest });
  };
}
