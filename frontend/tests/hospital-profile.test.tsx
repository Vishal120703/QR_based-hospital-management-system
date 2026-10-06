import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { staffApi, type Hospital } from '../src/api';
import * as logoImage from '../src/logo-image';
import { type AdminContext } from '../src/pages/AdminLayout';
import { HospitalProfilePage } from '../src/pages/HospitalProfilePage';

const hospital: Hospital = {
  id: 'hospital',
  name: 'Sunrise Hospital',
  code: 'SUNRISE',
  timezone: 'Asia/Kolkata',
  logoUrl: null,
  logoUpdatedAt: null,
};

function show() {
  const refreshMe = vi.fn();
  const context: AdminContext = {
    token: 'token',
    me: {
      user: { id: 'user', email: 'admin@example.test', displayName: 'Admin' },
      membershipId: 'admin',
      tenant: { hospitalId: 'hospital', code: 'SUNRISE', name: 'Sunrise Hospital', logoUrl: null },
      permissions: ['hospital.manage'],
      scopedPermissions: ['hospital.manage'],
    },
    can: () => true,
    canAnywhere: () => true,
    reportError: vi.fn(),
    reportSuccess: vi.fn(),
    refreshMe,
  };
  render(
    <MemoryRouter>
      <Routes>
        <Route element={<Outlet context={context} />}>
          <Route path="/" element={<HospitalProfilePage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
  return context;
}

describe('Hospital profile', () => {
  it('previews a chosen logo, then uploads the resized PNG and refreshes the top bar', async () => {
    const user = userEvent.setup();
    vi.spyOn(staffApi, 'hospital')
      .mockResolvedValueOnce(hospital)
      .mockResolvedValue({ ...hospital, logoUrl: '/public/logos/new' });
    const png = new Blob(['png'], { type: 'image/png' });
    const prepare = vi
      .spyOn(logoImage, 'prepareLogo')
      .mockResolvedValue({ blob: png, width: 512, height: 128 });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const upload = vi.spyOn(staffApi, 'uploadLogo').mockResolvedValue({
      logoUrl: '/public/logos/new',
    });
    const context = show();

    expect(await screen.findByText('No logo yet')).toBeTruthy();
    const file = new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' });
    await user.upload(screen.getByLabelText('Upload logo'), file);
    expect(prepare).toHaveBeenCalledWith(file);
    expect(await screen.findByText(/512 × 128 px/)).toBeTruthy();
    expect(upload).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Save logo' }));
    expect(upload).toHaveBeenCalledWith('token', png);
    expect(context.refreshMe).toHaveBeenCalled();
    expect(context.reportSuccess).toHaveBeenCalledWith('Logo saved.');
    expect(await screen.findByRole('img', { name: 'Sunrise Hospital logo' })).toHaveProperty(
      'src',
      expect.stringContaining('/api/public/logos/new'),
    );
  });

  it('removes the logo after confirmation', async () => {
    const user = userEvent.setup();
    vi.spyOn(staffApi, 'hospital')
      .mockResolvedValueOnce({ ...hospital, logoUrl: '/public/logos/old' })
      .mockResolvedValue(hospital);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const remove = vi.spyOn(staffApi, 'removeLogo').mockResolvedValue(null);
    show();
    await user.click(await screen.findByRole('button', { name: 'Remove logo' }));
    expect(remove).toHaveBeenCalledWith('token');
    expect(await screen.findByText('No logo yet')).toBeTruthy();
  });
});
