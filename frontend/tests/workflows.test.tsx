import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  credentials,
  staffApi,
  type Me,
  type SlaPolicy,
  type StaffMember,
} from '../src/api';
import { AdminLayout } from '../src/features/workspace/AdminLayout';
import { SlaPage } from '../src/features/services/SlaPage';
import { StaffPage } from '../src/features/people/StaffPage';

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
    patientRequestsPaused: false,
  },
  mustChangePassword: false,
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
  it('previews and imports a CSV staff file without displaying temporary passwords', async () => {
    const user = userEvent.setup();
    const member: StaffMember = {
      id: 'bulk-asha-membership',
      email: 'bulk-asha@example.test',
      displayName: 'Bulk Asha',
      status: 'ACTIVE',
      dutyStatus: 'OFF_DUTY',
      dutyChangedAt: null,
      departmentIds: ['nursing-department'],
      coverage: [],
      roleIds: ['nurse-role'],
    };
    mockLists({
      staff: [],
      departments: [{ id: 'nursing-department', code: 'NURSING', name: 'Nursing', active: true }],
      roles: [
        {
          id: 'nurse-role',
          name: 'Nurse',
          active: true,
          scopeLevel: 'HOSPITAL',
        },
      ],
      floors: [],
      wards: [],
    });
    const bulkCreate = vi
      .spyOn(staffApi, 'bulkCreateStaff')
      .mockResolvedValue({ staff: [member], created: 1 });
    renderAdmin(<StaffPage />, 'staff', [
      'staff.read',
      'staff.manage',
      'role.read',
      'role.manage',
      'location.read',
    ]);

    await screen.findByRole('heading', { name: 'Staff' });
    const file = new File(
      [
        'Full name,Email,Temporary password,Role,Role scope,Departments,Coverage\n' +
          'Bulk Asha,bulk-asha@example.test,StrongPass123!,Nurse,,NURSING,\n',
      ],
      'staff.csv',
      { type: 'text/csv' },
    );
    await user.upload(screen.getByLabelText('Staff spreadsheet'), file);

    expect(await screen.findByRole('table', { name: 'Staff import preview' })).toBeTruthy();
    expect(screen.queryByText('StrongPass123!')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Import 1 staff member' }));
    await waitFor(() =>
      expect(bulkCreate).toHaveBeenCalledWith('staff-token', [
        {
          displayName: 'Bulk Asha',
          email: 'bulk-asha@example.test',
          password: 'StrongPass123!',
          roleId: 'nurse-role',
          departmentIds: ['nursing-department'],
          coverage: [],
        },
      ]),
    );
    expect(await screen.findByText('1 staff member was added.')).toBeTruthy();
  });

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
