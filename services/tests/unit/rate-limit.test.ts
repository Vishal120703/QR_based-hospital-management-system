import { describe, expect, it } from 'vitest';
import { type NextFunction, type Request, type Response } from 'express';
import { TooManyRequestsError } from '../../src/common/errors/app-error.js';
import { rateLimit } from '../../src/middleware/rate-limit.js';
import { staffAccountKey } from '../../src/modules/auth/auth.routes.js';
import { platformAccountKey } from '../../src/modules/platform/platform.routes.js';

function invoke(
  handler: ReturnType<typeof rateLimit>,
  key: string,
): { error: unknown; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  let error: unknown;
  const request = { ip: key } as Request;
  const response = {
    setHeader(name: string, value: string) {
      headers[name] = value;
      return this;
    },
  } as unknown as Response;
  const next = ((value?: unknown) => {
    error = value;
  }) as NextFunction;
  handler(request, response, next);
  return { error, headers };
}

describe('rateLimit', () => {
  it('fails closed for new keys at capacity without evicting active counters', () => {
    const handler = rateLimit({ windowMs: 60_000, max: 1, maxKeys: 2 });

    expect(invoke(handler, 'first').error).toBeUndefined();
    expect(invoke(handler, 'second').error).toBeUndefined();
    expect(invoke(handler, 'attacker').error).toBeInstanceOf(TooManyRequestsError);
    expect(invoke(handler, 'first').error).toBeInstanceOf(TooManyRequestsError);
  });

  it('rejects invalid limits during startup', () => {
    expect(() => rateLimit({ windowMs: 0, max: 1 })).toThrow(/windowMs/);
    expect(() => rateLimit({ windowMs: 1, max: 0 })).toThrow(/max/);
    expect(() => rateLimit({ windowMs: 1, max: 1, maxKeys: 0 })).toThrow(/maxKeys/);
  });
});

describe('login account keys', () => {
  const request = (ip: string, body: object) => ({ ip, body }) as Request;

  it('uses the same staff key across different source addresses', () => {
    const body = { hospitalCode: ' CARE ', email: ' NURSE@EXAMPLE.TEST ' };
    expect(staffAccountKey(request('198.51.100.1', body))).toBe(
      staffAccountKey(request('203.0.113.9', body)),
    );
    expect(staffAccountKey(request('198.51.100.1', body))).toBe('care|nurse@example.test');
  });

  it('uses the same platform key across different source addresses', () => {
    const body = { email: ' ADMIN@EXAMPLE.TEST ' };
    expect(platformAccountKey(request('198.51.100.1', body))).toBe(
      platformAccountKey(request('203.0.113.9', body)),
    );
    expect(platformAccountKey(request('198.51.100.1', body))).toBe('admin@example.test');
  });
});
