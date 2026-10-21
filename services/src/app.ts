import express, { type Express } from 'express';
import { pinoHttp } from 'pino-http';
import { type Logger, type SerializedRequest } from 'pino';
import { type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { NotFoundError } from './common/errors/app-error.js';
import { developmentQrTokenEncryptionKey } from './common/qr-token-encryption.js';
import { createContainer } from './container.js';
import { createHealthRouter, type ReadinessProbe } from './http/health.routes.js';
import { cors } from './middleware/cors.js';
import { errorHandler } from './middleware/error-handler.js';
import { type RateLimitOptions } from './middleware/rate-limit.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import { type LoginRateLimits } from './modules/auth/index.js';
import { createRoutes } from './routes/index.js';

const noQuerySchema = z.object({}).strict();

export interface CreateAppOptions {
  readonly logger: Logger;
  readonly readinessProbes?: readonly ReadinessProbe[];
  readonly database?: PrismaClient;
  readonly publicAppUrl?: string;
  readonly qrTokenEncryptionKey?: Buffer;
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
// routes (src/routes/index.ts), then "not found" and error handling.
export function createApp(options: CreateAppOptions): Express {
  const application = express();
  application.disable('x-powered-by');
  application.set('trust proxy', options.trustProxy ?? 0);

  // Authenticated JSON and errors must not survive in browser/shared caches.
  // Public logo handlers explicitly override caching for their versioned URLs.
  application.use((_request, response, next) => {
    response.setHeader('cache-control', 'no-store');
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('referrer-policy', 'no-referrer');
    response.setHeader('x-frame-options', 'DENY');
    next();
  });

  application.use(cors(options.corsOrigins ?? []));
  application.use(requestIdMiddleware);
  application.use(
    pinoHttp({
      logger: options.logger,
      genReqId: (_request, response) => String(response.getHeader('x-request-id') ?? 'unknown'),
      serializers: {
        // Do not log headers, request bodies or query values: even a rejected
        // request can contain a QR/session secret or personal information.
        req: (request: SerializedRequest) => ({
          id: request.id,
          method: request.method,
          url: request.url?.split('?')[0],
          remoteAddress: request.remoteAddress,
          remotePort: request.remotePort,
        }),
      },
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
    const container = createContainer(options.database, {
      logger: options.logger,
      publicAppUrl: options.publicAppUrl ?? 'http://localhost:5173',
      qrTokenEncryptionKey: options.qrTokenEncryptionKey ?? developmentQrTokenEncryptionKey,
      guestSessionTtlMinutes: options.guestSessionTtlMinutes ?? 120,
    });
    application.use(
      createRoutes(container, {
        qrResolveRateLimit: options.qrResolveRateLimit ?? { windowMs: 60_000, max: 30 },
        platformLoginRateLimit: options.platformLoginRateLimit ?? { windowMs: 60_000, max: 10 },
        staffLoginRateLimits: options.staffLoginRateLimits,
      }),
    );
  }
  options.configureRoutes?.(application);

  application.use(() => {
    throw new NotFoundError();
  });
  application.use(errorHandler);

  return application;
}
