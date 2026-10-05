import { type RequestHandler } from 'express';
import { TooManyRequestsError } from '../common/errors/app-error.js';

export interface RateLimitOptions {
  readonly windowMs: number;
  readonly max: number;
}

const pruneThreshold = 10_000;

// Fixed-window limit per client IP. Counters live in this process, which is
// correct for the single V1 backend process; running several instances needs
// a shared store, and running behind a proxy needs Express "trust proxy".
export function rateLimit(options: RateLimitOptions): RequestHandler {
  const windows = new Map<string, { count: number; resetAt: number }>();

  return (request, response, next) => {
    const now = Date.now();
    if (windows.size > pruneThreshold) {
      for (const [key, window] of windows) {
        if (window.resetAt <= now) windows.delete(key);
      }
    }

    const key = request.ip ?? 'unknown';
    let window = windows.get(key);
    if (!window || window.resetAt <= now) {
      window = { count: 0, resetAt: now + options.windowMs };
      windows.set(key, window);
    }
    window.count += 1;

    if (window.count > options.max) {
      response.setHeader('retry-after', String(Math.ceil((window.resetAt - now) / 1000)));
      next(new TooManyRequestsError());
      return;
    }
    next();
  };
}
