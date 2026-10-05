import { Router } from 'express';
import { ServiceUnavailableError } from '../common/errors/app-error.js';

export interface ReadinessProbe {
  readonly name: string;
  check(): Promise<void>;
}

export function createHealthRouter(readinessProbes: readonly ReadinessProbe[]): Router {
  const router = Router();

  router.get('/health', (_request, response) => {
    response.status(200).json({
      status: 'ok',
      requestId: response.getHeader('x-request-id'),
    });
  });

  router.get('/ready', async (_request, response) => {
    const results = await Promise.allSettled(readinessProbes.map((probe) => probe.check()));
    const isReady =
      readinessProbes.length > 0 && results.every((result) => result.status === 'fulfilled');

    if (!isReady) {
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
