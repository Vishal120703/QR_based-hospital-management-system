import { render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { credentials, platformApi, type PlatformClient, type PlatformHospital } from '../src/api';
import { PlatformClientPage } from '../src/pages/platform/PlatformClientPage';
import { PlatformClientsPage } from '../src/pages/platform/PlatformClientsPage';
import { PlatformHospitalsPage } from '../src/pages/platform/PlatformHospitalsPage';
import { PlatformLayout, type PlatformContext } from '../src/pages/platform/PlatformLayout';

const sunrise: PlatformHospital = {
  id: 'h1',
  name: 'Sunrise Hospital',
  code: 'SUNRISE',
  timezone: 'Asia/Kolkata',
  status: 'ACTIVE',
  createdAt: '2026-10-06T08:00:00Z',
  logoUrl: null,
  client: { id: 'c1', name: 'Sunrise Health Group', code: 'SUNRISE-GROUP', status: 'ACTIVE' },
  activeBeds: 40,
  activeStaff: 12,
  openRequests: 3,
};

const group: PlatformClient = {
  ...sunrise.client,
  contactName: 'Asha Rao',
  contactEmail: 'accounts@sunrise.example',
  contactPhone: null,
  createdAt: '2026-10-01T08:00:00Z',
  hospitalCount: 2,
  activeBeds: 55,
  activeStaff: 20,
  openRequests: 4,
};

function show(page: ReactNode, path = '/') {
  const context: PlatformContext = {
    token: 'platform-token',
    user: { id: 'u', email: 'ops@example.test', displayName: 'Ops' },
    reportError: vi.fn(),
    reportSuccess: vi.fn(),
  };
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<Outlet context={context} />}>
          <Route path="/" element={page} />
          <Route path="/platform/clients/:id" element={page} />
          <Route path="/platform/hospitals/:id" element={<p>Hospital detail</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
  return context;
}
const showHospitals = () => show(<PlatformHospitalsPage />);

describe('Platform administration', () => {
  it('sends someone without a platform session to the platform sign-in page', async () => {
    credentials.setPlatform(null);
    render(
      <MemoryRouter initialEntries={['/platform']}>
        <Routes>
          <Route path="/platform" element={<PlatformLayout />}>
            <Route index element={<p>Hospitals</p>} />
          </Route>
          <Route path="/platform/login" element={<p>Platform sign in</p>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Platform sign in')).toBeTruthy();
  });

  it('lists hospitals with their client, status, and size', async () => {
    vi.spyOn(platformApi, 'clients').mockResolvedValue([group]);
    vi.spyOn(platformApi, 'hospitals').mockResolvedValue([
      sunrise,
      { ...sunrise, id: 'h2', name: 'Lakeside Clinic', code: 'LAKE', status: 'SUSPENDED' },
      {
        ...sunrise,
        id: 'h3',
        name: 'Hill View Hospital',
        code: 'HILL',
        client: { id: 'c2', name: 'Hill Group', code: 'HILL', status: 'SUSPENDED' },
      },
    ]);
    showHospitals();
    const row = await screen.findByRole('link', { name: /Sunrise Hospital/ });
    expect(row.textContent).toContain('client Sunrise Health Group');
    expect(row.textContent).toContain('40 beds · 12 staff · 3 open requests');
    expect(screen.getByRole('link', { name: /Lakeside Clinic/ }).textContent).toContain(
      'suspended',
    );
    expect(screen.getByRole('link', { name: /Hill View Hospital/ }).textContent).toContain(
      'client suspended',
    );
  });

  it('lists clients with how many hospitals each has', async () => {
    vi.spyOn(platformApi, 'clients').mockResolvedValue([
      group,
      {
        ...group,
        id: 'c2',
        name: 'Hill Group',
        code: 'HILL',
        status: 'SUSPENDED',
        hospitalCount: 1,
      },
    ]);
    show(<PlatformClientsPage />);
    const row = await screen.findByRole('link', { name: /Sunrise Health Group/ });
    expect(row.textContent).toContain('2 hospitals · 55 beds · 20 staff');
    expect(row.textContent).toContain('Asha Rao');
    expect(screen.getByRole('link', { name: /Hill Group/ }).textContent).toContain('suspended');
  });

  it('adds a hospital as another branch of an existing client', async () => {
    const user = userEvent.setup();
    vi.spyOn(platformApi, 'clients').mockResolvedValue([group]);
    vi.spyOn(platformApi, 'hospitals').mockResolvedValue([sunrise]);
    const create = vi.spyOn(platformApi, 'createHospital').mockResolvedValue(sunrise);
    showHospitals();
    await user.click(await screen.findByRole('button', { name: 'Add hospital' }));
    await user.click(screen.getByRole('radio', { name: /An existing client/ }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Existing client' }), 'c1');
    await user.type(screen.getByRole('textbox', { name: 'Hospital name' }), 'Sunrise Whitefield');
    await user.clear(screen.getByRole('textbox', { name: /Hospital code/ }));
    await user.type(screen.getByRole('textbox', { name: /Hospital code/ }), 'SUN-WF');
    await user.type(screen.getByRole('textbox', { name: 'Full name' }), 'Kiran Rao');
    await user.type(screen.getByRole('textbox', { name: 'Email' }), 'kiran@sunrise.example');
    await user.click(screen.getByRole('button', { name: 'Generate' }));
    await user.click(screen.getByRole('button', { name: 'Create hospital' }));
    expect(create).toHaveBeenCalledWith(
      'platform-token',
      expect.objectContaining({ name: 'Sunrise Whitefield', code: 'SUN-WF', clientId: 'c1' }),
    );
    expect(create.mock.calls[0]?.[1]).not.toHaveProperty('client');
  });

  it('suspends a client and all its hospitals after confirmation', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(platformApi, 'client').mockResolvedValue({
      ...group,
      hospitals: [sunrise, { ...sunrise, id: 'h2', name: 'Sunrise Whitefield', code: 'SUN-WF' }],
    });
    const update = vi
      .spyOn(platformApi, 'updateClient')
      .mockResolvedValue({ ...group, status: 'SUSPENDED', hospitals: [sunrise] });
    show(<PlatformClientPage />, '/platform/clients/c1');
    expect(await screen.findByRole('link', { name: /Sunrise Whitefield/ })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Suspend client' }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('All 2 hospitals close'));
    expect(update).toHaveBeenCalledWith('platform-token', 'c1', { status: 'SUSPENDED' });
    expect(await screen.findByRole('button', { name: 'Reactivate client' })).toBeTruthy();
  });

  it('onboards a new client with its first hospital and manager', async () => {
    const user = userEvent.setup();
    vi.spyOn(platformApi, 'clients').mockResolvedValue([]);
    vi.spyOn(platformApi, 'hospitals').mockResolvedValue([]);
    const create = vi.spyOn(platformApi, 'createHospital').mockResolvedValue(sunrise);
    const context = showHospitals();
    await user.click(await screen.findByRole('button', { name: 'Add hospital' }));
    await user.type(screen.getByRole('textbox', { name: 'Client name' }), 'Sunrise Health Group');
    expect(screen.getByRole('textbox', { name: /Client code/ })).toHaveProperty('value', 'SUNRISE');
    await user.type(
      screen.getByRole('textbox', { name: 'Hospital name' }),
      'Sunrise Multispeciality Hospital',
    );
    expect(screen.getByRole('textbox', { name: /Hospital code/ })).toHaveProperty(
      'value',
      'SUNRISE',
    );
    await user.type(screen.getByRole('textbox', { name: 'Full name' }), 'Asha Rao');
    await user.type(screen.getByRole('textbox', { name: 'Email' }), 'asha@sunrise.example');
    await user.click(screen.getByRole('button', { name: 'Generate' }));
    await user.click(screen.getByRole('button', { name: 'Create hospital' }));
    expect(create).toHaveBeenCalledWith(
      'platform-token',
      expect.objectContaining({
        name: 'Sunrise Multispeciality Hospital',
        code: 'SUNRISE',
        timezone: 'Asia/Kolkata',
        managerName: 'Asha Rao',
        managerEmail: 'asha@sunrise.example',
        managerPassword: expect.stringMatching(/^.{16}$/) as unknown,
        client: { name: 'Sunrise Health Group', code: 'SUNRISE' },
      }),
    );
    expect(await screen.findByText('Hospital detail')).toBeTruthy();
    expect(context.reportSuccess).toHaveBeenCalled();
  });
});
