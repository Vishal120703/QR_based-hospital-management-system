import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { credentials, staffApi, type Me, type RequestAlert, type RequestAlerts } from '../src/api';
import { AlertSettings } from '../src/features/requests/AlertSettings';
import { AdminLayout } from '../src/features/workspace/AdminLayout';
import { describeAlert, unseenAlerts } from '../src/lib/request-alerts';

const me: Me = {
  user: { id: 'user', email: 'ravi@example.test', displayName: 'Ravi' },
  membershipId: 'ravi',
  tenant: {
    hospitalId: 'hospital',
    code: 'TEST',
    name: 'Test Hospital',
    logoUrl: null,
    timezone: 'Asia/Kolkata',
    bedOccupancyEnabled: true,
    patientRequestsPaused: false,
  },
  mustChangePassword: false,
  permissions: [],
  scopedPermissions: ['request.read', 'request.assign'],
};

const alert = (key: string, extra: Partial<RequestAlert> = {}): RequestAlert => ({
  key,
  kind: 'new',
  requestId: key,
  publicId: `CR-${key}`,
  serviceName: 'Drinking Water',
  bed: 'Bed 01',
  at: '2026-10-12T08:00:00Z',
  deadline: null,
  level: null,
  ...extra,
});
const answer = (alerts: RequestAlert[], waiting = alerts.length): RequestAlerts => ({
  counts: { waiting, overdue: 0, escalated: 0 },
  alerts,
});

// A browser that allows desktop notifications, recording what was shown.
function allowNotifications() {
  const shown: string[] = [];
  class FakeNotification {
    public static permission: NotificationPermission = 'granted';
    public static requestPermission = vi.fn(() => Promise.resolve('granted' as const));
    public constructor(_title: string, options: { body: string }) {
      shown.push(options.body);
    }
  }
  vi.stubGlobal('Notification', FakeNotification);
  return { shown, Notification: FakeNotification };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('Request alerts', () => {
  it('describes each kind of alert and finds the ones not seen yet', () => {
    expect(describeAlert(alert('a'))).toBe('New request: Drinking Water · Bed 01');
    expect(describeAlert(alert('b', { kind: 'overdue', deadline: 'complete' }))).toBe(
      'Overdue (not completed): Drinking Water · Bed 01',
    );
    expect(describeAlert(alert('c', { kind: 'escalated', level: 2 }))).toBe(
      'Escalated (level 2): Drinking Water · Bed 01',
    );
    expect(unseenAlerts([alert('a'), alert('b')], new Set(['a'])).map((item) => item.key)).toEqual([
      'b',
    ]);
  });

  it('stays quiet for work already waiting at sign-in, then alerts once per new request', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { shown } = allowNotifications();
    credentials.setStaff('staff-token');
    vi.spyOn(staffApi, 'me').mockResolvedValue(me);
    const feed = vi
      .spyOn(staffApi, 'requestAlerts')
      .mockResolvedValueOnce(answer([alert('a')]))
      .mockResolvedValueOnce(answer([alert('b'), alert('a')]))
      .mockResolvedValue(answer([alert('b'), alert('a')]));
    render(
      <MemoryRouter initialEntries={['/admin/requests']}>
        <Routes>
          <Route path="/admin" element={<AdminLayout />}>
            <Route path="requests" element={<p>Requests content</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByLabelText('1 need attention')).toBeTruthy();
    expect(shown).toEqual([]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(await screen.findByLabelText('2 need attention')).toBeTruthy();
    expect(shown).toEqual(['Work needs your attention. Open your authorized request queue.']);
    expect(screen.getByText('New request: Drinking Water · Bed 01').getAttribute('aria-live')).toBe(
      'polite',
    );

    // The same alerts again: nothing more.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(feed).toHaveBeenCalledTimes(3);
    expect(shown).toHaveLength(1);
  });

  it('asks for desktop alerts only when the button is pressed, and remembers the sound choice', async () => {
    const user = userEvent.setup();
    const { Notification } = allowNotifications();
    Notification.permission = 'default';
    render(<AlertSettings />);
    expect(Notification.requestPermission).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Turn on desktop alerts' }));
    expect(Notification.requestPermission).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Desktop alerts on')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Sound on' }));
    expect(screen.getByRole('button', { name: 'Sound off' })).toBeTruthy();
    expect(localStorage.getItem('careqr.alertSound')).toBe('off');
  });
});
