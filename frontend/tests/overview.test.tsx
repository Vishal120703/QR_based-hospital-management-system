import { render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { staffApi, type StaffRequest } from '../src/api';
import { type AdminContext } from '../src/pages/AdminLayout';
import { OverviewPage } from '../src/pages/OverviewPage';

const submitted: StaffRequest = {
  id: 'request-1',
  publicId: 'CR-1234567890ABCDEF',
  bedId: 'bed-1',
  bed: { code: 'BED-01', displayName: 'Bed 01' },
  departmentId: 'department-1',
  serviceName: 'Drinking Water',
  priority: 'NORMAL',
  status: 'SUBMITTED',
  assigneeId: null,
  assigneeName: null,
  submittedAt: new Date().toISOString(),
  acceptDueAt: new Date(Date.now() + 5 * 60_000).toISOString(),
  completeDueAt: new Date(Date.now() + 30 * 60_000).toISOString(),
  completedAt: null,
  version: 1,
};

function show(hospitalWide: string[], anywhere: string[] = hospitalWide) {
  const context: AdminContext = {
    token: 'token',
    me: {
      user: { id: 'user', email: 'user@example.test', displayName: 'Asha' },
      membershipId: 'manager',
      tenant: { hospitalId: 'hospital', code: 'TEST', name: 'Test Hospital' },
      permissions: hospitalWide,
      scopedPermissions: anywhere,
    },
    can: (permission) => hospitalWide.includes(permission),
    canAnywhere: (permission) => anywhere.includes(permission),
    reportError: vi.fn(),
    reportSuccess: vi.fn(),
  };
  return render(
    <MemoryRouter>
      <Routes>
        <Route element={<Outlet context={context} />}>
          <Route path="/" element={<OverviewPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('Overview', () => {
  it('shows a floor manager their request counts and only the screens they can open', async () => {
    vi.spyOn(staffApi, 'requests').mockResolvedValue([submitted]);
    const list = vi.spyOn(staffApi, 'list').mockResolvedValue([]);
    show([], ['request.read', 'request.assign', 'staff.read']);

    const waiting = await screen.findByRole('link', { name: /Waiting for assignment/ });
    expect(waiting.textContent).toContain('1');
    expect(screen.getByRole('link', { name: /Requests/ })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Staff & coverage/ })).toBeNull();
    // A floor-scoped staff.read does not load the hospital-wide staff list.
    expect(list).not.toHaveBeenCalled();
    expect(screen.queryByText(/Finish setting up/)).toBeNull();
  });

  it('guides an administrator through the remaining setup steps', async () => {
    vi.spyOn(staffApi, 'requests').mockResolvedValue([]);
    vi.spyOn(staffApi, 'list').mockImplementation((_token, kind) =>
      Promise.resolve(
        kind === 'beds'
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
    const all = ['hospital.manage', 'bed.read', 'staff.read', 'service.read', 'request.read'];
    show(all);

    const checklist = await screen.findByRole('region', { name: /Finish setting up \(1 of 5/ });
    expect(checklist.textContent).toContain('Add floors, wards, and beds');
    expect(checklist.textContent).toContain('Turn on patient services');
    expect(screen.getByRole('link', { name: /Occupied beds/ }).textContent).toContain('of 1');
  });
});
