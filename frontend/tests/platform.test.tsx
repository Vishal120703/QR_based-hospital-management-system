import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { credentials, platformApi, type PlatformHospital } from '../src/api';
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
  activeBeds: 40,
  activeStaff: 12,
  openRequests: 3,
};

function showHospitals() {
  const context: PlatformContext = {
    token: 'platform-token',
    user: { id: 'u', email: 'ops@example.test', displayName: 'Ops' },
    reportError: vi.fn(),
    reportSuccess: vi.fn(),
  };
  render(
    <MemoryRouter>
      <Routes>
        <Route element={<Outlet context={context} />}>
          <Route path="/" element={<PlatformHospitalsPage />} />
          <Route path="/platform/hospitals/:id" element={<p>Hospital detail</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
  return context;
}

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

  it('lists client hospitals with their status and size', async () => {
    vi.spyOn(platformApi, 'hospitals').mockResolvedValue([
      sunrise,
      { ...sunrise, id: 'h2', name: 'Lakeside Clinic', code: 'LAKE', status: 'SUSPENDED' },
    ]);
    showHospitals();
    const row = await screen.findByRole('link', { name: /Sunrise Hospital/ });
    expect(row.textContent).toContain('40 beds · 12 staff · 3 open requests');
    expect(screen.getByRole('link', { name: /Lakeside Clinic/ }).textContent).toContain(
      'suspended',
    );
  });

  it('onboards a hospital with its first manager and opens it', async () => {
    const user = userEvent.setup();
    vi.spyOn(platformApi, 'hospitals').mockResolvedValue([]);
    const create = vi.spyOn(platformApi, 'createHospital').mockResolvedValue(sunrise);
    const context = showHospitals();
    await user.click(await screen.findByRole('button', { name: 'Add hospital' }));
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
      }),
    );
    expect(await screen.findByText('Hospital detail')).toBeTruthy();
    expect(context.reportSuccess).toHaveBeenCalled();
  });
});
