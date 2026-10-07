import { type RequestHandler, type Response } from 'express';
import { ForbiddenError } from '../../common/errors/app-error.js';
import { emptySchema, idParamsSchema } from '../../common/validation.js';
import { getRequestId } from '../../middleware/request-id.js';
import { getStaffContext } from '../../middleware/staff-auth.js';
import { qrBatchSchema, qrListQuerySchema, resolveQrSchema } from './qr.schemas.js';
import { type QrCodeService } from './qr.service.js';

// Responses carrying a raw token must never be cached by browsers or proxies.
function noStore(response: Response): Response {
  return response.setHeader('cache-control', 'no-store');
}

export class QrController {
  public constructor(private readonly qrCodes: QrCodeService) {}

  public readonly list: RequestHandler = async (request, response) => {
    const filter = qrListQuerySchema.parse(request.query);
    response
      .status(200)
      .json({ qrCodes: await this.qrCodes.list(getStaffContext(request), filter) });
  };

  public readonly generateBatch: RequestHandler = async (request, response) => {
    const { scope, replaceExisting } = qrBatchSchema.parse(request.body);
    const context = getStaffContext(request);
    // Replacing live labels is a rotation, so it needs that permission too.
    if (replaceExisting && !context.hospitalPermissions.has('qr.rotate')) {
      throw new ForbiddenError();
    }
    const result = await this.qrCodes.generateBatch(
      context,
      scope,
      replaceExisting,
      getRequestId(response),
    );
    noStore(response).status(201).json(result);
  };

  public readonly generate: RequestHandler = async (request, response) => {
    const { id } = idParamsSchema.parse(request.params);
    emptySchema.parse(request.body ?? {});
    const issue = await this.qrCodes.generate(getStaffContext(request), id, getRequestId(response));
    noStore(response).status(201).json(issue);
  };

  public readonly rotate: RequestHandler = async (request, response) => {
    const { id } = idParamsSchema.parse(request.params);
    emptySchema.parse(request.body ?? {});
    const issue = await this.qrCodes.rotate(getStaffContext(request), id, getRequestId(response));
    noStore(response).status(200).json(issue);
  };

  public readonly revoke: RequestHandler = async (request, response) => {
    const { id } = idParamsSchema.parse(request.params);
    emptySchema.parse(request.body ?? {});
    const qrCode = await this.qrCodes.revoke(getStaffContext(request), id, getRequestId(response));
    response.status(200).json({ qrCode });
  };

  // Public: the token travels in the body, never the URL, so it does not
  // appear in access logs.
  public readonly resolve: RequestHandler = async (request, response) => {
    const { token } = resolveQrSchema.parse(request.body);
    const resolved = await this.qrCodes.resolve(token);
    noStore(response).status(201).json({
      guestToken: resolved.guestToken,
      expiresAt: resolved.guest.expiresAt.toISOString(),
      location: resolved.location,
    });
  };
}
