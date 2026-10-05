import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { createApp } from '../../src/app.js';
import { createLogger } from '../../src/config/logger.js';

const logger = createLogger('silent');

describe('HTTP foundation', () => {
  it('returns 200 from GET /health', async () => {
    const response = await request(createApp({ logger })).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ok' });
  });

  it('rejects unknown query input', async () => {
    const response = await request(createApp({ logger })).get('/health?hospitalId=forged');

    expect(response.status).toBe(400);
  });

  it('generates a request ID', async () => {
    const response = await request(createApp({ logger })).get('/health');
    const requestId = response.headers['x-request-id'];

    expect(typeof requestId).toBe('string');
    expect(z.object({ requestId: z.string() }).parse(response.body).requestId).toBe(requestId);
    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('returns a safe standardized response for an unhandled error', async () => {
    const application = createApp({
      logger,
      configureRoutes(app) {
        app.get('/test/unhandled', () => {
          throw new Error('sensitive implementation detail');
        });
      },
    });

    const response = await request(application).get('/test/unhandled');

    expect(response.status).toBe(500);
    expect(
      z.object({ error: z.object({ code: z.string(), message: z.string() }) }).parse(response.body)
        .error,
    ).toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred.',
    });
    expect(JSON.stringify(response.body)).not.toContain('sensitive implementation detail');
    expect(JSON.stringify(response.body)).not.toContain('stack');
  });

  it('maps a database RESTRICT violation to 409 without leaking details', async () => {
    const application = createApp({
      logger,
      configureRoutes(app) {
        app.get('/test/restrict', () => {
          throw new Prisma.PrismaClientUnknownRequestError(
            'PostgresError { code: "23001", message: "violates RESTRICT setting of foreign key constraint \\"Secret_fkey\\"" }',
            { clientVersion: Prisma.prismaVersion.client },
          );
        });
      },
    });

    const response = await request(application).get('/test/restrict');

    expect(response.status).toBe(409);
    expect(JSON.stringify(response.body)).not.toContain('Secret_fkey');
  });

  it('checks PostgreSQL and Redis readiness probes', async () => {
    const databaseCheck = vi.fn().mockResolvedValue(undefined);
    const redisCheck = vi.fn().mockResolvedValue(undefined);
    const application = createApp({
      logger,
      readinessProbes: [
        { name: 'postgresql', check: databaseCheck },
        { name: 'redis', check: redisCheck },
      ],
    });

    const response = await request(application).get('/ready');

    expect(response.status).toBe(200);
    expect(databaseCheck).toHaveBeenCalledOnce();
    expect(redisCheck).toHaveBeenCalledOnce();
    expect(
      z
        .object({ dependencies: z.array(z.object({ name: z.string(), status: z.string() })) })
        .parse(response.body).dependencies,
    ).toEqual([
      { name: 'postgresql', status: 'ok' },
      { name: 'redis', status: 'ok' },
    ]);
  });

  it('returns 503 when a readiness dependency fails', async () => {
    const application = createApp({
      logger,
      readinessProbes: [
        {
          name: 'postgresql',
          check: () => Promise.reject(new Error('connection refused')),
        },
      ],
    });

    const response = await request(application).get('/ready');

    expect(response.status).toBe(503);
    expect(
      z.object({ error: z.object({ code: z.string() }) }).parse(response.body).error.code,
    ).toBe('SERVICE_UNAVAILABLE');
    expect(JSON.stringify(response.body)).not.toContain('connection refused');
  });

  it('does not report ready before dependency probes are configured', async () => {
    const response = await request(createApp({ logger })).get('/ready');

    expect(response.status).toBe(503);
  });
});
