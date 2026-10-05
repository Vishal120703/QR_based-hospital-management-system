import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { loadConfig } from '../../src/config/env.js';

const validEnvironment = {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: '4000',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgresql://careqr:careqr@localhost:5432/careqr',
  REDIS_URL: 'redis://localhost:6379',
};

describe('environment configuration', () => {
  it('parses a valid environment', () => {
    const config = loadConfig(validEnvironment);

    expect(config.port).toBe(4000);
  });

  it('refuses startup when required environment values are missing', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(ZodError);
  });

  it('refuses unsupported connection protocols', () => {
    expect(() =>
      loadConfig({
        ...validEnvironment,
        DATABASE_URL: 'mysql://localhost/careqr',
      }),
    ).toThrow(ZodError);
  });
});
