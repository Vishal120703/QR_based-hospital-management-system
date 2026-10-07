import { Router } from 'express';
import { rateLimit, type RateLimitOptions } from '../../middleware/rate-limit.js';
import { requirePermission, requireScopedPermission } from '../../middleware/staff-auth.js';
import { type QrController } from './qr.controller.js';

// Mounted under /admin. Issuing labels needs hospital management plus the
// specific QR permission.
export function createQrAdminRoutes(controller: QrController): Router {
  const router = Router();
  const canManage = requirePermission('hospital.manage');
  router.get('/qr-codes', requireScopedPermission('bed.read'), controller.list);
  router.post(
    '/qr-codes/batch',
    canManage,
    requirePermission('qr.generate'),
    controller.generateBatch,
  );
  router.post('/beds/:id/qr', canManage, requirePermission('qr.generate'), controller.generate);
  router.post('/beds/:id/qr/rotate', canManage, requirePermission('qr.rotate'), controller.rotate);
  router.post('/beds/:id/qr/revoke', canManage, requirePermission('qr.revoke'), controller.revoke);
  return router;
}

// Mounted under /public: a scan exchanges the QR token for a guest session.
export function createQrPublicRoutes(controller: QrController, limit: RateLimitOptions): Router {
  const router = Router();
  router.post('/qr/resolve', rateLimit(limit), controller.resolve);
  return router;
}
