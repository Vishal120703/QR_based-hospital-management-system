import { type RequestHandler } from 'express';
import { NotFoundError } from '../../common/errors/app-error.js';
import { emptySchema } from '../../common/validation.js';
import { getRequestId } from '../../middleware/request-id.js';
import { getStaffContext } from '../../middleware/staff-auth.js';
import { logoParamsSchema, updateHospitalSchema } from './hospital.schemas.js';
import { type HospitalService } from './hospital.service.js';

export class HospitalController {
  public constructor(private readonly hospitals: HospitalService) {}

  public readonly get: RequestHandler = async (request, response) => {
    emptySchema.parse(request.query);
    response
      .status(200)
      .json({ hospital: await this.hospitals.getCurrent(getStaffContext(request)) });
  };

  public readonly update: RequestHandler = async (request, response) => {
    const input = updateHospitalSchema.parse(request.body);
    const hospital = await this.hospitals.updateCurrent(
      getStaffContext(request),
      input,
      getRequestId(response),
    );
    response.status(200).json({ hospital });
  };

  // The image is the raw request body; its type is checked from the bytes.
  public readonly setLogo: RequestHandler = async (request, response) => {
    const body: unknown = request.body;
    const data = Buffer.isBuffer(body) ? body : Buffer.alloc(0);
    const result = await this.hospitals.setLogo(
      getStaffContext(request),
      data,
      getRequestId(response),
    );
    response.status(200).json(result);
  };

  public readonly removeLogo: RequestHandler = async (request, response) => {
    await this.hospitals.removeLogo(getStaffContext(request), getRequestId(response));
    response.status(204).send();
  };

  // Public: logos are shown to patients and printed on labels. The URL is an
  // unguessable id that changes with every upload.
  public readonly publicLogo: RequestHandler = async (request, response) => {
    const parsed = logoParamsSchema.safeParse(request.params);
    const logo = parsed.success ? await this.hospitals.readLogo(parsed.data.publicId) : null;
    if (!logo) throw new NotFoundError();
    response
      .status(200)
      .set({
        'content-type': logo.contentType,
        'cache-control': 'public, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
        'cross-origin-resource-policy': 'same-site',
      })
      .send(Buffer.from(logo.data));
  };
}
