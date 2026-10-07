import { type Request, type RequestHandler } from 'express';
import { z } from 'zod';
import { UnauthorizedError } from '../common/errors/app-error.js';
import { type GuestContext, type GuestSessionService } from '../modules/bed-sessions/index.js';

const bearerSchema = z.string().regex(/^Bearer [A-Za-z0-9_-]{43}$/);

// Guest sessions are a separate credential domain from staff sessions: a staff
// token is never found in the GuestSession table, and vice versa.
export function requireGuestSession(guestSessions: GuestSessionService): RequestHandler {
  return async (request, _response, next) => {
    try {
      const parsed = bearerSchema.safeParse(request.header('authorization'));
      if (!parsed.success) {
        throw new UnauthorizedError();
      }
      request.guest = await guestSessions.authenticate(parsed.data.slice('Bearer '.length));
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function getGuestContext(request: Request): GuestContext {
  if (!request.guest) {
    throw new UnauthorizedError();
  }
  return request.guest;
}
