import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, credentials, staffApi, type Me } from '../src/api';
import { AdminIndex, AdminLayout, type AdminContext } from '../src/pages/AdminLayout';
import { BedsPage } from '../src/pages/BedsPage';
import { ServicesPage } from '../src/pages/ServicesPage';
import { StaffPage } from '../src/pages/StaffPage';

const me: Me = {
  user: { id: 'user', email: 'admin@example.test', displayName: 'Test Admin' },
  membershipId: 'membership',
  tenant: { hospitalId: 'hospital', code: 'TEST', name: 'Test Hospital' },
  permissions: ['service.read'],
  scopedPermissions: ['service.read'],
};

function renderShell(path = '/admin') {
  credentials.setStaff('staff-token');
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<AdminIndex />} />
          <Route path="overview" element={<p>Overview content</p>} />
          <Route path="services" element={<p>Catalog content</p>} />
          <Route path="beds" element={<p>Bed content</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

function renderPage(page: React.ReactNode, permissions: string[]) {
  const context: AdminContext = {
    token: 'test-token',
    me: { ...me, permissions, scopedPermissions: permissions },
    can: (permission) => permissions.includes(permission),
    canAnywhere: (permission) => permissions.includes(permission),
    reportError: vi.fn(),
    reportSuccess: vi.fn(),
  };
  return render(
    <MemoryRouter>
      <Routes>
        <Route element={<Outlet context={context} />}>
          <Route path="/" element={page} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('Permission-aware workspace', () => {
  it('explains the staff-to-patient QR request setup on the beds screen', async () => {
    vi.spyOn(staffApi, 'list').mockResolvedValue([]);
    renderPage(<BedsPage />, ['bed.read', 'hospital.manage']);

    const guide = await screen.findByRole('list', { name: 'Patient request setup' });
    expect(guide.textContent).toContain('Start a bed session');
    expect(guide.textContent).toContain('Print the bedside QR');
    expect(guide.textContent).toContain('Replace QR');
    expect(guide.textContent).toContain('Patient sends a request');
  });

  it('keeps QR issuance and printing off the ordinary staff screen', async () => {
    vi.spyOn(staffApi, 'list').mockImplementation((_token, resource) =>
      Promise.resolve(
        resource === 'beds'
          ? [
              {
                id: 'bed-1',
                wardId: 'ward-1',
                roomId: null,
                code: 'BED-1',
                displayName: 'Bed 1',
                status: 'AVAILABLE',
                active: true,
              },
            ]
          : [],
      ),
    );
    renderPage(<BedsPage />, ['bed.read', 'qr.generate']);
    expect(await screen.findByText('Bed 1')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Generate QR' })).toBeNull();
    expect(screen.queryByRole('list', { name: 'Patient request setup' })).toBeNull();
  });

  it('generates printable QR labels for every unissued bed in the chosen ward', async () => {
    const user = userEvent.setup();
    vi.spyOn(staffApi, 'list').mockImplementation((_token, resource) =>
      Promise.resolve(
        resource === 'beds'
          ? [
              {
                id: 'bed-1',
                wardId: 'ward-1',
                roomId: null,
                code: '01',
                displayName: 'Bed 01',
                status: 'AVAILABLE',
                active: true,
              },
              {
                id: 'bed-2',
                wardId: 'ward-1',
                roomId: null,
                code: '02',
                displayName: 'Bed 02',
                status: 'AVAILABLE',
                active: true,
              },
            ]
          : resource === 'wards'
            ? [{ id: 'ward-1', floorId: 'floor-1', code: 'W1', name: 'Ward 1', active: true }]
            : resource === 'floors'
              ? [{ id: 'floor-1', buildingId: null, code: 'F1', name: 'Floor 1', active: true }]
              : [],
      ),
    );
    const batch = vi.spyOn(staffApi, 'generateWardQrs').mockResolvedValue({
      issues: [
        {
          qrCode: { id: 'qr-1', bedId: 'bed-1', status: 'ACTIVE', version: 1, issuedAt: '' },
          token: 'secret-1',
          url: 'https://example.test/q/secret-1',
          bedName: 'Bed 01',
          location: 'Floor 1 · Ward 1',
        },
        {
          qrCode: { id: 'qr-2', bedId: 'bed-2', status: 'ACTIVE', version: 1, issuedAt: '' },
          token: 'secret-2',
          url: 'https://example.test/q/secret-2',
          bedName: 'Bed 02',
          location: 'Floor 1 · Ward 1',
        },
      ],
      totalBeds: 2,
      skippedActive: 0,
      skippedInactive: 0,
    });
    renderPage(<BedsPage />, ['bed.read', 'location.read', 'hospital.manage', 'qr.generate']);
    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Floor for QR codes' }),
      'floor-1',
    );
    await user.selectOptions(screen.getByRole('combobox', { name: 'Ward for QR codes' }), 'ward-1');
    await user.click(screen.getByRole('button', { name: 'Generate 2 QR codes' }));
    expect(batch).toHaveBeenCalledWith('test-token', 'floor-1', 'ward-1');
    expect(await screen.findByRole('dialog', { name: 'Print 2 bedside QR codes' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Print' })).toBeTruthy();
  });

  it('opens the overview first and hides inaccessible links', async () => {
    vi.spyOn(staffApi, 'me').mockResolvedValue(me);
    renderShell();
    expect(await screen.findByText('Overview content')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Overview' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Beds & QR' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Service catalog' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Response targets (SLA)' })).toBeNull();
  });

  it('guards direct links to screens outside the user permissions', async () => {
    vi.spyOn(staffApi, 'me').mockResolvedValue(me);
    renderShell('/admin/beds');
    expect(await screen.findByRole('heading', { name: 'Access restricted' })).toBeTruthy();
    expect(screen.queryByText('Bed content')).toBeNull();
  });

  it('can retry session validation after a network error', async () => {
    const user = userEvent.setup();
    const load = vi
      .spyOn(staffApi, 'me')
      .mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'Network unavailable'))
      .mockResolvedValue(me);
    renderShell();
    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Overview content')).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('does not request protected department data for a service-read-only user', async () => {
    const list = vi.spyOn(staffApi, 'list').mockResolvedValue([]);
    renderPage(<ServicesPage />, ['service.read']);
    expect(await screen.findByRole('heading', { name: 'Service catalog' })).toBeTruthy();
    expect(list.mock.calls.map((call) => call[1])).not.toContain('departments');
  });

  it('does not request locations or roles for a staff-read-only user', async () => {
    const list = vi.spyOn(staffApi, 'list').mockResolvedValue([]);
    renderPage(<StaffPage />, ['staff.read']);
    expect(await screen.findByRole('heading', { name: 'Staff' })).toBeTruthy();
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(list.mock.calls.map((call) => call[1])).toEqual(['staff', 'departments']);
  });

  it('does not offer role assignment without role.manage', async () => {
    vi.spyOn(staffApi, 'list').mockResolvedValue([]);
    renderPage(<StaffPage />, ['staff.read', 'staff.manage', 'role.read']);
    await screen.findByRole('heading', { name: 'Staff' });
    expect(screen.queryByLabelText('Role (optional)')).toBeNull();
    expect(screen.getByText(/Role assignment needs role management access/)).toBeTruthy();
  });
});
