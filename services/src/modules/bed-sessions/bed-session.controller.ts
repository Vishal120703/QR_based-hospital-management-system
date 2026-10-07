import { type RequestHandler } from 'express';
import { emptySchema, idParamsSchema } from '../../common/validation.js';
import { getGuestContext } from '../../middleware/guest-auth.js';
import { getRequestId } from '../../middleware/request-id.js';
import { getStaffContext } from '../../middleware/staff-auth.js';
import { bedSessionFilterSchema, startBedSessionSchema } from './bed-session.schemas.js';
import { type BedSessionService } from './bed-session.service.js';
import { type GuestSessionService } from './guest-session.service.js';

export class BedSessionController {
  public constructor(private readonly bedSessions: BedSessionService) {}

  public readonly list: RequestHandler = async (request, response) => {
    const filter = bedSessionFilterSchema.parse(request.query);
    const sessions = await this.bedSessions.list(getStaffContext(request), filter);
    response.status(200).json({ bedSessions: sessions });
  };

  public readonly start: RequestHandler = async (request, response) => {
    const { bedId } = startBedSessionSchema.parse(request.body);
    const session = await this.bedSessions.start(
      getStaffContext(request),
      bedId,
      getRequestId(response),
    );
    response.status(201).json({ bedSession: session });
  };

  public readonly close: RequestHandler = async (request, response) => {
    const { id } = idParamsSchema.parse(request.params);
    emptySchema.parse(request.body ?? {});
    const session = await this.bedSessions.close(
      getStaffContext(request),
      id,
      getRequestId(response),
    );
    response.status(200).json({ bedSession: session });
  };
}

// The patient's own session: where they are and until when.
export class GuestSessionController {
  public constructor(private readonly guestSessions: GuestSessionService) {}

  public readonly describe: RequestHandler = async (request, response) => {
    emptySchema.parse(request.query);
    const location = await this.guestSessions.describe(getGuestContext(request));
    response.status(200).json({ location });
  };
}
