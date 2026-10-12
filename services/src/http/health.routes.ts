import { Router } from 'express';
import { z } from 'zod';
import { ServiceUnavailableError } from '../common/errors/app-error.js';

export interface ReadinessProbe {
  readonly name: string;
  check(): Promise<void>;
}

// A probe that has not answered in time counts as failed.
function withinTime(check: Promise<void>, probeTimeoutMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Readiness probe timed out')), probeTimeoutMs);
  });
  return Promise.race([check, late]).finally(() => clearTimeout(timer));
}

const emptyQuerySchema = z.object({}).strict();

export function createHealthRouter(
  readinessProbes: readonly ReadinessProbe[],
  probeTimeoutMs = 3_000,
): Router {
  const router = Router();

  // The bare address answers too, so a person opening the API in a browser,
  // or a host checking "/" before going live (Render does), sees it is up.
  router.get('/', (request, response) => {
    emptyQuerySchema.parse(request.query);
    response.status(200).json({
      service: 'CARE QR API',
      status: 'ok',
      health: '/health',
      requestId: response.getHeader('x-request-id'),
    });
  });

  // Liveness: the process is running and answering. It checks nothing else,
  // so a database outage does not make a host restart a healthy process.
  router.get('/health', (request, response) => {
    emptyQuerySchema.parse(request.query);
    response.status(200).json({
      status: 'ok',
      requestId: response.getHeader('x-request-id'),
    });
  });

  // Readiness: the API can serve requests, including PostgreSQL (and Redis
  // when configured). 503 otherwise, naming nothing internal; which
  // dependency failed is only logged.
  router.get('/ready', async (request, response) => {
    emptyQuerySchema.parse(request.query);
    const results = await Promise.allSettled(
      readinessProbes.map((probe) => withinTime(probe.check(), probeTimeoutMs)),
    );
    const failed = readinessProbes.filter((_probe, index) => results[index]?.status === 'rejected');
    if (readinessProbes.length === 0 || failed.length > 0) {
      request.log.warn({ failed: failed.map((probe) => probe.name) }, 'Not ready');
      throw new ServiceUnavailableError();
    }

    response.status(200).json({
      status: 'ok',
      dependencies: readinessProbes.map((probe) => ({ name: probe.name, status: 'ok' })),
      requestId: response.getHeader('x-request-id'),
    });
  });

  return router;
}
