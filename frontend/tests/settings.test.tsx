import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode } from 'react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  credentials,
  guestApi,
  staffApi,
  type GuestLocation,
  type Hospital,
  type Me,
} from '../src/api';
import { SettingsPage } from '../src/features/hospital/SettingsPage';
import { PatientPage } from '../src/features/patient/PatientPage';
import { AdminLayout, type AdminContext } from '../src/features/workspace/AdminLayout';

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

function me(permissions: string[], patientRequestsPaused = false): Me {
  return {
    user: { id: 'user', email: 'manager@example.test', displayName: 'Meera' },
    membershipId: 'manager',
    tenant: {
      hospitalId: 'hospital',
      code: 'SUNRISE',
      name: 'Sunrise Hospital',
      logoUrl: null,
      timezone: 'Asia/Kolkata',
      bedOccupancyEnabled: true,
      patientRequestsPaused,
    },
    mustChangePassword: false,
    permissions,
    scopedPermissions: permissions,
  };
}

function show(page: ReactNode) {
  const profile = me(['hospital.manage', 'hospital.read']);
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

describe('Hospital settings page', () => {
  it('pauses patient requests only after the manager confirms', async () => {
    const user = userEvent.setup();
    vi.spyOn(staffApi, 'hospital')
      .mockResolvedValueOnce(hospital)
      .mockResolvedValue({ ...hospital, patientRequestsPaused: true });
    const update = vi
      .spyOn(staffApi, 'updateSettings')
      .mockResolvedValue({ ...hospital, patientRequestsPaused: true });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true);
    const context = show(<SettingsPage />);

    const requests = await screen.findByRole('group', {
      name: 'Whether patients can send new requests',
    });
    const pause = within(requests).getByRole('radio', { name: /Pause new requests/ });
    await user.click(pause);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();

    await user.click(pause);
    expect(update).toHaveBeenCalledWith('token', { patientRequestsPaused: true });
    await waitFor(() =>
      expect(context.reportSuccess).toHaveBeenCalledWith(
        'New patient requests are paused. Patients are asked to tell a member of staff.',
      ),
    );
    // The top bar and the staff warning follow the new setting.
    expect(context.refreshMe).toHaveBeenCalled();
    await waitFor(() => expect((pause as HTMLInputElement).checked).toBe(true));
  });

  it('saves which staff notifications are on, and can undo unsaved ticks', async () => {
    const user = userEvent.setup();
    vi.spyOn(staffApi, 'hospital').mockResolvedValue(hospital);
    const update = vi.spyOn(staffApi, 'updateSettings').mockResolvedValue(hospital);
    show(<SettingsPage />);

    const kinds = await screen.findByRole('group', { name: 'Notifications staff receive' });
    const save = screen.getByRole('button', { name: 'Save notifications' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    await user.click(within(kinds).getByRole('checkbox', { name: /Request cancelled/ }));
    await user.click(screen.getByRole('button', { name: 'Undo changes' }));
    expect(
      within(kinds).getByRole<HTMLInputElement>('checkbox', { name: /Request cancelled/ }).checked,
    ).toBe(true);

    await user.click(within(kinds).getByRole('checkbox', { name: /Request cancelled/ }));
    await user.click(within(kinds).getByRole('checkbox', { name: /Request ready to close/ }));
    await user.click(screen.getByRole('button', { name: 'Save notifications' }));
    expect(update).toHaveBeenCalledWith('token', {
      mutedNotificationTypes: ['COMPLETED', 'CANCELLED'],
    });
  });

  it('turns Hindi off for the patient page, while English stays', async () => {
    const user = userEvent.setup();
    vi.spyOn(staffApi, 'hospital').mockResolvedValue(hospital);
    const update = vi
      .spyOn(staffApi, 'updateSettings')
      .mockResolvedValue({ ...hospital, patientLanguages: ['en'] });
    show(<SettingsPage />);
    const languages = await screen.findByRole('group', { name: 'Languages on the patient page' });
    expect(
      within(languages).getByRole<HTMLInputElement>('checkbox', { name: 'English' }).disabled,
    ).toBe(true);
    await user.click(within(languages).getByRole('checkbox', { name: /Hindi/ }));
    expect(update).toHaveBeenCalledWith('token', { patientLanguages: ['en'] });
  });

  it('warns staff who handle requests while patient requests are paused', async () => {
    credentials.setStaff('staff-token');
    vi.spyOn(staffApi, 'me').mockResolvedValue(me(['request.read', 'hospital.manage'], true));
    render(
      <MemoryRouter initialEntries={['/admin/screen']}>
        <Routes>
          <Route path="/admin" element={<AdminLayout />}>
            <Route path="screen" element={<p>Screen content</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Screen content')).toBeTruthy();
    expect(screen.getByText('Patient requests are paused.')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Turn them back on in Settings' }).getAttribute('href'),
    ).toBe('/admin/settings');
  });
});

const location: GuestLocation = {
  hospitalName: 'Test Hospital',
  hospitalLogoUrl: null,
  requestsPaused: false,
  languages: ['en', 'hi'],
  bed: { code: '101', displayName: 'Bed 101' },
  room: null,
  ward: 'General',
  floor: 'First floor',
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
};

function showPatient(place: GuestLocation) {
  credentials.setGuest('guest-token');
  vi.spyOn(guestApi, 'session').mockResolvedValue({ location: place });
  vi.spyOn(guestApi, 'services').mockResolvedValue([
    {
      id: 'category',
      name: 'Room support',
      description: null,
      emergencyNotice: false,
      services: [{ id: 'water', name: 'Drinking water', description: null }],
    },
  ]);
  vi.spyOn(guestApi, 'requests').mockResolvedValue([]);
  render(
    <MemoryRouter>
      <PatientPage />
    </MemoryRouter>,
  );
}

describe('Patient page settings', () => {
  it('says requests are paused and offers no request button', async () => {
    showPatient({ ...location, requestsPaused: true });
    expect(
      await screen.findByRole('heading', { name: 'New requests are paused right now.' }),
    ).toBeTruthy();
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Request Drinking water' }).disabled,
    ).toBe(true);
  });

  it('shows only English when the hospital turned Hindi off', async () => {
    sessionStorage.setItem('careqr.patientLanguage', 'hi');
    showPatient({ ...location, languages: ['en'] });
    expect(await screen.findByRole('heading', { name: 'Bed 101' })).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
    // The patient chose Hindi earlier; the page is in English now.
    expect(screen.getByRole('button', { name: 'Request Drinking water' })).toBeTruthy();
  });

  it('explains when requests were paused after the page opened', async () => {
    const user = userEvent.setup();
    showPatient(location);
    vi.spyOn(guestApi, 'submitRequest').mockRejectedValue(
      new ApiError(409, 'PATIENT_REQUESTS_PAUSED', 'New requests are paused.'),
    );
    await user.click(await screen.findByRole('button', { name: 'Request Drinking water' }));
    expect(
      await screen.findByText(/New requests are paused right now\. Please tell a member of staff/),
    ).toBeTruthy();
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Request Drinking water' }).disabled,
    ).toBe(true);
  });
});
