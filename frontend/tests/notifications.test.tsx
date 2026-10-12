import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, notificationApi, type StaffNotification } from '../src/api';
import { NotificationBell } from '../src/features/notifications/NotificationBell';

const transport = vi.hoisted(() => ({
  listeners: new Map<string, () => void>(),
  disconnect: vi.fn(),
  off: vi.fn(),
}));
vi.mock('socket.io-client', () => ({
  io: () => ({
    on: (event: string, callback: () => void) => transport.listeners.set(event, callback),
    off: transport.off,
    disconnect: transport.disconnect,
  }),
}));
const item = (id: string, extra: Partial<StaffNotification> = {}): StaffNotification => ({
  id,
  type: 'SUBMITTED',
  priority: 'NORMAL',
  title: 'New request needs assignment',
  message: 'New work is waiting in your authorized request queue.',
  createdAt: '2026-10-12T09:00:00Z',
  readAt: null,
  requestId: id,
  ...extra,
});
const page = (items: StaffNotification[], nextCursor: string | null = null) => ({
  items,
  nextCursor,
  unreadCount: items.filter((value) => !value.readAt).length,
});
beforeEach(() => {
  transport.listeners.clear();
  transport.disconnect.mockClear();
  transport.off.mockClear();
});
function show(onUnauthorized = vi.fn()) {
  return render(
    <MemoryRouter>
      <NotificationBell token="token" timezone="Asia/Kolkata" onUnauthorized={onUnauthorized} />
    </MemoryRouter>,
  );
}

describe('Staff notification inbox', () => {
  it('shows the server unread count, empty state, and a keyboard-openable inbox', async () => {
    vi.spyOn(notificationApi, 'list').mockResolvedValue(page([]));
    show();
    const user = userEvent.setup();
    const bell = await screen.findByRole('button', { name: 'Notifications, 0 unread' });
    bell.focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByText('No notifications yet.')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
    await user.keyboard('{Escape}');
  });
  it('marks a notification read using the server count, not an optimistic decrement', async () => {
    const notice = item('a');
    const list = vi.spyOn(notificationApi, 'list').mockResolvedValue(page([notice]));
    vi.spyOn(notificationApi, 'read').mockImplementation(() => {
      list.mockResolvedValue({
        ...page([{ ...notice, readAt: '2026-10-12T10:00:00Z' }]),
        unreadCount: 4,
      });
      return Promise.resolve({ unreadCount: 4 });
    });
    show();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }));
    await user.click(await screen.findByRole('button', { name: 'Mark as read' }));
    expect(await screen.findByRole('button', { name: 'Notifications, 4 unread' })).toBeTruthy();
    expect(screen.getByText('Read')).toBeTruthy();
  });
  it('loads older pages without duplicate rows', async () => {
    vi.spyOn(notificationApi, 'list').mockImplementation((_token, before) =>
      Promise.resolve(
        before
          ? page([item('a'), item('b', { title: 'Request assigned to you' })])
          : page([item('a')], 'a'),
      ),
    );
    show();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }));
    await user.click(await screen.findByRole('button', { name: 'Load older notifications' }));
    expect(await screen.findByText('Request assigned to you')).toBeTruthy();
    expect(screen.getAllByText('New request needs assignment')).toHaveLength(1);
  });
  it('keeps the exhausted older-page cursor when a realtime refresh arrives', async () => {
    vi.spyOn(notificationApi, 'list').mockImplementation((_token, before) =>
      Promise.resolve(
        before ? page([item('b', { title: 'Older assignment' })]) : page([item('a')], 'a'),
      ),
    );
    show();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }));
    await user.click(await screen.findByRole('button', { name: 'Load older notifications' }));
    await screen.findByText('Older assignment');
    expect(screen.queryByRole('button', { name: 'Load older notifications' })).toBeNull();
    act(() => transport.listeners.get('notification.created')?.());
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Load older notifications' })).toBeNull(),
    );
    // Flush the refresh before asserting, rather than checking only the pre-refresh screen.
    await act(() => Promise.resolve());
    expect(screen.queryByRole('button', { name: 'Load older notifications' })).toBeNull();
  });
  it('refreshes on socket events and reconnection without duplicating notifications', async () => {
    const load = vi.spyOn(notificationApi, 'list').mockResolvedValue(page([item('a')]));
    show();
    await screen.findByRole('button', { name: 'Notifications, 1 unread' });
    load.mockResolvedValue(
      page([item('b', { title: 'Request assigned to you', type: 'ASSIGNED' }), item('a')]),
    );
    act(() => {
      transport.listeners.get('notification.created')?.();
    });
    await screen.findByRole('button', { name: 'Notifications, 2 unread' });
    expect(screen.getByRole('status').textContent).toContain('Request assigned to you');
    act(() => {
      transport.listeners.get('notification.created')?.();
      transport.listeners.get('connect')?.();
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'View' }));
    expect(
      await screen.findByText(
        'Live updates connected. Reading a notification does not accept a request.',
      ),
    ).toBeTruthy();
    expect(screen.getAllByText('Request assigned to you')).toHaveLength(1);
  });
  it('shows failures and retries, and reports expired sessions', async () => {
    const load = vi
      .spyOn(notificationApi, 'list')
      .mockRejectedValue(new Error('Temporarily unavailable'));
    const expired = vi.fn();
    show(expired);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(await screen.findByText('Temporarily unavailable')).toBeTruthy();
    load.mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'Session ended'));
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(expired).toHaveBeenCalled());
  });
  it('offers request links only when the server says they are authorized', async () => {
    vi.spyOn(notificationApi, 'list').mockResolvedValue(
      page([item('a'), item('b', { requestId: null, title: 'Request cancelled' })]),
    );
    show();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Notifications, 2 unread' }));
    expect(screen.getAllByRole('link', { name: 'Open request' })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Open request' }).getAttribute('href')).toBe(
      '/admin/requests?request=a',
    );
    expect(screen.getByText('Request no longer available in your area.')).toBeTruthy();
  });
  it('removes socket listeners and disconnects when leaving the staff interface', async () => {
    vi.spyOn(notificationApi, 'list').mockResolvedValue(page([]));
    const view = show();
    await screen.findByRole('button', { name: 'Notifications, 0 unread' });
    view.unmount();
    expect(transport.disconnect).toHaveBeenCalledTimes(1);
    expect(transport.off).toHaveBeenCalledTimes(4);
  });
});
