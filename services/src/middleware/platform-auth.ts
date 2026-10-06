import { type Request, type RequestHandler } from 'express';
import { z } from 'zod';
import { UnauthorizedError } from '../common/errors/app-error.js';
import {
  type PlatformAuthService,
  type PlatformContext,
} from '../modules/platform/platform-auth.service.js';

const bearerSchema = z.string().regex(/^Bearer [A-Za-z0-9_-]{43}$/);

export function requirePlatformAuth(auth: PlatformAuthService): RequestHandler {
  return async (request, _response, next) => {
    try {
      const parsed = bearerSchema.safeParse(request.header('authorization'));
      if (!parsed.success) throw new UnauthorizedError();
      request.platform = await auth.authenticate(parsed.data.slice('Bearer '.length));
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function getPlatformContext(request: Request): PlatformContext {
  if (!request.platform) throw new UnauthorizedError();
  return request.platform;
}
