import { type Request, type Response } from 'express';
import { getStaffContext } from '../../middleware/staff-auth.js';
import { type NotificationService } from './notification.service.js';
import { notificationId, notificationQuery, noInput } from './notification.schemas.js';

export class NotificationController {
  public constructor(private readonly service: NotificationService) {}
  public list = async (req: Request, res: Response) => {
    res.json(await this.service.list(getStaffContext(req), notificationQuery.parse(req.query)));
  };
  public count = async (req: Request, res: Response) => {
    noInput.parse(req.query);
    res.json({ unreadCount: await this.service.unreadCount(getStaffContext(req)) });
  };
  public read = async (req: Request, res: Response) => {
    noInput.parse(req.body ?? {});
    res.json(await this.service.read(getStaffContext(req), notificationId.parse(req.params).id));
  };
}
