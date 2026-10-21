import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import {
  credentials,
  staffApi,
  type Bed,
  type Department,
  type EligibleStaff,
  type Floor,
  type Me,
  type StaffMember,
  type Ward,
} from '../src/api';
import { EligibilityPage } from '../src/features/people/EligibilityPage';
import { StaffPage } from '../src/features/people/StaffPage';
import { AdminLayout } from '../src/features/workspace/AdminLayout';

const me: Me = {
  user: { id: 'admin-user', email: 'admin@example.test', displayName: 'Test Admin' },
  membershipId: 'admin-membership',
  tenant: {
    hospitalId: 'hospital',
    code: 'TEST',
    name: 'Test Hospital',
    logoUrl: null,
    timezone: 'Asia/Kolkata',
    bedOccupancyEnabled: true,
  },
  mustChangePassword: false,
  permissions: [],
  scopedPermissions: [],
};

const floors: Floor[] = [
  { id: 'first', code: 'F1', name: 'First Floor', buildingId: null, level: 1, active: true },
  { id: 'ground', code: 'G', name: 'Ground Floor', buildingId: null, level: 0, active: true },
];
const wards: Ward[] = [
  {
    id: 'ward-a',
    code: 'GW-A',
    name: 'General Ward A',
    floorId: 'first',
    unitType: 'GENERAL',
    active: true,
  },
  {
    id: 'er',
    code: 'ER',
    name: 'Emergency',
    floorId: 'ground',
    unitType: 'EMERGENCY',
    active: true,
  },
];
const bed = (id: string, displayName: string, wardId: string, active = true): Bed => ({
  id,
  wardId,
  roomId: null,
  code: id.toUpperCase(),
  displayName,
  bedType: 'STANDARD',
  status: 'AVAILABLE',
  active,
});
const beds = [
  bed('a10', 'Bed A 10', 'ward-a'),
  bed('a1', 'Bed A 01', 'ward-a'),
  bed('a2', 'Bed A 02', 'ward-a'),
  bed('er1', 'ER Bed 1', 'er', false),
];
const departments: Department[] = [
  { id: 'nursing', code: 'NURSING', name: 'Nursing', active: true },
  { id: 'billing', code: 'BILLING', name: 'Billing', active: true },
  { id: 'laundry', code: 'LAUNDRY', name: 'Laundry', active: false },
];
const person = (
  id: string,
  displayName: string,
  changes: Partial<StaffMember> = {},
): StaffMember => ({
  id,
  email: `${id}@example.test`,
  displayName,
  status: 'ACTIVE',
  dutyStatus: 'ON_DUTY',
  dutyChangedAt: null,
  departmentIds: ['nursing'],
  coverage: [],
  roleIds: [],
  ...changes,
});
const staff = [
  person('asha', 'Asha Kumar', {
    coverage: [{ id: 'c1', scopeType: 'FLOOR', floorId: 'first', wardId: null }],
  }),
  person('ravi', 'Ravi Singh', {
    dutyStatus: 'OFF_DUTY',
    coverage: [{ id: 'c2', scopeType: 'WARD', floorId: null, wardId: 'ward-a' }],
  }),
  person('deepa', 'Deepa Thomas', {
    coverage: [{ id: 'c3', scopeType: 'FLOOR', floorId: 'ground', wardId: null }],
  }),
  person('karan', 'Karan Malhotra', {
    status: 'SUSPENDED',
    dutyStatus: 'OFF_DUTY',
    coverage: [{ id: 'c4', scopeType: 'HOSPITAL', floorId: null, wardId: null }],
  }),
  person('mohan', 'Mohan Das', {
    departmentIds: ['housekeeping'],
    coverage: [{ id: 'c5', scopeType: 'HOSPITAL', floorId: null, wardId: null }],
  }),
];
const asha: EligibleStaff = {
  membershipId: 'asha',
  displayName: 'Asha Kumar',
  dutyChangedAt: null,
};
const ravi: EligibleStaff = {
  membershipId: 'ravi',
  displayName: 'Ravi Singh',
  dutyChangedAt: null,
};

function renderAdmin(page: ReactNode, entry: string, path: string, permissions: string[]) {
  credentials.setStaff('staff-token');
  vi.spyOn(staffApi, 'me').mockResolvedValue({
    ...me,
    permissions,
    scopedPermissions: permissions,
  });
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/admin" element={<AdminLayout />}>
          <Route path={path} element={page} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

function mockLists() {
  const records: Record<string, unknown[]> = { beds, wards, floors, departments, staff };
  return vi
    .spyOn(staffApi, 'list')
    .mockImplementation(
      <T,>(_token: string, kind: Parameters<typeof staffApi.list>[1]): Promise<T[]> =>
        Promise.resolve((records[kind] ?? []) as T[]),
    );
}

const managerPermissions = ['staff.read', 'bed.read', 'location.read', 'staff.manage'];
const readOnlyPermissions = ['staff.read', 'bed.read', 'location.read'];

async function openPage(permissions = managerPermissions) {
  mockLists();
  renderAdmin(<EligibilityPage />, '/admin/eligibility', 'eligibility', permissions);
  return {
    bed: await screen.findByRole<HTMLSelectElement>('combobox', { name: 'Bed' }),
    department: screen.getByRole<HTMLSelectElement>('combobox', { name: 'Department' }),
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error('Deferred promise is not initialized.');
  };
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe('Who can respond?', () => {
  it('shows the four rules and groups beds by floor and ward in a natural order', async () => {
    const { bed: bedField } = await openPage();

    expect(screen.getByRole('heading', { name: 'Staff can respond when all four are true' }));
    for (const rule of ['Account active', 'On duty', 'In the department', 'Covers the bed']) {
      expect(screen.getByText(rule)).toBeTruthy();
    }
    const groups = [...bedField.querySelectorAll('optgroup')];
    expect(groups.map((group) => group.label)).toEqual([
      'Ground Floor · Emergency',
      'First Floor · General Ward A',
    ]);
    expect([...groups[0]!.querySelectorAll('option')].map((option) => option.text)).toEqual([
      'ER Bed 1 (out of service)',
    ]);
    expect([...groups[1]!.querySelectorAll('option')].map((option) => option.text)).toEqual([
      'Bed A 01',
      'Bed A 02',
      'Bed A 10',
    ]);
    expect(screen.getByRole('option', { name: 'Laundry (turned off)' })).toBeTruthy();
    expect(screen.getByText('Choose a bed and a department. The answer appears right away.'));
  });

  it('checks as soon as both are chosen and explains everyone else in the department', async () => {
    const user = userEvent.setup();
    const eligible = vi.spyOn(staffApi, 'eligible').mockResolvedValue([asha]);
    const { bed: bedField, department } = await openPage();

    await user.selectOptions(bedField, 'a1');
    expect(screen.getByText('Now choose a department to see who can respond.')).toBeTruthy();
    expect(eligible).not.toHaveBeenCalled();
    await user.selectOptions(department, 'nursing');

    const summary = await screen.findByRole('status');
    expect(summary.textContent).toContain('1 person can respond');
    expect(summary.textContent).toContain(
      'to Nursing requests at Bed A 01 (General Ward A, First Floor).',
    );
    expect(eligible).toHaveBeenCalledTimes(1);
    expect(eligible).toHaveBeenCalledWith('staff-token', 'a1', 'nursing');

    const can = screen.getByRole('list', { name: 'Can respond' });
    expect(within(can).getByText('Asha Kumar')).toBeTruthy();
    expect(within(can).getByText('On duty · Covers First Floor')).toBeTruthy();

    const cannot = screen.getByRole('list', { name: 'Can’t respond right now' });
    const rows = within(cannot).getAllByRole('listitem');
    // Closest to available first; people outside Nursing are not listed.
    expect(rows.map((row) => within(row).getByRole('strong').textContent)).toEqual([
      'Deepa Thomas',
      'Ravi Singh',
      'Karan Malhotra',
    ]);
    expect(within(rows[0]!).getByText('Doesn’t cover General Ward A (First Floor)')).toBeTruthy();
    expect(within(rows[1]!).getByText('Off duty')).toBeTruthy();
    expect(within(rows[2]!).getByText('Account suspended')).toBeTruthy();
    expect(within(rows[2]!).getByText('Off duty')).toBeTruthy();
    expect(screen.queryByText('Mohan Das')).toBeNull();

    // Only someone whose single problem is being off duty can be fixed here.
    expect(screen.getByRole('button', { name: 'Put Ravi Singh on duty' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Put Karan Malhotra on duty' })).toBeNull();
    expect(
      screen.getByRole('link', { name: 'Open Deepa Thomas in Staff' }).getAttribute('href'),
    ).toBe('/admin/staff?search=Deepa%20Thomas');
  });

  it('puts someone on duty and checks again', async () => {
    const user = userEvent.setup();
    const eligible = vi
      .spyOn(staffApi, 'eligible')
      .mockResolvedValueOnce([asha])
      .mockResolvedValueOnce([asha, ravi]);
    const setDuty = vi
      .spyOn(staffApi, 'setDuty')
      .mockResolvedValue({ staff: { ...staff[1]!, dutyStatus: 'ON_DUTY' } });
    const { bed: bedField, department } = await openPage();
    await user.selectOptions(bedField, 'a1');
    await user.selectOptions(department, 'nursing');

    await user.click(await screen.findByRole('button', { name: 'Put Ravi Singh on duty' }));

    expect(setDuty).toHaveBeenCalledWith('staff-token', 'ravi', 'ON_DUTY');
    // The confirmation is a status message too, so find the answer by its text.
    expect(await screen.findByText('2 people can respond')).toBeTruthy();
    expect(eligible).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Ravi Singh is now on duty.')).toBeTruthy();
    const can = screen.getByRole('list', { name: 'Can respond' });
    expect(within(can).getByText('Ravi Singh')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Put Ravi Singh on duty' })).toBeNull();
  });

  it('ignores an older answer that arrives after the choice changed', async () => {
    const user = userEvent.setup();
    const first = deferred<EligibleStaff[]>();
    const second = deferred<EligibleStaff[]>();
    const eligible = vi
      .spyOn(staffApi, 'eligible')
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { bed: bedField, department } = await openPage();

    await user.selectOptions(bedField, 'a1');
    await user.selectOptions(department, 'nursing');
    expect(screen.getByText('Checking who can respond…')).toBeTruthy();
    await user.selectOptions(bedField, 'a2');
    expect(eligible).toHaveBeenNthCalledWith(1, 'staff-token', 'a1', 'nursing');
    expect(eligible).toHaveBeenNthCalledWith(2, 'staff-token', 'a2', 'nursing');

    await act(async () => {
      second.resolve([ravi]);
      await second.promise;
    });
    await act(async () => {
      first.resolve([asha]);
      await first.promise;
    });

    const summary = await screen.findByRole('status');
    expect(summary.textContent).toContain('Bed A 02');
    const can = screen.getByRole('list', { name: 'Can respond' });
    expect(within(can).getByText('Ravi Singh')).toBeTruthy();
    expect(within(can).queryByText('Asha Kumar')).toBeNull();
  });

  it('explains an empty or turned-off department and nobody available', async () => {
    const user = userEvent.setup();
    vi.spyOn(staffApi, 'eligible').mockResolvedValue([]);
    const { bed: bedField, department } = await openPage(readOnlyPermissions);
    await user.selectOptions(bedField, 'a1');

    await user.selectOptions(department, 'billing');
    expect((await screen.findByRole('status')).textContent).toContain('Nobody is in Billing yet');
    expect(screen.queryByText(/Only people in Billing are listed/)).toBeNull();

    await user.selectOptions(department, 'laundry');
    expect((await screen.findByRole('status')).textContent).toContain(
      'Nobody: Laundry is turned off',
    );

    await user.selectOptions(department, 'nursing');
    expect((await screen.findByRole('status')).textContent).toContain(
      'Nobody can respond right now',
    );
    expect(screen.getByRole('list', { name: 'Can’t respond right now' })).toBeTruthy();
    // Without staff.manage the page only links to the Staff screen.
    expect(screen.queryByRole('button', { name: /on duty/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'Open Ravi Singh in Staff' })).toBeTruthy();
  });
});

describe('Staff page search link', () => {
  it('opens with the search from the link filled in', async () => {
    mockLists();
    renderAdmin(<StaffPage />, '/admin/staff?search=Deepa%20Thomas', 'staff', [
      'staff.read',
      'staff.manage',
    ]);

    const search = await screen.findByRole<HTMLInputElement>('searchbox', {
      name: 'Find a staff member',
    });
    expect(search.value).toBe('Deepa Thomas');
    expect(screen.getByRole('row', { name: /Deepa Thomas/ })).toBeTruthy();
    expect(screen.queryByRole('row', { name: /Asha Kumar/ })).toBeNull();
  });
});
