import { type StaffContext } from '../modules/auth/auth.service.js';

declare global {
  namespace Express {
    interface Request {
      staff?: StaffContext;
      user?: StaffContext['user'];
      tenant?: StaffContext['tenant'];
      permissions?: readonly string[];
      scopes?: StaffContext['scopes'];
    }
  }
}

export {};
