import { Router } from 'express';
import { type NotificationController } from './notification.controller.js';

// Already staff-authenticated by the /admin router. No hospital-wide grant is
// needed to use one's own inbox; every query is bound to tenant + membership.
export function createNotificationRoutes(controller: NotificationController) {
  const router = Router();
  router.get('/notifications', controller.list);
  router.get('/notifications/unread-count', controller.count);
  router.post('/notifications/:id/read', controller.read);
  return router;
}
