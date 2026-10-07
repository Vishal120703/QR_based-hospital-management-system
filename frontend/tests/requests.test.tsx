import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { staffApi, type Me, type StaffRequest } from '../src/api';
import { type AdminContext } from '../src/pages/AdminLayout';
import { RequestsPage } from '../src/pages/RequestsPage';

const request: StaffRequest = {
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
  submittedAt: '2026-10-06T08:00:00Z',
  acceptDueAt: '2026-10-06T08:05:00Z',
  completeDueAt: '2026-10-06T08:30:00Z',
  completedAt: null,
  version: 1,
};

function show(permissions: string[], membershipId = 'manager') {
  const me: Me = {
    user: { id: 'user', email: 'user@example.test', displayName: 'Test User' },
    membershipId,
    tenant: { hospitalId: 'hospital', code: 'TEST', name: 'Test Hospital', logoUrl: null },
    permissions: [],
    scopedPermissions: permissions,
  };
  const context: AdminContext = {
    token: 'token',
    me,
    can: () => false,
    canAnywhere: (permission) => permissions.includes(permission),
    reportError: vi.fn(),
    reportSuccess: vi.fn(),
  };
  return render(
    <MemoryRouter>
      <Routes>
        <Route element={<Outlet context={context} />}>
          <Route path="/" element={<RequestsPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('Request work screen', () => {
  it('lets a manager choose only eligible staff and assign a submitted request', async () => {
    const user = userEvent.setup();
    vi.spyOn(staffApi, 'requests').mockResolvedValue([request]);
    vi.spyOn(staffApi, 'eligible').mockResolvedValue([
      { membershipId: 'staff-1', displayName: 'Demo Nurse', dutyChangedAt: null },
    ]);
    const action = vi.spyOn(staffApi, 'requestAction').mockResolvedValue({
      ...request,
      status: 'ASSIGNED',
      version: 2,
    });
    show(['request.read', 'request.assign', 'staff.read']);
    await user.click(await screen.findByRole('button', { name: 'Choose staff' }));
    await user.selectOptions(
      screen.getByRole('combobox', { name: `Staff for ${request.publicId}` }),
      'staff-1',
    );
    await user.click(screen.getByRole('button', { name: 'Assign request' }));
    expect(action).toHaveBeenCalledWith('token', request.id, 'assign', {
      expectedVersion: 1,
      assigneeId: 'staff-1',
    });
  });

  it('shows assigned staff only their action and lets them mark in-progress work complete', async () => {
    const user = userEvent.setup();
    vi.spyOn(staffApi, 'requests').mockResolvedValue([
      { ...request, status: 'IN_PROGRESS', assigneeId: 'staff-1', version: 4 },
      { ...request, id: 'other', publicId: 'CR-AAAAAAAAAAAAAAAA', assigneeId: 'staff-2' },
    ]);
    const action = vi.spyOn(staffApi, 'requestAction').mockResolvedValue({
      ...request,
      status: 'COMPLETED',
      version: 5,
    });
    show(['request.read', 'request.complete'], 'staff-1');
    expect(await screen.findByRole('button', { name: 'Mark complete' })).toBeTruthy();
    expect(screen.queryByText('CR-AAAAAAAAAAAAAAAA')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Choose staff' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Mark complete' }));
    expect(action).toHaveBeenCalledWith('token', request.id, 'complete', { expectedVersion: 4 });
  });

  it('lets a manager close completed work from the Ready to close tab', async () => {
    const user = userEvent.setup();
    vi.spyOn(staffApi, 'requests').mockResolvedValue([
      {
        ...request,
        status: 'COMPLETED',
        assigneeId: 'staff-1',
        assigneeName: 'Demo Nurse',
        version: 5,
      },
    ]);
    const action = vi
      .spyOn(staffApi, 'requestAction')
      .mockResolvedValue({ ...request, status: 'CLOSED', version: 6 });
    show(['request.read', 'request.assign', 'request.close']);
    await user.click(await screen.findByRole('button', { name: /Ready to close/ }));
    await user.click(screen.getByRole('button', { name: 'Close request' }));
    expect(action).toHaveBeenCalledWith('token', request.id, 'close', { expectedVersion: 5 });
  });

  it('asks for a reason before a manager cancels a request', async () => {
    const user = userEvent.setup();
    vi.spyOn(staffApi, 'requests').mockResolvedValue([request]);
    const action = vi
      .spyOn(staffApi, 'requestAction')
      .mockResolvedValue({ ...request, status: 'CANCELLED', version: 2 });
    show(['request.read', 'request.assign', 'request.cancel']);
    await user.click(await screen.findByRole('button', { name: 'Cancel…' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Reason' }), 'Other');
    const submit = screen.getByRole('button', { name: 'Cancel request' });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByRole('textbox', { name: 'Describe the reason' }), 'Discharged');
    await user.click(submit);
    expect(action).toHaveBeenCalledWith('token', request.id, 'cancel', {
      expectedVersion: 1,
      reason: 'Discharged',
    });
  });

  it('lets assigned staff turn down work with a reason', async () => {
    const user = userEvent.setup();
    vi.spyOn(staffApi, 'requests').mockResolvedValue([
      { ...request, status: 'ASSIGNED', assigneeId: 'staff-1', version: 2 },
    ]);
    const action = vi
      .spyOn(staffApi, 'requestAction')
      .mockResolvedValue({ ...request, status: 'REJECTED', version: 3 });
    show(['request.read', 'request.accept', 'request.reject'], 'staff-1');
    await user.click(await screen.findByRole('button', { name: 'Turn down…' }));
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Reason' }),
      'Patient not at the bed',
    );
    await user.click(screen.getByRole('button', { name: 'Turn down request' }));
    expect(action).toHaveBeenCalledWith('token', request.id, 'reject', {
      expectedVersion: 2,
      reason: 'Patient not at the bed',
    });
  });

  it('lets a manager hand accepted work to someone else who is eligible', async () => {
    const user = userEvent.setup();
    vi.spyOn(staffApi, 'requests').mockResolvedValue([
      {
        ...request,
        status: 'ACCEPTED',
        assigneeId: 'staff-1',
        assigneeName: 'Demo Nurse',
        version: 3,
      },
    ]);
    vi.spyOn(staffApi, 'eligible').mockResolvedValue([
      { membershipId: 'staff-1', displayName: 'Demo Nurse', dutyChangedAt: null },
      { membershipId: 'staff-2', displayName: 'Second Nurse', dutyChangedAt: null },
    ]);
    const action = vi
      .spyOn(staffApi, 'requestAction')
      .mockResolvedValue({ ...request, status: 'ASSIGNED', version: 4 });
    show(['request.read', 'request.assign', 'request.transfer']);
    await user.click(await screen.findByRole('button', { name: 'Hand over…' }));
    const person = await screen.findByRole('combobox', { name: 'Hand over to' });
    // The current assignee is not offered; the only other person is preselected.
    expect(screen.queryByRole('option', { name: 'Demo Nurse' })).toBeNull();
    expect((person as HTMLSelectElement).value).toBe('staff-2');
    await user.click(screen.getByRole('button', { name: 'Hand over' }));
    expect(action).toHaveBeenCalledWith('token', request.id, 'transfer', {
      expectedVersion: 3,
      assigneeId: 'staff-2',
      reason: 'My shift has ended',
    });
  });

  it('flags open requests that are past their response-time target', async () => {
    vi.spyOn(staffApi, 'requests').mockResolvedValue([
      { ...request, acceptDueAt: new Date(Date.now() - 4 * 60_000).toISOString() },
    ]);
    show(['request.read', 'request.assign']);
    expect(await screen.findByText(/Accept overdue by 4 min/)).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('1 overdue');
  });
});
