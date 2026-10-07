import express, { Router } from 'express';
import { requirePermission } from '../../middleware/staff-auth.js';
import { type HospitalController } from './hospital.controller.js';
import { maxLogoBytes } from './logo.js';

// Mounted under /admin: the signed-in staff member's own hospital.
export function createHospitalRoutes(controller: HospitalController): Router {
  const router = Router();
  const canManage = requirePermission('hospital.manage');
  router.get('/hospital', requirePermission('hospital.read'), controller.get);
  router.patch('/hospital', canManage, controller.update);
  router.put(
    '/hospital/logo',
    canManage,
    express.raw({ type: () => true, limit: maxLogoBytes }),
    controller.setLogo,
  );
  router.delete('/hospital/logo', canManage, controller.removeLogo);
  return router;
}

// Mounted under /public, before any router that requires a guest session.
export function createPublicLogoRoutes(controller: HospitalController): Router {
  const router = Router();
  router.get('/logos/:publicId', controller.publicLogo);
  return router;
}
