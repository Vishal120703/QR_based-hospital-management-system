import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  credentials,
  staffApi,
  type EligibleStaff,
  type Me,
  type SlaPolicy,
  type StaffMember,
} from '../src/api';
import { AdminLayout } from '../src/pages/AdminLayout';
import { EligibilityPage } from '../src/pages/EligibilityPage';
import { SlaPage } from '../src/pages/SlaPage';
import { StaffPage } from '../src/pages/StaffPage';

const me: Me = {
  user: { id: 'admin-user', email: 'admin@example.test', displayName: 'Test Admin' },
  membershipId: 'admin-membership',
  tenant: { hospitalId: 'hospital', code: 'TEST', name: 'Test Hospital' },
  permissions: [],
  scopedPermissions: [],
};

const policy: SlaPolicy = {
  id: 'sla-standard',
  name: 'Standard',
  currentVersion: 1,
  acceptMinutes: 5,
  completeMinutes: 30,
  versions: [
    {
      id: 'sla-version-1',
      version: 1,
      acceptMinutes: 5,
      completeMinutes: 30,
      createdAt: '2026-10-05T08:00:00Z',
    },
  ],
};

function renderAdmin(page: ReactNode, path: string, permissions: string[]) {
  credentials.setStaff('staff-token');
  vi.spyOn(staffApi, 'me').mockResolvedValue({
    ...me,
    permissions,
    scopedPermissions: permissions,
  });
  return render(
    <MemoryRouter initialEntries={[`/admin/${path}`]}>
      <Routes>
        <Route path="/admin" element={<AdminLayout />}>
          <Route path={path} element={page} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

function mockLists(records: Record<string, unknown[]>) {
  return vi
    .spyOn(staffApi, 'list')
    .mockImplementation(
      <T,>(_token: string, kind: Parameters<typeof staffApi.list>[1]): Promise<T[]> =>
        Promise.resolve((records[kind] ?? []) as T[]),
    );
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

describe('SLA editing interactions', () => {
  it('rejects fractional minutes instead of silently rounding the saved timing', async () => {
    const user = userEvent.setup();
    mockLists({ 'sla-policies': [policy] });
    const update = vi.spyOn(staffApi, 'updateSlaPolicy');
    renderAdmin(<SlaPage />, 'sla', ['service.read', 'sla.manage']);

    const accept = await screen.findByRole<HTMLInputElement>('spinbutton', {
      name: 'Standard accept minutes',
    });
    await user.clear(accept);
    await user.type(accept, '1.5');
    await user.click(screen.getByRole('button', { name: 'Save as v2' }));

    expect(accept.value).toBe('1.5');
    expect(accept.validity.stepMismatch).toBe(true);
    expect(update).not.toHaveBeenCalled();
    expect(screen.queryByText(/was saved as version/)).toBeNull();
  });

  it('explains an invalid completion deadline without calling the update endpoint', async () => {
    const user = userEvent.setup();
    mockLists({ 'sla-policies': [policy] });
    const update = vi.spyOn(staffApi, 'updateSlaPolicy');
    renderAdmin(<SlaPage />, 'sla', ['service.read', 'sla.manage']);

    const accept = await screen.findByRole('spinbutton', { name: 'Standard accept minutes' });
    await user.clear(accept);
    await user.type(accept, '40');
    await user.click(screen.getByRole('button', { name: 'Save as v2' }));

    expect(
      await screen.findByText('Completion time must be at least the acceptance time.'),
    ).toBeTruthy();
    expect(update).not.toHaveBeenCalled();
  });

  it('submits one update on repeated clicks and waits for the confirmed server version', async () => {
    const user = userEvent.setup();
    const records: Record<string, unknown[]> = { 'sla-policies': [policy] };
    mockLists(records);
    const pending = deferred<{ slaPolicy: SlaPolicy }>();
    const update = vi.spyOn(staffApi, 'updateSlaPolicy').mockReturnValue(pending.promise);
    renderAdmin(<SlaPage />, 'sla', ['service.read', 'sla.manage']);

    const accept = await screen.findByRole<HTMLInputElement>('spinbutton', {
      name: 'Standard accept minutes',
    });
    const complete = screen.getByRole<HTMLInputElement>('spinbutton', {
      name: 'Standard complete minutes',
    });
    await user.clear(accept);
    await user.type(accept, '7');
    await user.dblClick(screen.getByRole('button', { name: 'Save as v2' }));

    const saving = screen.getByRole<HTMLButtonElement>('button', { name: 'Saving…' });
    expect(saving.disabled).toBe(true);
    expect(accept.disabled).toBe(true);
    expect(complete.disabled).toBe(true);
    await user.click(saving);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith('staff-token', policy.id, {
      acceptMinutes: 7,
      completeMinutes: 30,
    });

    // A concurrent admin may already have created v2. Use the actual response,
    // rather than reporting the version anticipated by the stale page.
    const saved: SlaPolicy = {
      ...policy,
      currentVersion: 3,
      acceptMinutes: 7,
      versions: [
        {
          id: 'sla-version-3',
          version: 3,
          acceptMinutes: 7,
          completeMinutes: 30,
          createdAt: '2026-10-05T08:02:00Z',
        },
        {
          id: 'sla-version-2',
          version: 2,
          acceptMinutes: 6,
          completeMinutes: 30,
          createdAt: '2026-10-05T08:01:00Z',
        },
        ...policy.versions,
      ],
    };
    await act(async () => {
      records['sla-policies'] = [saved];
      pending.resolve({ slaPolicy: saved });
      await pending.promise;
    });
    expect(await screen.findByText('Standard was saved as version 3.')).toBeTruthy();
    expect(update).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Saving…' })).toBeNull());
  });
});

describe('Staff creation recovery', () => {
  it('keeps the created person and explains a failed role assignment without creating a duplicate', async () => {
    const user = userEvent.setup();
    const member: StaffMember = {
      id: 'asha-membership',
      email: 'asha@example.test',
      displayName: 'Asha Kumar',
      status: 'ACTIVE',
      dutyStatus: 'OFF_DUTY',
      dutyChangedAt: null,
      departmentIds: [],
      coverage: [],
      roleIds: [],
    };
    const records: Record<string, unknown[]> = {
      staff: [],
      roles: [{ id: 'nurse-role', name: 'Nurse', active: true }],
    };
    const list = mockLists(records);
    const create = vi.spyOn(staffApi, 'createStaff').mockImplementation(() => {
      records.staff = [member];
      return Promise.resolve({ staff: member });
    });
    const assign = vi
      .spyOn(staffApi, 'assignRole')
      .mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'This role cannot be assigned.'));
    renderAdmin(<StaffPage />, 'staff', ['staff.read', 'staff.manage', 'role.read', 'role.manage']);

    await screen.findByRole('heading', { name: 'Staff' });
    await user.type(screen.getByLabelText('Full name'), member.displayName);
    await user.type(screen.getByLabelText('Email'), member.email);
    await user.type(screen.getByLabelText('Temporary password (12+ characters)'), 'StrongPass123!');
    await user.selectOptions(screen.getByLabelText('Role (optional)'), 'nurse-role');
    await user.click(screen.getByRole('button', { name: 'Add staff member' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Asha Kumar was created, but their role was not assigned.');
    expect(alert.textContent).toContain('Do not create them again; use Manage to finish setup.');
    expect(await screen.findByRole('dialog', { name: 'Manage Asha Kumar' })).toBeTruthy();
    expect(screen.getByRole('row', { name: /Asha Kumar.*asha@example.test/ })).toBeTruthy();
    expect(list.mock.calls.filter((call) => call[1] === 'staff')).toHaveLength(2);
    expect(create).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith('staff-token', member.id, 'nurse-role');
    expect(screen.getByLabelText<HTMLInputElement>('Full name').value).toBe('');
    expect(
      screen.getByLabelText<HTMLInputElement>('Temporary password (12+ characters)').value,
    ).toBe('');

    await user.click(screen.getByRole('button', { name: 'Close dialog' }));
    await user.click(screen.getByRole('button', { name: 'Add staff member' }));
    expect(create).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledTimes(1);
  });
});

describe('Eligibility check interactions', () => {
  it('locks selections while pending and removes prior results when checking a different bed', async () => {
    const user = userEvent.setup();
    mockLists({
      beds: [
        {
          id: 'bed-a',
          code: 'A',
          displayName: 'Bed A',
          wardId: 'ward',
          roomId: null,
          status: 'AVAILABLE',
          active: true,
        },
        {
          id: 'bed-b',
          code: 'B',
          displayName: 'Bed B',
          wardId: 'ward',
          roomId: null,
          status: 'AVAILABLE',
          active: true,
        },
      ],
      wards: [{ id: 'ward', code: 'GEN', name: 'General Ward', floorId: 'floor', active: true }],
      floors: [{ id: 'floor', code: 'F1', name: 'First Floor', buildingId: null, active: true }],
      departments: [{ id: 'nursing', code: 'NURSING', name: 'Nursing', active: true }],
    });
    const first = deferred<EligibleStaff[]>();
    const second = deferred<EligibleStaff[]>();
    const eligible = vi
      .spyOn(staffApi, 'eligible')
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    renderAdmin(<EligibilityPage />, 'eligibility', ['staff.read', 'bed.read', 'location.read']);

    const bed = await screen.findByRole<HTMLSelectElement>('combobox', { name: 'Bed' });
    const department = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Department' });
    await user.selectOptions(bed, 'bed-a');
    await user.selectOptions(department, 'nursing');
    await user.dblClick(screen.getByRole('button', { name: 'Check eligibility' }));
    expect(bed.disabled).toBe(true);
    expect(department.disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Checking…' }).disabled).toBe(
      true,
    );
    await user.selectOptions(bed, 'bed-b');
    expect(bed.value).toBe('bed-a');
    expect(eligible).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.resolve([{ membershipId: 'asha', displayName: 'Asha Kumar', dutyChangedAt: null }]);
      await first.promise;
    });
    expect(await screen.findByText('Asha Kumar')).toBeTruthy();
    expect(bed.disabled).toBe(false);
    expect(department.disabled).toBe(false);

    await user.selectOptions(bed, 'bed-b');
    expect(screen.queryByText('Asha Kumar')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Check eligibility' }));
    expect(screen.queryByText('Asha Kumar')).toBeNull();
    await act(async () => {
      second.resolve([{ membershipId: 'ravi', displayName: 'Ravi Singh', dutyChangedAt: null }]);
      await second.promise;
    });
    const result = await screen.findByRole('status');
    expect(within(result).getByText('Ravi Singh')).toBeTruthy();
    expect(within(result).queryByText('Asha Kumar')).toBeNull();
    expect(eligible).toHaveBeenNthCalledWith(1, 'staff-token', 'bed-a', 'nursing');
    expect(eligible).toHaveBeenNthCalledWith(2, 'staff-token', 'bed-b', 'nursing');
  });
});
