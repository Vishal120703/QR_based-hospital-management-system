// Public interface of the bed-sessions module: admissions (bed sessions) and
// the patient guest sessions created by scanning a QR.
export { BedSessionController, GuestSessionController } from './bed-session.controller.js';
export { createBedSessionRoutes, createGuestSessionRoutes } from './bed-session.routes.js';
export { BedSessionService } from './bed-session.service.js';
export {
  GuestSessionService,
  type GuestContext,
  type GuestLocation,
} from './guest-session.service.js';
