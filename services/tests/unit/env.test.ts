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

  it('starts without Redis, which nothing needs yet', () => {
    const config = loadConfig({ ...validEnvironment, REDIS_URL: '' });
    expect(config.redisUrl).toBeNull();
  });

  it('needs the web app address in production and allows it to call the API', () => {
    const production = { ...validEnvironment, NODE_ENV: 'production', REDIS_URL: undefined };
    expect(() => loadConfig(production)).toThrow('PUBLIC_APP_URL');
    const config = loadConfig({
      ...production,
      PUBLIC_APP_URL: 'https://care-qr.vercel.app/',
      CORS_ORIGINS: 'https://preview.vercel.app/, http://localhost:5173',
    });
    expect(config.publicAppUrl).toBe('https://care-qr.vercel.app');
    expect(config.corsOrigins).toEqual([
      'https://care-qr.vercel.app',
      'https://preview.vercel.app',
      'http://localhost:5173',
    ]);
    // Behind Render's proxy by default, so rate limits see each visitor.
    expect(config.trustProxy).toBe(1);
    expect(loadConfig({ ...validEnvironment }).trustProxy).toBe(0);
  });

  it('names a malformed address instead of crashing', () => {
    expect(() => loadConfig({ ...validEnvironment, DATABASE_URL: 'not a url' })).toThrow(ZodError);
    expect(() => loadConfig({ ...validEnvironment, CORS_ORIGINS: 'ftp://files.example' })).toThrow(
      'Not a web origin',
    );
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
