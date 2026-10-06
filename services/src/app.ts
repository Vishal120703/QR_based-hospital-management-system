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
import { PlatformAuthService } from './modules/platform/platform-auth.service.js';
import { createPlatformRouter } from './modules/platform/platform.routes.js';
import { PlatformService } from './modules/platform/platform.service.js';
import { HospitalService } from './modules/hospitals/hospital.service.js';
import {
  createHospitalRouter,
  createPublicLogoRouter,
} from './modules/hospitals/hospital.routes.js';
import { RoleService } from './modules/roles/role.service.js';
import { createRoleRouter } from './modules/roles/role.routes.js';
import { LocationService } from './modules/locations/location.service.js';
import { createLocationRouter } from './modules/locations/location.routes.js';
import { GuestSessionService } from './modules/bed-sessions/guest-session.service.js';
import { BedSessionService } from './modules/bed-sessions/bed-session.service.js';
import {
  createBedSessionRouter,
  createGuestSessionRouter,
} from './modules/bed-sessions/bed-session.routes.js';
import { QrCodeService } from './modules/qr/qr.service.js';
import { createQrAdminRouter, createQrPublicRouter } from './modules/qr/qr.routes.js';
import { DepartmentService } from './modules/departments/department.service.js';
import { createDepartmentRouter } from './modules/departments/department.routes.js';
import { StaffService } from './modules/staff/staff.service.js';
import { ShiftService } from './modules/staff/shift.service.js';
import { createStaffRouter } from './modules/staff/staff.routes.js';
import { CategoryService } from './modules/catalog/category.service.js';
import { ServiceItemService } from './modules/catalog/service-item.service.js';
import {
  createCatalogRouter,
  createPublicCatalogRouter,
} from './modules/catalog/catalog.routes.js';
import { SlaPolicyService } from './modules/sla/sla-policy.service.js';
import { EscalationPolicyService } from './modules/sla/escalation-policy.service.js';
import { createSlaRouter } from './modules/sla/sla.routes.js';
import { RequestService } from './modules/requests/request.service.js';
import {
  createPublicRequestRouter,
  createRequestRouter,
} from './modules/requests/request.routes.js';
import { type RateLimitOptions } from './middleware/rate-limit.js';
import { z } from 'zod';

const noQuerySchema = z.object({}).strict();

export interface CreateAppOptions {
  readonly logger: Logger;
  readonly readinessProbes?: readonly ReadinessProbe[];
  readonly database?: PrismaClient;
  readonly publicAppUrl?: string;
  readonly guestSessionTtlMinutes?: number;
  readonly qrResolveRateLimit?: RateLimitOptions;
  readonly platformLoginRateLimit?: RateLimitOptions;
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
  // Commands never take query parameters. GET handlers validate their own query.
  application.use((request, _response, next) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      noQuerySchema.parse(request.query);
    }
    next();
  });

  application.use(createHealthRouter(options.readinessProbes ?? []));
  if (options.database) {
    const database = options.database;
    const auth = new StaffAuthService(database);
    const guestSessions = new GuestSessionService(database, options.guestSessionTtlMinutes ?? 120);
    const serviceItems = new ServiceItemService(database);
    const requests = new RequestService(database);
    const qrCodes = new QrCodeService(
      database,
      guestSessions,
      options.publicAppUrl ?? 'http://localhost:5173',
    );
    application.use(createAuthRouter(auth));
    application.use(
      createPlatformRouter(
        new PlatformAuthService(database),
        new PlatformService(database),
        options.platformLoginRateLimit ?? { windowMs: 60_000, max: 10 },
      ),
    );

    // Every administrative route is authenticated exactly once, here.
    const admin = Router();
    admin.use(requireStaffAuth(auth));
    const hospitals = new HospitalService(database);
    admin.use(createHospitalRouter(hospitals));
    admin.use(createRoleRouter(new RoleService(database)));
    admin.use(createLocationRouter(new LocationService(database)));
    admin.use(createBedSessionRouter(new BedSessionService(database, guestSessions)));
    admin.use(createQrAdminRouter(qrCodes));
    admin.use(createDepartmentRouter(new DepartmentService(database)));
    admin.use(createStaffRouter(new StaffService(database), new ShiftService(database)));
    admin.use(createCatalogRouter(new CategoryService(database), serviceItems));
    admin.use(
      createSlaRouter(new SlaPolicyService(database), new EscalationPolicyService(database)),
    );
    admin.use(createRequestRouter(requests));
    application.use('/admin', admin);

    // Patient/attendant routes. Guest authentication is applied per route.
    const publicRoutes = Router();
    publicRoutes.use(createPublicLogoRouter(hospitals));
    publicRoutes.use(
      createQrPublicRouter(qrCodes, options.qrResolveRateLimit ?? { windowMs: 60_000, max: 30 }),
    );
    publicRoutes.use(createGuestSessionRouter(guestSessions));
    publicRoutes.use(createPublicCatalogRouter(serviceItems, guestSessions));
    publicRoutes.use(createPublicRequestRouter(requests, guestSessions));
    application.use('/public', publicRoutes);
  }
  options.configureRoutes?.(application);

  application.use(() => {
    throw new NotFoundError();
  });
  application.use(errorHandler);

  return application;
}
