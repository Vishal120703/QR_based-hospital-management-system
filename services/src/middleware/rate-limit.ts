import { type Request, type RequestHandler } from 'express';
import { TooManyRequestsError } from '../common/errors/app-error.js';

export interface RateLimitOptions {
  readonly windowMs: number;
  readonly max: number;
  // Hard memory bound for this limiter. New keys fail closed while full.
  readonly maxKeys?: number;
  // Counts per this key instead of per client IP, for example per account.
  readonly key?: (request: Request) => string;
}

const defaultMaxKeys = 10_000;

// Fixed-window limit per client IP. Counters live in this process, which is
// correct for the single V1 backend process; running several instances needs
// a shared store, and running behind a proxy needs Express "trust proxy".
export function rateLimit(options: RateLimitOptions): RequestHandler {
  if (!Number.isSafeInteger(options.max) || options.max <= 0) {
    throw new TypeError('Rate limit max must be a positive integer');
  }
  if (!Number.isSafeInteger(options.windowMs) || options.windowMs <= 0) {
    throw new TypeError('Rate limit windowMs must be a positive integer');
  }
  const maxKeys = options.maxKeys ?? defaultMaxKeys;
  if (!Number.isSafeInteger(maxKeys) || maxKeys <= 0) {
    throw new TypeError('Rate limit maxKeys must be a positive integer');
  }

  const windows = new Map<string, { count: number; resetAt: number }>();
  let expirations: Array<{ key: string; resetAt: number }> = [];
  let expirationCursor = 0;

  const pruneExpired = (now: number) => {
    while (expirationCursor < expirations.length) {
      const expiration = expirations[expirationCursor]!;
      if (expiration.resetAt > now) break;
      const current = windows.get(expiration.key);
      if (current?.resetAt === expiration.resetAt) windows.delete(expiration.key);
      expirationCursor += 1;
    }

    // Array slicing is occasional and bounded, so normal requests never scan
    // the entire key set and stale expiry records cannot grow forever.
    if (expirationCursor >= 1_024 && expirationCursor * 2 >= expirations.length) {
      expirations = expirations.slice(expirationCursor);
      expirationCursor = 0;
    }
  };

  return (request, response, next) => {
    const now = Date.now();
    pruneExpired(now);

    const key = options.key ? options.key(request) : (request.ip ?? 'unknown');
    let window = windows.get(key);
    if (!window || window.resetAt <= now) {
      if (windows.size >= maxKeys) {
        const earliestReset = expirations[expirationCursor]?.resetAt ?? now + options.windowMs;
        response.setHeader(
          'retry-after',
          String(Math.max(1, Math.ceil((earliestReset - now) / 1_000))),
        );
        next(new TooManyRequestsError());
        return;
      }
      window = { count: 0, resetAt: now + options.windowMs };
      windows.set(key, window);
      expirations.push({ key, resetAt: window.resetAt });
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
