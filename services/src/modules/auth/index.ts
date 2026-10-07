// Public interface of the auth module: staff sign-in, sessions, and the staff
// context every other module uses to check access.
export { AuthController } from './auth.controller.js';
export { createAuthRoutes, type LoginRateLimits } from './auth.routes.js';
export { revokeHospitalSessions, revokeStaffSessions, StaffAuthService } from './auth.service.js';
export { hashPassword, verifyPasswordOrDummy } from './password.js';
export { bedScopeWhere, canAccessLocation, scopesFor, type StaffContext } from './staff-context.js';
