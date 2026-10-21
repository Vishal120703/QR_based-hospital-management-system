import { type RequestHandler } from 'express';
import { emptySchema, idParamsSchema } from '../../common/validation.js';
import { getGuestContext } from '../../middleware/guest-auth.js';
import { getRequestId } from '../../middleware/request-id.js';
import { getStaffContext } from '../../middleware/staff-auth.js';
import {
  guestCancelSchema,
  publicIdParamsSchema,
  requestCommands,
  requestQueueQuerySchema,
  submitRequestSchema,
  type RequestCommand,
} from './request.schemas.js';
import { type RequestService } from './request.service.js';

// Staff work on requests: lists, one request, its history, and the commands.
export class RequestController {
  public constructor(private readonly requests: RequestService) {}

  // One page of open, completed, or finished work (see RequestQueryService.list).
  public readonly list: RequestHandler = async (request, response) => {
    const query = requestQueueQuerySchema.parse(request.query);
    response.status(200).json(await this.requests.queries.list(getStaffContext(request), query));
  };

  // What needs this person's attention: new, overdue, and escalated work.
  public readonly alerts: RequestHandler = async (request, response) => {
    emptySchema.parse(request.query);
    response.status(200).json(await this.requests.queries.alerts(getStaffContext(request)));
  };

  public readonly get: RequestHandler = async (request, response) => {
    const { id } = idParamsSchema.parse(request.params);
    emptySchema.parse(request.query);
    response
      .status(200)
      .json({ serviceRequest: await this.requests.queries.get(getStaffContext(request), id) });
  };

  public readonly events: RequestHandler = async (request, response) => {
    const { id } = idParamsSchema.parse(request.params);
    emptySchema.parse(request.query);
    response
      .status(200)
      .json({ events: await this.requests.queries.events(getStaffContext(request), id) });
  };

  // One handler per command (assign, accept, …), each with its own body schema.
  public command(name: RequestCommand): RequestHandler {
    const definition = requestCommands.find((command) => command.name === name)!;
    return async (request, response) => {
      const { id } = idParamsSchema.parse(request.params);
      const input = definition.schema.parse(request.body);
      const serviceRequest = await this.requests.commands.run(
        getStaffContext(request),
        id,
        name,
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
    const serviceRequests = await this.requests.patients.listForGuest(getGuestContext(request));
    response.status(200).json({ serviceRequests });
  };

  public readonly submit: RequestHandler = async (request, response) => {
    const { serviceId } = submitRequestSchema.parse(request.body);
    const result = await this.requests.patients.submitForGuest(
      getGuestContext(request),
      serviceId,
      getRequestId(response),
    );
    response.status(result.created ? 201 : 200).json({ serviceRequest: result.serviceRequest });
  };

  public readonly cancel: RequestHandler = async (request, response) => {
    const { publicId } = publicIdParamsSchema.parse(request.params);
    const { reason } = guestCancelSchema.parse(request.body);
    const serviceRequest = await this.requests.patients.cancelForGuest(
      getGuestContext(request),
      publicId,
      reason,
      getRequestId(response),
    );
    response.status(200).json({ serviceRequest });
  };
}
