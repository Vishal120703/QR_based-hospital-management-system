import { type StaffContext } from '../modules/auth/auth.service.js';
import { type GuestContext } from '../modules/bed-sessions/guest-session.service.js';
import { type PlatformContext } from '../modules/platform/platform-auth.service.js';

declare global {
  namespace Express {
    interface Request {
      staff?: StaffContext;
      user?: StaffContext['user'];
      tenant?: StaffContext['tenant'];
      permissions?: readonly string[];
      scopes?: StaffContext['scopes'];
      guest?: GuestContext;
      platform?: PlatformContext;
    }
  }
}

export {};
