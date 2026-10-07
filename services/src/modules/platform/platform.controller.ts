import { type RequestHandler } from 'express';
import { emptySchema, idParamsSchema } from '../../common/validation.js';
import { getPlatformContext } from '../../middleware/platform-auth.js';
import { getRequestId } from '../../middleware/request-id.js';
import { type PlatformAuthService } from './platform-auth.service.js';
import {
  addManagerSchema,
  createHospitalSchema,
  platformLoginSchema,
  updateClientSchema,
  updateHospitalSchema,
} from './platform.schemas.js';
import { type PlatformService } from './platform.service.js';

// Super admin sign-in, current session, and sign-out.
export class PlatformAuthController {
  public constructor(private readonly auth: PlatformAuthService) {}

  public readonly login: RequestHandler = async (request, response) => {
    const result = await this.auth.login(platformLoginSchema.parse(request.body));
    response.status(200).json({ token: result.token, expiresAt: result.expiresAt.toISOString() });
  };

  public readonly me: RequestHandler = (request, response) => {
    emptySchema.parse(request.query);
    const { userId, email, displayName } = getPlatformContext(request);
    response.status(200).json({ user: { id: userId, email, displayName } });
  };

  public readonly logout: RequestHandler = async (request, response) => {
    emptySchema.parse(request.body ?? {});
    await this.auth.logout(getPlatformContext(request));
    response.status(204).send();
  };
}

// Clients and their hospitals.
export class PlatformController {
  public constructor(private readonly platform: PlatformService) {}

  public readonly listClients: RequestHandler = async (request, response) => {
    emptySchema.parse(request.query);
    response.status(200).json({ clients: await this.platform.listClients() });
  };

  public readonly getClient: RequestHandler = async (request, response) => {
    const { id } = idParamsSchema.parse(request.params);
    emptySchema.parse(request.query);
    response.status(200).json({ client: await this.platform.getClient(id) });
  };

  public readonly updateClient: RequestHandler = async (request, response) => {
    const { id } = idParamsSchema.parse(request.params);
    const client = await this.platform.updateClient(
      getPlatformContext(request),
      id,
      updateClientSchema.parse(request.body),
      getRequestId(response),
    );
    response.status(200).json({ client });
  };

  public readonly listHospitals: RequestHandler = async (request, response) => {
    emptySchema.parse(request.query);
    response.status(200).json({ hospitals: await this.platform.listHospitals() });
  };

  public readonly createHospital: RequestHandler = async (request, response) => {
    const hospital = await this.platform.createHospital(
      getPlatformContext(request),
      createHospitalSchema.parse(request.body),
      getRequestId(response),
    );
    response.status(201).json({ hospital });
  };

  public readonly getHospital: RequestHandler = async (request, response) => {
    const { id } = idParamsSchema.parse(request.params);
    emptySchema.parse(request.query);
    response.status(200).json({ hospital: await this.platform.getHospital(id) });
  };

  public readonly updateHospital: RequestHandler = async (request, response) => {
    const { id } = idParamsSchema.parse(request.params);
    const hospital = await this.platform.updateHospital(
      getPlatformContext(request),
      id,
      updateHospitalSchema.parse(request.body),
      getRequestId(response),
    );
    response.status(200).json({ hospital });
  };

  // The image is the raw request body; its type is checked from the bytes.
  public readonly setLogo: RequestHandler = async (request, response) => {
    const { id } = idParamsSchema.parse(request.params);
    const body: unknown = request.body;
    const bytes = Buffer.isBuffer(body) ? body : Buffer.alloc(0);
    const result = await this.platform.setLogo(
      getPlatformContext(request),
      id,
      bytes,
      getRequestId(response),
    );
    response.status(200).json(result);
  };

  public readonly removeLogo: RequestHandler = async (request, response) => {
    const { id } = idParamsSchema.parse(request.params);
    emptySchema.parse(request.body ?? {});
    await this.platform.removeLogo(getPlatformContext(request), id, getRequestId(response));
    response.status(204).send();
  };

  public readonly addManager: RequestHandler = async (request, response) => {
    const { id } = idParamsSchema.parse(request.params);
    const hospital = await this.platform.addManager(
      getPlatformContext(request),
      id,
      addManagerSchema.parse(request.body),
      getRequestId(response),
    );
    response.status(201).json({ hospital });
  };
}
