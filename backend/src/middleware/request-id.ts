import { randomUUID } from 'node:crypto';
import { type RequestHandler, type Response } from 'express';

export const requestIdMiddleware: RequestHandler = (_request, response, next) => {
  const requestId = randomUUID();
  response.locals.requestId = requestId;
  response.setHeader('x-request-id', requestId);
  next();
};

export function getRequestId(response: Response): string {
  return String(response.getHeader('x-request-id'));
}
