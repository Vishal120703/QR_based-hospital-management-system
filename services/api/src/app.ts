import express, { type Express } from 'express';
import { pinoHttp } from 'pino-http';
import { type Logger } from 'pino';
import { NotFoundError } from './common/errors/app-error.js';
import { errorHandler } from './middleware/error-handler.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import { createHealthRouter, type ReadinessProbe } from './routes/health.js';

export interface CreateAppOptions {
  readonly logger: Logger;
  readonly readinessProbes?: readonly ReadinessProbe[];
  readonly configureRoutes?: (application: Express) => void;
}

export function createApp(options: CreateAppOptions): Express {
  const application = express();
  application.disable('x-powered-by');

  application.use(requestIdMiddleware);
  application.use(
    pinoHttp({
      logger: options.logger,
      genReqId: (_request, response) => String(response.getHeader('x-request-id') ?? 'unknown'),
    }),
  );
  application.use(express.json({ limit: '1mb' }));

  application.use(createHealthRouter(options.readinessProbes ?? []));
  options.configureRoutes?.(application);

  application.use(() => {
    throw new NotFoundError();
  });
  application.use(errorHandler);

  return application;
}
