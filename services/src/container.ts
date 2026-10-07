import { Router } from 'express';
import { type PrismaClient } from '@prisma/client';
import { type RateLimitOptions } from './middleware/rate-limit.js';
import { requireStaffAuth } from './middleware/staff-auth.js';
import { AuditController, AuditService, createAuditRoutes } from './modules/audit/index.js';
import {
  AuthController,
  createAuthRoutes,
  StaffAuthService,
  type LoginRateLimits,
} from './modules/auth/index.js';
import {
  BedSessionController,
  BedSessionService,
  createBedSessionRoutes,
  createGuestSessionRoutes,
  GuestSessionController,
  GuestSessionService,
} from './modules/bed-sessions/index.js';
import {
  CatalogController,
  CategoryService,
  createCatalogRoutes,
  createPublicCatalogRoutes,
  ServiceItemService,
} from './modules/catalog/index.js';
import {
  createDepartmentRoutes,
  DepartmentController,
  DepartmentService,
} from './modules/departments/index.js';
import {
  createHospitalRoutes,
  createPublicLogoRoutes,
  HospitalController,
  HospitalService,
} from './modules/hospitals/index.js';
import {
  createLocationRoutes,
  LocationController,
  LocationService,
} from './modules/locations/index.js';
import {
  createPlatformRoutes,
  PlatformAuthController,
  PlatformAuthService,
  PlatformController,
  PlatformService,
} from './modules/platform/index.js';
import {
  createQrAdminRoutes,
  createQrPublicRoutes,
  QrCodeService,
  QrController,
} from './modules/qr/index.js';
import { createReportRoutes, ReportController, ReportService } from './modules/reports/index.js';
import {
  createPatientRequestRoutes,
  createRequestRoutes,
  PatientRequestController,
  RequestController,
  RequestService,
} from './modules/requests/index.js';
import { createRoleRoutes, RoleController, RoleService } from './modules/roles/index.js';
import {
  createSlaRoutes,
  EscalationPolicyService,
  SlaController,
  SlaPolicyService,
} from './modules/sla/index.js';
import {
  createStaffRoutes,
  ShiftController,
  ShiftService,
  StaffController,
  StaffService,
} from './modules/staff/index.js';

export interface ContainerSettings {
  readonly publicAppUrl: string;
  readonly guestSessionTtlMinutes: number;
  readonly qrResolveRateLimit: RateLimitOptions;
  readonly platformLoginRateLimit: RateLimitOptions;
  readonly staffLoginRateLimits?: LoginRateLimits | undefined;
}

export interface ApplicationRoutes {
  // Mounted at the root: /auth/staff/*, /auth/platform/*, and /platform/*.
  readonly root: Router[];
  // Mounted under /admin, after one staff sign-in check.
  readonly admin: Router;
  // Mounted under /public, for patients (guest sessions) and logos.
  readonly public: Router;
}

// The composition root: creates every module's service and controller once,
// connects the modules that depend on each other, and groups their routes by
// who may call them. A new module is added here and nowhere else.
export function createContainer(
  database: PrismaClient,
  settings: ContainerSettings,
): ApplicationRoutes {
  // Services other modules depend on.
  const staffAuth = new StaffAuthService(database);
  const guestSessions = new GuestSessionService(database, settings.guestSessionTtlMinutes);
  const requests = new RequestService(database);
  const platformAuth = new PlatformAuthService(database);

  // Controllers used by more than one route group.
  const hospitals = new HospitalController(new HospitalService(database));
  const catalog = new CatalogController(
    new CategoryService(database),
    new ServiceItemService(database),
  );
  const qrCodes = new QrController(
    new QrCodeService(database, guestSessions, settings.publicAppUrl),
  );

  const root = [
    createAuthRoutes(new AuthController(staffAuth), staffAuth, settings.staffLoginRateLimits),
    createPlatformRoutes(
      new PlatformAuthController(platformAuth),
      new PlatformController(new PlatformService(database)),
      platformAuth,
      settings.platformLoginRateLimit,
    ),
  ];

  // Every administrative route is authenticated exactly once, here; each
  // route then checks its own permission.
  const admin = Router();
  admin.use(requireStaffAuth(staffAuth));
  admin.use(createHospitalRoutes(hospitals));
  admin.use(createRoleRoutes(new RoleController(new RoleService(database))));
  admin.use(createLocationRoutes(new LocationController(new LocationService(database))));
  admin.use(
    createBedSessionRoutes(
      new BedSessionController(new BedSessionService(database, guestSessions)),
    ),
  );
  admin.use(createQrAdminRoutes(qrCodes));
  admin.use(createDepartmentRoutes(new DepartmentController(new DepartmentService(database))));
  admin.use(
    createStaffRoutes(
      new StaffController(new StaffService(database)),
      new ShiftController(new ShiftService(database)),
    ),
  );
  admin.use(createCatalogRoutes(catalog));
  admin.use(
    createSlaRoutes(
      new SlaController(new SlaPolicyService(database), new EscalationPolicyService(database)),
    ),
  );
  admin.use(createRequestRoutes(new RequestController(requests)));
  admin.use(createReportRoutes(new ReportController(new ReportService(database))));
  admin.use(createAuditRoutes(new AuditController(new AuditService(database))));

  // Patient routes. Guest authentication is applied per route, so it can
  // never leak onto another route.
  const patient = Router();
  patient.use(createPublicLogoRoutes(hospitals));
  patient.use(createQrPublicRoutes(qrCodes, settings.qrResolveRateLimit));
  patient.use(createGuestSessionRoutes(new GuestSessionController(guestSessions), guestSessions));
  patient.use(createPublicCatalogRoutes(catalog, guestSessions));
  patient.use(createPatientRequestRoutes(new PatientRequestController(requests), guestSessions));

  return { root, admin, public: patient };
}
