import { call } from './client';

export interface StaffNotification {
  id: string;
  type: string;
  priority: string;
  title: string;
  message: string;
  createdAt: string;
  readAt: string | null;
  requestId: string | null;
  requestReference?: string | null;
}
export interface NotificationPage {
  items: StaffNotification[];
  nextCursor: string | null;
  unreadCount: number;
}
export const notificationApi = {
  list: (token: string, before?: string) =>
    call<NotificationPage>(
      'GET',
      `/admin/notifications?limit=20${before ? `&before=${encodeURIComponent(before)}` : ''}`,
      token,
    ),
  read: (token: string, id: string) =>
    call<{ unreadCount: number }>(
      'POST',
      `/admin/notifications/${encodeURIComponent(id)}/read`,
      token,
      {},
    ),
};
