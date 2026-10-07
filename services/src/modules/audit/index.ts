// Public interface of the audit module: recording changes (inside the
// change's transaction) and reading the hospital's audit log.
export { AuditController } from './audit.controller.js';
export { createAuditRoutes } from './audit.routes.js';
export {
  AuditService,
  recordPlatformAudit,
  recordStaffAudit,
  recordSystemAudit,
} from './audit.service.js';
