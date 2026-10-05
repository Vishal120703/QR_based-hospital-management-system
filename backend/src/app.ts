import express, { Router, type Express } from 'express';
import { pinoHttp } from 'pino-http';
import { type Logger } from 'pino';
import { NotFoundError } from './common/errors/app-error.js';
import { errorHandler } from './middleware/error-handler.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import { requireStaffAuth } from './middleware/staff-auth.js';
import { createHealthRouter, type ReadinessProbe } from './routes/health.js';
import { type PrismaClient } from '@prisma/client';
import { StaffAuthService } from './modules/auth/auth.service.js';
import { createAuthRouter } from './modules/auth/auth.routes.js';
import { HospitalService } from './modules/hospitals/hospital.service.js';
import { createHospitalRouter } from './modules/hospitals/hospital.routes.js';
import { RoleService } from './modules/roles/role.service.js';
import { createRoleRouter } from './modules/roles/role.routes.js';
import { z } from 'zod';

const noQuerySchema = z.object({}).strict();

export interface CreateAppOptions {
  readonly logger: Logger;
  readonly readinessProbes?: readonly ReadinessProbe[];
  readonly database?: PrismaClient;
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
  application.use((request, _response, next) => {
    noQuerySchema.parse(request.query);
    next();
  });

  application.use(createHealthRouter(options.readinessProbes ?? []));
  if (options.database) {
    const auth = new StaffAuthService(options.database);
    application.use(createAuthRouter(auth));

    // Every administrative route is authenticated exactly once, here.
    const admin = Router();
    admin.use(requireStaffAuth(auth));
    admin.use(createHospitalRouter(new HospitalService(options.database)));
    admin.use(createRoleRouter(new RoleService(options.database)));
    application.use('/admin', admin);
  }
  options.configureRoutes?.(application);

  application.use(() => {
    throw new NotFoundError();
  });
  application.use(errorHandler);

  return application;
}
