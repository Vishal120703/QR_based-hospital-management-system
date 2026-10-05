import { type Request, type RequestHandler } from 'express';
import { z } from 'zod';
import { ForbiddenError, UnauthorizedError } from '../common/errors/app-error.js';
import { type StaffAuthService, type StaffContext } from '../modules/auth/auth.service.js';

const bearerSchema = z.string().regex(/^Bearer [A-Za-z0-9_-]{43}$/);

export function requireStaffAuth(auth: StaffAuthService): RequestHandler {
  return async (request, _response, next) => {
    try {
      const parsed = bearerSchema.safeParse(request.header('authorization'));
      if (!parsed.success) {
        throw new UnauthorizedError();
      }

      const token = parsed.data.slice('Bearer '.length);
      const context = await auth.authenticate(token);
      request.staff = context;
      request.user = context.user;
      request.tenant = context.tenant;
      request.permissions = [...context.permissions];
      request.scopes = context.scopes;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requirePermission(permission: string): RequestHandler {
  return (request, _response, next) => {
    if (!request.staff) {
      next(new UnauthorizedError());
      return;
    }
    if (!request.staff.permissions.has(permission)) {
      next(new ForbiddenError());
      return;
    }
    next();
  };
}

export function getStaffContext(request: Request): StaffContext {
  if (!request.staff) {
    throw new UnauthorizedError();
  }
  return request.staff;
}
