import { Router } from 'express';
import { type Container } from '../container.js';
import { type RateLimitOptions } from '../middleware/rate-limit.js';
import { requireStaffAuth } from '../middleware/staff-auth.js';
import { createAuditRoutes } from '../modules/audit/index.js';
import { createAuthRoutes, type LoginRateLimits } from '../modules/auth/index.js';
import { createBedSessionRoutes, createGuestSessionRoutes } from '../modules/bed-sessions/index.js';
import { createCatalogRoutes, createPublicCatalogRoutes } from '../modules/catalog/index.js';
import { createDepartmentRoutes } from '../modules/departments/index.js';
import { createHospitalRoutes, createPublicLogoRoutes } from '../modules/hospitals/index.js';
import { createLocationRoutes } from '../modules/locations/index.js';
import { createNotificationRoutes } from '../modules/notifications/index.js';
import { createPlatformRoutes } from '../modules/platform/index.js';
import { createQrAdminRoutes, createQrPublicRoutes } from '../modules/qr/index.js';
import { createReportRoutes } from '../modules/reports/index.js';
import { createPatientRequestRoutes, createRequestRoutes } from '../modules/requests/index.js';
import { createRoleRoutes } from '../modules/roles/index.js';
import { createSlaRoutes } from '../modules/sla/index.js';
import { createStaffRoutes } from '../modules/staff/index.js';

export interface RouteSettings {
  readonly qrResolveRateLimit: RateLimitOptions;
  readonly platformLoginRateLimit: RateLimitOptions;
  readonly staffLoginRateLimits?: LoginRateLimits | undefined;
}

// The API's URL map: every module's routes, grouped by who may call them.
// Each module's *.routes.ts declares its exact paths and permission checks;
// app.ts mounts /health and /ready before these. A new module's routes go here.
export function createRoutes(container: Container, settings: RouteSettings): Router {
  const { controllers, staffAuth, platformAuth, guestSessions } = container;
  const router = Router();

  // Sign-in for hospital staff (/auth/staff/*) and platform operators
  // (/auth/platform/*), and the platform console (/platform/*).
  router.use(createAuthRoutes(controllers.auth, staffAuth, settings.staffLoginRateLimits));
  router.use(
    createPlatformRoutes(
      controllers.platformAuth,
      controllers.platform,
      platformAuth,
      settings.platformLoginRateLimit,
    ),
  );

  // /admin/*: hospital staff. Every route is authenticated exactly once, here;
  // each route then checks its own permission.
  const admin = Router();
  admin.use(requireStaffAuth(staffAuth));
  admin.use(createHospitalRoutes(controllers.hospitals)); // /hospital
  admin.use(createRoleRoutes(controllers.roles)); // /roles, /memberships/:id/roles
  admin.use(createLocationRoutes(controllers.locations)); // /buildings, /floors, /wards, /rooms, /beds
  admin.use(createBedSessionRoutes(controllers.bedSessions)); // /bed-sessions, /bed-occupancy
  admin.use(createQrAdminRoutes(controllers.qrCodes)); // /qr-codes, /beds/:id/qr
  admin.use(createDepartmentRoutes(controllers.departments)); // /departments
  admin.use(createStaffRoutes(controllers.staff, controllers.shifts)); // /staff, /shifts
  admin.use(createCatalogRoutes(controllers.catalog)); // /service-categories, /services
  admin.use(createSlaRoutes(controllers.sla)); // /sla-policies, /escalation-policies
  admin.use(createRequestRoutes(controllers.requests)); // /requests
  admin.use(createReportRoutes(controllers.reports)); // /reports
  admin.use(createAuditRoutes(controllers.audit)); // /audit-log
  admin.use(createNotificationRoutes(controllers.notifications)); // /notifications
  router.use('/admin', admin);

  // /public/*: patients. Guest authentication is applied per route, so it can
  // never leak onto another route.
  const patient = Router();
  patient.use(createPublicLogoRoutes(controllers.hospitals)); // /logos/:publicId
  patient.use(createQrPublicRoutes(controllers.qrCodes, settings.qrResolveRateLimit)); // /qr/resolve
  patient.use(createGuestSessionRoutes(controllers.guestSessions, guestSessions)); // /session
  patient.use(createPublicCatalogRoutes(controllers.catalog, guestSessions)); // /services
  patient.use(createPatientRequestRoutes(controllers.patientRequests, guestSessions)); // /requests
  router.use('/public', patient);

  return router;
}
