import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, credentials, staffApi, type Me } from '../src/api';
import { AdminIndex, AdminLayout, type AdminContext } from '../src/pages/AdminLayout';
import { ServicesPage } from '../src/pages/ServicesPage';
import { StaffPage } from '../src/pages/StaffPage';

const me: Me = {
  user: { id: 'user', email: 'admin@example.test', displayName: 'Test Admin' },
  membershipId: 'membership',
  tenant: { hospitalId: 'hospital', code: 'TEST', name: 'Test Hospital' },
  permissions: ['service.read'],
};

function renderShell(path = '/admin') {
  credentials.setStaff('staff-token');
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<AdminIndex />} />
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
    me: { ...me, permissions },
    can: (permission) => permissions.includes(permission),
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
  it('chooses an accessible landing page and hides inaccessible links', async () => {
    vi.spyOn(staffApi, 'me').mockResolvedValue(me);
    renderShell();
    expect(await screen.findByText('Catalog content')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Beds & QR' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Service catalog' })).toBeTruthy();
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
    expect(await screen.findByText('Catalog content')).toBeTruthy();
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
