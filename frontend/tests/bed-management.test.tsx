import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode } from 'react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import {
  staffApi,
  type Bed,
  type BedSession,
  type RequestQueue,
  type StaffRequest,
} from '../src/api';
import { bedState } from '../src/features/locations/bed-places';
import {
  BedManagementPage,
  occupancy,
  stayLength,
} from '../src/features/locations/BedManagementPage';
import { type AdminContext } from '../src/features/workspace/AdminLayout';

const hour = 3_600_000;
const bed = (id: string, status: Bed['status'], extra: Partial<Bed> = {}): Bed => ({
  id,
  wardId: 'ward-a',
  roomId: null,
  code: id.toUpperCase(),
  displayName: `Bed ${id.toUpperCase()}`,
  bedType: 'STANDARD',
  status,
  active: true,
  ...extra,
});
const beds = [
  bed('a1', 'OCCUPIED'),
  bed('a2', 'OCCUPIED'),
  bed('a3', 'AVAILABLE'),
  bed('a4', 'MAINTENANCE'),
  bed('b1', 'AVAILABLE', { wardId: 'ward-b' }),
  bed('b2', 'INACTIVE', { wardId: 'ward-b', active: false }),
];
// a1 has been in for 8 days (a long stay); a2's stay is not in the first
// page of stays, so discharging it looks the stay up by bed.
const sessions: BedSession[] = [
  {
    id: 'stay-a1',
    bedId: 'a1',
    status: 'ACTIVE',
    startedAt: new Date(Date.now() - 8 * 24 * hour - 2 * hour).toISOString(),
    endedAt: null,
  },
];
const request = (id: string, bedId: string, overdue: boolean): StaffRequest => ({
  id,
  publicId: `CR-${id}`,
  bedId,
  bed: { code: bedId, displayName: bedId },
  departmentId: 'pantry',
  serviceName: 'Drinking Water',
  priority: 'NORMAL',
  status: 'SUBMITTED',
  assigneeId: null,
  assigneeName: null,
  submittedAt: new Date(Date.now() - hour).toISOString(),
  acceptDueAt: new Date(Date.now() + (overdue ? -1 : 1) * hour).toISOString(),
  completeDueAt: new Date(Date.now() + 2 * hour).toISOString(),
  completedAt: null,
  isEscalated: false,
  escalationLevel: 0,
  version: 1,
});

function mockApi() {
  vi.spyOn(staffApi, 'list').mockImplementation((_token, kind, query = '') => {
    const lists: Record<string, unknown[]> = {
      beds,
      floors: [
        {
          id: 'floor-1',
          code: 'F1',
          name: 'First Floor',
          active: true,
          buildingId: null,
          level: 1,
        },
      ],
      wards: [
        {
          id: 'ward-a',
          code: 'GA',
          name: 'General Ward A',
          active: true,
          floorId: 'floor-1',
          unitType: 'GENERAL',
        },
        {
          id: 'ward-b',
          code: 'GB',
          name: 'General Ward B',
          active: true,
          floorId: 'floor-1',
          unitType: 'GENERAL',
        },
      ],
      rooms: [],
      buildings: [],
      'bed-sessions': query.includes('bedId=a2')
        ? [
            {
              id: 'stay-a2',
              bedId: 'a2',
              status: 'ACTIVE',
              startedAt: new Date().toISOString(),
              endedAt: null,
            },
          ]
        : sessions,
    };
    return Promise.resolve(lists[kind] ?? []);
  });
  const queue: RequestQueue = {
    serviceRequests: [request('r1', 'a1', true), request('r2', 'a1', false)],
    page: 1,
    pageSize: 100,
    total: 2,
    counts: { open: 2, waiting: 2, overdue: 1, completed: 0, history: 0, completedToday: 0 },
  };
  vi.spyOn(staffApi, 'requests').mockResolvedValue(queue);
  // No ConfirmProvider in these tests: the browser's confirm answers yes.
  vi.spyOn(window, 'confirm').mockReturnValue(true);
}

function show(
  hospitalWide: string[],
  anywhere: string[] = hospitalWide,
  page: ReactNode = <BedManagementPage />,
) {
  const context: AdminContext = {
    token: 'token',
    me: {
      user: { id: 'u', email: 'm@example.test', displayName: 'Manager' },
      membershipId: 'manager',
      tenant: {
        hospitalId: 'h',
        code: 'TEST',
        name: 'Test Hospital',
        logoUrl: null,
        timezone: 'Asia/Kolkata',
        bedOccupancyEnabled: true,
      },
      mustChangePassword: false,
      permissions: hospitalWide,
      scopedPermissions: anywhere,
    },
    can: (permission) => hospitalWide.includes(permission),
    canAnywhere: (permission) => anywhere.includes(permission),
    reportError: vi.fn(),
    reportSuccess: vi.fn(),
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

const manager = ['bed.read', 'bed.manage', 'bedSession.manage', 'location.read', 'request.read'];

describe('Bed management', () => {
  it('counts beds by state and shows occupancy of the beds that can take patients', async () => {
    mockApi();
    show(manager);
    // 2 occupied of 4 usable (2 available); maintenance and out of service do not count.
    await screen.findByRole('listitem', { name: 'Bed A1' });
    const occupancyTile = screen
      .getAllByText('Occupancy')
      .find((element) => element.closest('.bed-stats'))!
      .closest('.stat')!;
    expect(occupancyTile.textContent).toContain('50%');
    expect(occupancyTile.textContent).toContain('2 of 4 usable beds');
    const tile = (label: string) =>
      screen
        .getAllByText(label)
        .find((element) => element.closest('.bed-stats'))!
        .closest('.stat')!;
    expect(tile('Occupied').textContent).toContain('2');
    expect(tile('Available').textContent).toContain('2');
    expect(tile('Under maintenance').textContent).toContain('1');
    expect(tile('Out of service').textContent).toContain('1');

    const byArea = screen.getByRole('region', { name: 'Occupancy by floor and ward' });
    const wardA = within(byArea).getByText('General Ward A').closest('tr')!;
    expect(wardA.textContent).toContain('67%');
  });

  it('shows how long each patient has stayed and their open requests', async () => {
    mockApi();
    show(manager);
    const a1 = await screen.findByRole('listitem', { name: 'Bed A1' });
    expect(a1.textContent).toContain('Admitted 8 d 2 h ago');
    expect(a1.textContent).toContain('Long stay');
    expect(a1.textContent).toContain('2 open requests');
    expect(a1.textContent).toContain('1 overdue');
    expect(within(a1).getByRole('link', { name: '2 open requests' }).getAttribute('href')).toBe(
      '/admin/requests',
    );
  });

  it('filters by state, long stays, and search', async () => {
    const user = userEvent.setup();
    mockApi();
    show(manager);
    await screen.findByRole('listitem', { name: 'Bed A1' });
    const chips = screen.getByRole('group', { name: 'Show' });
    await user.click(within(chips).getByRole('button', { name: /^Occupied/ }));
    expect(screen.getAllByRole('listitem').map((item) => item.getAttribute('aria-label'))).toEqual([
      'Bed A1',
      'Bed A2',
    ]);
    await user.click(within(chips).getByRole('button', { name: /^Long stays/ }));
    expect(screen.getAllByRole('listitem').map((item) => item.getAttribute('aria-label'))).toEqual([
      'Bed A1',
    ]);
    await user.click(within(chips).getByRole('button', { name: /^All beds/ }));
    await user.type(screen.getByRole('searchbox'), 'b1');
    expect(screen.getAllByRole('listitem').map((item) => item.getAttribute('aria-label'))).toEqual([
      'Bed B1',
    ]);
  });

  it('admits, discharges, and takes beds out of use for maintenance', async () => {
    const user = userEvent.setup();
    mockApi();
    const start = vi.spyOn(staffApi, 'startSession').mockResolvedValue({} as never);
    const close = vi.spyOn(staffApi, 'closeSession').mockResolvedValue({} as never);
    const update = vi.spyOn(staffApi, 'updateLocation').mockResolvedValue({});
    const context = show(manager);

    const a3 = await screen.findByRole('listitem', { name: 'Bed A3' });
    await user.click(within(a3).getByRole('button', { name: 'Admit' }));
    expect(start).toHaveBeenCalledWith('token', 'a3');
    await waitFor(() =>
      expect(context.reportSuccess).toHaveBeenCalledWith('Patient admitted to Bed A3.'),
    );

    await user.click(
      within(screen.getByRole('listitem', { name: 'Bed A1' })).getByRole('button', {
        name: 'Discharge',
      }),
    );
    expect(close).toHaveBeenCalledWith('token', 'stay-a1');
    // a2's stay was not in the loaded list: it is looked up by bed.
    await user.click(
      within(screen.getByRole('listitem', { name: 'Bed A2' })).getByRole('button', {
        name: 'Discharge',
      }),
    );
    await waitFor(() => expect(close).toHaveBeenCalledWith('token', 'stay-a2'));

    await user.click(
      within(screen.getByRole('listitem', { name: 'Bed B1' })).getByRole('button', {
        name: 'Maintenance',
      }),
    );
    expect(update).toHaveBeenCalledWith('token', 'beds', 'b1', { status: 'MAINTENANCE' });
    await user.click(
      within(screen.getByRole('listitem', { name: 'Bed A4' })).getByRole('button', {
        name: 'Back in service',
      }),
    );
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith('token', 'beds', 'a4', { status: 'AVAILABLE' }),
    );
    // Out-of-service beds are changed in Location setup, not here.
    expect(
      within(screen.getByRole('listitem', { name: 'Bed B2' })).queryAllByRole('button'),
    ).toEqual([]);
  });

  it('offers only the actions each person may take', async () => {
    mockApi();
    // A floor manager: admits and discharges in their area, no maintenance.
    show(['bed.read'], ['bed.read', 'bedSession.manage', 'location.read']);
    const a3 = await screen.findByRole('listitem', { name: 'Bed A3' });
    expect(within(a3).getByRole('button', { name: 'Admit' })).toBeTruthy();
    expect(within(a3).queryByRole('button', { name: 'Maintenance' })).toBeNull();
    // Without request access, no request counts are loaded.
    expect(staffApi.requests).not.toHaveBeenCalled();
  });

  it('shows nothing to change for someone who may only look', async () => {
    mockApi();
    show(['bed.read'], ['bed.read', 'location.read']);
    await screen.findByRole('listitem', { name: 'Bed A3' });
    expect(screen.queryByRole('button', { name: 'Admit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Discharge' })).toBeNull();
  });
});

describe('Bed management helpers', () => {
  it('says how long a stay has lasted', () => {
    expect(stayLength(45 * 60_000)).toBe('45 min');
    expect(stayLength(6 * hour + 20 * 60_000)).toBe('6 h 20 min');
    expect(stayLength(3 * 24 * hour + 4 * hour)).toBe('3 d 4 h');
    expect(stayLength(2 * 24 * hour)).toBe('2 d');
    expect(stayLength(-5)).toBe('0 min');
  });

  it('works out each bed’s state and the occupancy share', () => {
    expect(bedState({ status: 'AVAILABLE', active: false })).toBe('OUT_OF_SERVICE');
    expect(bedState({ status: 'INACTIVE', active: true })).toBe('OUT_OF_SERVICE');
    expect(bedState({ status: 'OCCUPIED', active: true })).toBe('OCCUPIED');
    expect(
      occupancy([{ state: 'OCCUPIED' }, { state: 'AVAILABLE' }, { state: 'MAINTENANCE' }]),
    ).toEqual({
      occupied: 1,
      usable: 2,
      percent: 50,
    });
    expect(occupancy([{ state: 'MAINTENANCE' }])).toEqual({
      occupied: 0,
      usable: 0,
      percent: null,
    });
  });
});
