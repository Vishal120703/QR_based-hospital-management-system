import { type PrismaClient } from '@prisma/client';
import { type Logger } from 'pino';
import { AuditController, AuditService } from './modules/audit/index.js';
import { AuthController, StaffAuthService } from './modules/auth/index.js';
import {
  BedSessionController,
  BedSessionService,
  GuestSessionController,
  GuestSessionService,
} from './modules/bed-sessions/index.js';
import { CatalogController, CategoryService, ServiceItemService } from './modules/catalog/index.js';
import { DepartmentController, DepartmentService } from './modules/departments/index.js';
import { HospitalController, HospitalService } from './modules/hospitals/index.js';
import { LocationController, LocationService } from './modules/locations/index.js';
import { NotificationController, NotificationService } from './modules/notifications/index.js';
import {
  PlatformAuthController,
  PlatformAuthService,
  PlatformController,
  PlatformService,
} from './modules/platform/index.js';
import { QrCodeService, QrController } from './modules/qr/index.js';
import { ReportController, ReportService } from './modules/reports/index.js';
import {
  PatientRequestController,
  RequestController,
  RequestService,
} from './modules/requests/index.js';
import { RoleController, RoleService } from './modules/roles/index.js';
import { EscalationPolicyService, SlaController, SlaPolicyService } from './modules/sla/index.js';
import {
  ShiftController,
  ShiftService,
  StaffController,
  StaffService,
} from './modules/staff/index.js';

export interface ContainerSettings {
  readonly logger: Logger;
  readonly publicAppUrl: string;
  readonly qrTokenEncryptionKey: Buffer;
  readonly guestSessionTtlMinutes: number;
  readonly notificationRetentionDays: number;
}

export type Container = ReturnType<typeof createContainer>;

// The composition root: creates every module's service and controller once
// and connects the modules that depend on each other. src/routes/index.ts
// decides which URLs reach each controller.
export function createContainer(database: PrismaClient, settings: ContainerSettings) {
  // Services other modules depend on, and that the routes use to sign callers in.
  const staffAuth = new StaffAuthService(database);
  const guestSessions = new GuestSessionService(database, settings.guestSessionTtlMinutes);
  const requests = new RequestService(database);
  const platformAuth = new PlatformAuthService(database);

  return {
    staffAuth,
    platformAuth,
    guestSessions,
    controllers: {
      auth: new AuthController(staffAuth),
      platformAuth: new PlatformAuthController(platformAuth),
      platform: new PlatformController(new PlatformService(database)),
      hospitals: new HospitalController(new HospitalService(database)),
      roles: new RoleController(new RoleService(database)),
      locations: new LocationController(new LocationService(database)),
      bedSessions: new BedSessionController(new BedSessionService(database, guestSessions)),
      qrCodes: new QrController(
        new QrCodeService(
          database,
          guestSessions,
          settings.publicAppUrl,
          settings.qrTokenEncryptionKey,
        ),
      ),
      departments: new DepartmentController(new DepartmentService(database)),
      staff: new StaffController(new StaffService(database)),
      shifts: new ShiftController(new ShiftService(database)),
      catalog: new CatalogController(
        new CategoryService(database),
        new ServiceItemService(database),
      ),
      sla: new SlaController(new SlaPolicyService(database), new EscalationPolicyService(database)),
      requests: new RequestController(requests),
      reports: new ReportController(new ReportService(database)),
      audit: new AuditController(new AuditService(database)),
      notifications: new NotificationController(
        new NotificationService(
          database,
          settings.logger,
          undefined,
          settings.notificationRetentionDays,
        ),
      ),
      guestSessions: new GuestSessionController(guestSessions),
      patientRequests: new PatientRequestController(requests),
    },
  };
}
