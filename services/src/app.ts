import express, { type Express } from 'express';
import { pinoHttp } from 'pino-http';
import { type Logger } from 'pino';
import { type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { NotFoundError } from './common/errors/app-error.js';
import { createContainer } from './container.js';
import { createHealthRouter, type ReadinessProbe } from './http/health.routes.js';
import { cors } from './middleware/cors.js';
import { errorHandler } from './middleware/error-handler.js';
import { type RateLimitOptions } from './middleware/rate-limit.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import { type LoginRateLimits } from './modules/auth/index.js';

const noQuerySchema = z.object({}).strict();

export interface CreateAppOptions {
  readonly logger: Logger;
  readonly readinessProbes?: readonly ReadinessProbe[];
  readonly database?: PrismaClient;
  readonly publicAppUrl?: string;
  readonly guestSessionTtlMinutes?: number;
  readonly qrResolveRateLimit?: RateLimitOptions;
  readonly platformLoginRateLimit?: RateLimitOptions;
  readonly staffLoginRateLimits?: LoginRateLimits;
  readonly configureRoutes?: (application: Express) => void;
  // Web origins (other than the API's own) allowed to call it.
  readonly corsOrigins?: readonly string[];
  // Proxies in front of the API, so rate limits use each visitor's address.
  readonly trustProxy?: number;
}

// The HTTP application: shared middleware, health checks, every module's
// routes (from the container), then "not found" and error handling.
export function createApp(options: CreateAppOptions): Express {
  const application = express();
  application.disable('x-powered-by');
  application.set('trust proxy', options.trustProxy ?? 0);

  application.use(cors(options.corsOrigins ?? []));
  application.use(requestIdMiddleware);
  application.use(
    pinoHttp({
      logger: options.logger,
      genReqId: (_request, response) => String(response.getHeader('x-request-id') ?? 'unknown'),
    }),
  );
  application.use(express.json({ limit: '1mb' }));
  // Commands never take query parameters. GET handlers validate their own query.
  application.use((request, _response, next) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      noQuerySchema.parse(request.query);
    }
    next();
  });

  application.use(createHealthRouter(options.readinessProbes ?? []));
  if (options.database) {
    const routes = createContainer(options.database, {
      publicAppUrl: options.publicAppUrl ?? 'http://localhost:5173',
      guestSessionTtlMinutes: options.guestSessionTtlMinutes ?? 120,
      qrResolveRateLimit: options.qrResolveRateLimit ?? { windowMs: 60_000, max: 30 },
      platformLoginRateLimit: options.platformLoginRateLimit ?? { windowMs: 60_000, max: 10 },
      staffLoginRateLimits: options.staffLoginRateLimits,
    });
    for (const router of routes.root) application.use(router);
    application.use('/admin', routes.admin);
    application.use('/public', routes.public);
  }
  options.configureRoutes?.(application);

  application.use(() => {
    throw new NotFoundError();
  });
  application.use(errorHandler);

  return application;
}
