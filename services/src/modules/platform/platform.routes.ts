import express, { Router } from 'express';
import { requirePlatformAuth } from '../../middleware/platform-auth.js';
import { rateLimit, type RateLimitOptions } from '../../middleware/rate-limit.js';
import { maxLogoBytes } from '../hospitals/index.js';
import { type PlatformAuthController, type PlatformController } from './platform.controller.js';
import { type PlatformAuthService } from './platform-auth.service.js';

// Mounted at the application root. Platform (super admin) tokens are required
// only under /auth/platform (except login) and /platform; staff and patient
// routes never accept them.
export function createPlatformRoutes(
  authController: PlatformAuthController,
  controller: PlatformController,
  auth: PlatformAuthService,
  loginLimit: RateLimitOptions,
): Router {
  const signedIn = requirePlatformAuth(auth);

  const session = Router();
  session.post('/login', rateLimit(loginLimit), authController.login);
  session.get('/me', signedIn, authController.me);
  session.post('/logout', signedIn, authController.logout);

  const operator = Router();
  operator.use(signedIn);
  operator.get('/clients', controller.listClients);
  operator.get('/clients/:id', controller.getClient);
  operator.patch('/clients/:id', controller.updateClient);
  operator.get('/hospitals', controller.listHospitals);
  operator.post('/hospitals', controller.createHospital);
  operator.get('/hospitals/:id', controller.getHospital);
  operator.patch('/hospitals/:id', controller.updateHospital);
  operator.put(
    '/hospitals/:id/logo',
    express.raw({ type: () => true, limit: maxLogoBytes }),
    controller.setLogo,
  );
  operator.delete('/hospitals/:id/logo', controller.removeLogo);
  operator.post('/hospitals/:id/managers', controller.addManager);

  const router = Router();
  router.use('/auth/platform', session);
  router.use('/platform', operator);
  return router;
}
