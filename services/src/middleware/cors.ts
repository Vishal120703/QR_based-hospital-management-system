import { type RequestHandler } from 'express';

// Lets the web app call the API from its own address (for example the
// frontend on Vercel and the API on Render). Only the listed origins are
// allowed; sign-in uses a bearer token, never cookies, so no credentials mode.
export function cors(allowedOrigins: readonly string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);
  return (request, response, next) => {
    const origin = request.headers.origin;
    response.vary('Origin');
    if (!origin || !allowed.has(origin)) {
      next();
      return;
    }
    response.setHeader('access-control-allow-origin', origin);
    response.setHeader('access-control-expose-headers', 'x-request-id, retry-after');
    if (request.method === 'OPTIONS') {
      response.setHeader('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE');
      response.setHeader('access-control-allow-headers', 'authorization, content-type');
      response.setHeader('access-control-max-age', '600');
      response.status(204).end();
      return;
    }
    next();
  };
}
