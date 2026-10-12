import { render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { staffApi, type RequestQueue } from '../src/api';
import { type AdminContext } from '../src/features/workspace/AdminLayout';
import { OverviewPage } from '../src/features/workspace/OverviewPage';

function show(hospitalWide: string[], anywhere: string[] = hospitalWide) {
  const context: AdminContext = {
    token: 'token',
    me: {
      user: { id: 'user', email: 'user@example.test', displayName: 'Asha' },
      membershipId: 'manager',
      tenant: {
        hospitalId: 'hospital',
        code: 'TEST',
        name: 'Test Hospital',
        logoUrl: null,
        timezone: 'Asia/Kolkata',
      },
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

// The counts the server sends with a page of requests.
const queue = (counts: Partial<RequestQueue['counts']>): RequestQueue => ({
  serviceRequests: [],
  page: 1,
  pageSize: 1,
  total: counts.open ?? 0,
  counts: {
    open: 0,
    waiting: 0,
    overdue: 0,
    completed: 0,
    history: 0,
    completedToday: 0,
    ...counts,
  },
});

describe('Overview', () => {
  it('shows a floor manager their request counts and only the screens they can open', async () => {
    const requests = vi
      .spyOn(staffApi, 'requests')
      .mockResolvedValue(queue({ open: 1, waiting: 1 }));
    const list = vi.spyOn(staffApi, 'list').mockResolvedValue([]);
    show([], ['request.read', 'request.assign', 'staff.read']);

    const waiting = await screen.findByRole('link', { name: /Waiting for assignment/ });
    expect(waiting.textContent).toContain('1');
    expect(screen.getByRole('link', { name: /Requests/ })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Staff & coverage/ })).toBeNull();
    // Only the counts are needed, so only one small page is asked for.
    expect(requests).toHaveBeenCalledWith('token', { pageSize: 1 });
    // A floor-scoped staff.read does not load the hospital-wide staff list.
    expect(list).not.toHaveBeenCalled();
    expect(screen.queryByText(/Finish setting up/)).toBeNull();
  });

  it('guides an administrator through the remaining setup steps', async () => {
    vi.spyOn(staffApi, 'requests').mockResolvedValue(queue({}));
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
    const all = [
      'hospital.manage',
      'location.manage',
      'bed.read',
      'bedSession.manage',
      'qr.generate',
      'staff.read',
      'staff.manage',
      'service.read',
      'service.manage',
      'request.read',
      'request.assign',
    ];
    show(all);

    const checklist = await screen.findByRole('region', { name: /Finish setting up \(1 of 6/ });
    expect(checklist.textContent).toContain('Add your hospital logo');
    expect(checklist.textContent).toContain('Add floors, wards, and beds');
    expect(checklist.textContent).toContain('Turn on patient services');
    expect(screen.getByText('View all setup steps')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Occupied beds/ }).textContent).toContain('of 1');
  });

  it('does not suggest setup screens a limited manager cannot open', async () => {
    show(['hospital.manage']);
    const checklist = await screen.findByRole('region', { name: /Finish setting up/ });
    expect(checklist.textContent).toContain('Add your hospital logo');
    expect(checklist.textContent).not.toContain('Add staff to departments');
    expect(screen.getAllByRole('link', { name: 'Add your hospital logo' })).toHaveLength(2);
  });
});
