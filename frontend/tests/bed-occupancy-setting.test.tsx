import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode } from 'react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { credentials, staffApi, type Hospital, type Me } from '../src/api';
import { SettingsPage } from '../src/features/hospital/SettingsPage';
import { BedManagementPage } from '../src/features/locations/BedManagementPage';
import { BedsPage } from '../src/features/locations/BedsPage';
import { AdminLayout, type AdminContext } from '../src/features/workspace/AdminLayout';
import { OverviewPage } from '../src/features/workspace/OverviewPage';

const manager = ['hospital.manage', 'bed.read', 'bedSession.manage', 'qr.generate'];

function me(bedOccupancyEnabled: boolean, permissions = manager): Me {
  return {
    user: { id: 'user', email: 'manager@example.test', displayName: 'Meera' },
    membershipId: 'manager',
    tenant: {
      hospitalId: 'hospital',
      code: 'SUNRISE',
      name: 'Sunrise Hospital',
      logoUrl: null,
      timezone: 'Asia/Kolkata',
      bedOccupancyEnabled,
      patientRequestsPaused: false,
    },
    mustChangePassword: false,
    permissions,
    scopedPermissions: permissions,
  };
}

function show(page: ReactNode, profile: Me) {
  const context: AdminContext = {
    token: 'token',
    me: profile,
    can: (permission) => profile.permissions.includes(permission),
    canAnywhere: (permission) => profile.permissions.includes(permission),
    reportError: vi.fn(),
    reportSuccess: vi.fn(),
    refreshMe: vi.fn(),
  };
  render(
    <MemoryRouter>
      <Routes>
        <Route element={<Outlet context={context} />}>
          <Route path="/" element={page} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
  return context;
}

const hospital: Hospital = {
  id: 'hospital',
  name: 'Sunrise Hospital',
  code: 'SUNRISE',
  timezone: 'Asia/Kolkata',
  bedOccupancyEnabled: true,
  patientRequestsPaused: false,
  escalationsPaused: false,
  mutedNotificationTypes: [],
  patientLanguages: ['en', 'hi'],
  logoUrl: null,
  logoUpdatedAt: null,
};

describe('Choosing whether the hospital admits patients', () => {
  it('lets a hospital manager switch to QR codes only, after confirming', async () => {
    const user = userEvent.setup();
    vi.spyOn(staffApi, 'hospital')
      .mockResolvedValueOnce(hospital)
      .mockResolvedValue({ ...hospital, bedOccupancyEnabled: false });
    const set = vi.spyOn(staffApi, 'setBedOccupancy').mockResolvedValue({
      enabled: false,
      releasedBeds: 3,
      closedStays: 0,
      revokedGuestSessions: 0,
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true);
    const context = show(<SettingsPage />, me(true));

    const choices = await screen.findByRole('group', { name: 'How patients use the bedside QR' });
    const admissions = within(choices).getByRole('radio', { name: /Admit and discharge/ });
    const qrOnly = within(choices).getByRole('radio', { name: /QR codes only/ });
    expect((admissions as HTMLInputElement).checked).toBe(true);

    // Saying no changes nothing.
    await user.click(qrOnly);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(set).not.toHaveBeenCalled();
    expect((admissions as HTMLInputElement).checked).toBe(true);

    await user.click(qrOnly);
    expect(set).toHaveBeenCalledWith('token', false);
    await waitFor(() =>
      expect(context.reportSuccess).toHaveBeenCalledWith(
        'QR codes only. 3 beds no longer show as occupied; those patients stay connected.',
      ),
    );
    expect(context.refreshMe).toHaveBeenCalled();
    await waitFor(() => expect((qrOnly as HTMLInputElement).checked).toBe(true));
  });

  it('warns that turning admissions back on disconnects patients', async () => {
    const user = userEvent.setup();
    vi.spyOn(staffApi, 'hospital').mockResolvedValue({ ...hospital, bedOccupancyEnabled: false });
    const set = vi.spyOn(staffApi, 'setBedOccupancy').mockResolvedValue({
      enabled: true,
      releasedBeds: 0,
      closedStays: 2,
      revokedGuestSessions: 1,
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const context = show(<SettingsPage />, me(false));

    await user.click(await screen.findByRole('radio', { name: /Admit and discharge/ }));
    expect(confirm.mock.calls[0]?.[0]).toContain('disconnected until they are admitted');
    expect(set).toHaveBeenCalledWith('token', true);
    await waitFor(() =>
      expect(context.reportSuccess).toHaveBeenCalledWith(
        'Admissions are on. 1 patient connection ended; admit patients in Bed management so they can use their QR.',
      ),
    );
  });

  it('leaves Bed management out of the menu while the hospital uses QR codes only', async () => {
    credentials.setStaff('staff-token');
    vi.spyOn(staffApi, 'me').mockResolvedValue(me(false));
    render(
      <MemoryRouter initialEntries={['/admin/beds']}>
        <Routes>
          <Route path="/admin" element={<AdminLayout />}>
            <Route path="beds" element={<p>QR content</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('QR content')).toBeTruthy();
    const navigation = screen.getByRole('navigation', { name: 'Hospital administration' });
    expect(within(navigation).queryByRole('link', { name: 'Bed management' })).toBeNull();
    expect(within(navigation).getByRole('link', { name: 'QR codes' })).toBeTruthy();
    expect(within(navigation).getByRole('link', { name: 'Profile & logo' })).toBeTruthy();
    expect(within(navigation).getByRole('link', { name: 'Settings' })).toBeTruthy();
    const menuLinks = within(navigation).getAllByRole('link');
    expect(menuLinks.at(-1)?.textContent).toContain('Settings');
    expect(screen.getByRole('heading', { name: 'Administration' })).toBeTruthy();
  });

  it('explains on Bed management that it is turned off, without loading beds', () => {
    const list = vi.spyOn(staffApi, 'list').mockResolvedValue([]);
    show(<BedManagementPage />, me(false));
    expect(screen.getByRole('heading', { name: 'Bed management is turned off' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe(
      '/admin/settings',
    );
    expect(screen.getByRole('link', { name: 'Go to QR codes' }).getAttribute('href')).toBe(
      '/admin/beds',
    );
    expect(list).not.toHaveBeenCalled();
  });

  it('drops the admission step from the QR setup guide', async () => {
    vi.spyOn(staffApi, 'list').mockResolvedValue([]);
    show(<BedsPage />, me(false));
    const guide = await screen.findByRole('list', { name: 'Patient request setup' });
    expect(guide.textContent).not.toContain('Admit the patient');
    expect(guide.textContent).toContain('1Print the bedside QR');
    expect(screen.getByText(/a QR works as soon as it is on the bed/)).toBeTruthy();
  });

  it('shows beds with a working QR on the overview instead of occupied beds', async () => {
    const list = vi.spyOn(staffApi, 'list').mockImplementation((_token, kind) =>
      Promise.resolve(
        kind === 'beds'
          ? [
              { id: 'b1', active: true },
              { id: 'b2', active: true },
            ]
          : kind === 'qr-codes'
            ? [{ id: 'q1', bedId: 'b1', status: 'ACTIVE' }]
            : [],
      ),
    );
    show(<OverviewPage />, me(false, ['bed.read', 'qr.generate']));
    const tile = (await screen.findByText('Beds with a QR')).closest('a')!;
    expect(tile.textContent).toContain('1');
    expect(tile.textContent).toContain('of 2 active beds');
    expect(tile.getAttribute('href')).toBe('/admin/beds');
    expect(screen.queryByText('Occupied beds')).toBeNull();
    expect(list.mock.calls.map((call) => call[1])).not.toContain('bed-sessions');
  });
});
