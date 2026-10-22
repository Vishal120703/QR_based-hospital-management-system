import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { staffApi, type Me, type RequestQueueQuery, type StaffRequest } from '../src/api';
import { type AdminContext } from '../src/features/workspace/AdminLayout';
import { RequestsPage } from '../src/features/requests/RequestsPage';
import { isOverdue } from '../src/lib/request-status';

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
  isEscalated: false,
  escalationLevel: 0,
  version: 1,
};

const lists = {
  open: ['SUBMITTED', 'ASSIGNED', 'ACCEPTED', 'IN_PROGRESS'],
  completed: ['COMPLETED'],
  history: ['CLOSED', 'CANCELLED', 'REJECTED'],
};

// Answers like the server: one list and page at a time, with every count.
function serve(rows: StaffRequest[]) {
  return vi
    .spyOn(staffApi, 'requests')
    .mockImplementation((_token: string, query: RequestQueueQuery = {}) => {
      const now = Date.now();
      const statuses = lists[query.view ?? 'open'];
      const matching = rows.filter(
        (row) =>
          statuses.includes(row.status) &&
          (!query.status || row.status === query.status) &&
          (!query.overdue || isOverdue(row, now)),
      );
      const page = query.page ?? 1;
      const pageSize = query.pageSize ?? 25;
      const count = (list: string[]) => rows.filter((row) => list.includes(row.status)).length;
      return Promise.resolve({
        serviceRequests: matching.slice((page - 1) * pageSize, page * pageSize),
        page,
        pageSize,
        total: matching.length,
        counts: {
          open: count(lists.open),
          waiting: count(['SUBMITTED']),
          overdue: rows.filter((row) => isOverdue(row, now)).length,
          completed: count(lists.completed),
          history: count(lists.history),
          completedToday: 0,
        },
      });
    });
}

function show(permissions: string[], membershipId = 'manager') {
  const me: Me = {
    user: { id: 'user', email: 'user@example.test', displayName: 'Test User' },
    membershipId,
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
  it('ignores a late background refresh after changing the request tab', async () => {
    const user = userEvent.setup();
    const load = serve([request]);
    show(['request.read', 'request.assign']);
    await screen.findByText(request.serviceName);
    let finish!: (value: Awaited<ReturnType<typeof staffApi.requests>>) => void;
    load.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await user.click(screen.getByRole('button', { name: /^Refresh$/ }));
    await user.click(screen.getByRole('button', { name: /Ready to close/ }));
    await screen.findByText('No completed requests are waiting.');
    await act(async () => {
      finish({
        serviceRequests: [request],
        page: 1,
        pageSize: 25,
        total: 1,
        counts: { open: 1, completed: 0, waiting: 1, overdue: 1, history: 0, completedToday: 0 },
      });
      await Promise.resolve();
    });
    expect(screen.getByText('No completed requests are waiting.')).toBeTruthy();
    expect(screen.queryByText(request.serviceName)).toBeNull();
  });

  it('lets a manager choose only eligible staff and assign a submitted request', async () => {
    const user = userEvent.setup();
    serve([request]);
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
    serve([
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
    serve([
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
    serve([request]);
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
    serve([{ ...request, status: 'ASSIGNED', assigneeId: 'staff-1', version: 2 }]);
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
    serve([
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
    serve([{ ...request, acceptDueAt: new Date(Date.now() - 4 * 60_000).toISOString() }]);
    show(['request.read', 'request.assign']);
    expect(await screen.findByText(/Accept overdue by 4 min/)).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('1 overdue');
  });

  it('pages through a long queue and keeps the counts for every list', async () => {
    const user = userEvent.setup();
    const rows = Array.from({ length: 30 }, (_, index) => ({
      ...request,
      id: `request-${index}`,
      publicId: `CR-${String(index).padStart(16, '0')}`,
      serviceName: `Service ${index}`,
      acceptDueAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      completeDueAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
    }));
    const load = serve(rows);
    show(['request.read', 'request.assign']);
    expect(await screen.findByText('Service 0')).toBeTruthy();
    expect(screen.getByText(/Showing 1–25 of 30/)).toBeTruthy();
    expect(screen.queryByText('Service 25')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Service 29')).toBeTruthy();
    expect(screen.getByText('Page 2 of 2')).toBeTruthy();
    expect(load).toHaveBeenLastCalledWith('token', expect.objectContaining({ page: 2 }));
    expect(screen.getByRole('button', { name: /Open 30/ })).toBeTruthy();
  });

  it('shows only overdue or only unassigned work when asked', async () => {
    const user = userEvent.setup();
    const late = { ...request, id: 'late', serviceName: 'Late water' };
    const onTime = {
      ...request,
      id: 'on-time',
      serviceName: 'Fresh linen',
      status: 'ASSIGNED' as const,
      assigneeId: 'someone',
      assigneeName: 'Someone',
      acceptDueAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      completeDueAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
    };
    const load = serve([late, onTime]);
    show(['request.read', 'request.assign']);
    expect(await screen.findByText('Fresh linen')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /^Overdue 1/ }));
    expect(load).toHaveBeenLastCalledWith('token', expect.objectContaining({ overdue: true }));
    expect(await screen.findByText('Late water')).toBeTruthy();
    expect(screen.queryByText('Fresh linen')).toBeNull();

    await user.click(screen.getByRole('button', { name: /^Waiting for assignment 1/ }));
    expect(load).toHaveBeenLastCalledWith(
      'token',
      expect.objectContaining({ status: 'SUBMITTED' }),
    );
  });

  it('marks escalated, overdue, and unassigned requests so they stand out', async () => {
    serve([
      {
        ...request,
        id: 'escalated',
        serviceName: 'Escalated water',
        isEscalated: true,
        escalationLevel: 2,
        acceptDueAt: new Date(Date.now() - 40 * 60_000).toISOString(),
      },
      {
        ...request,
        id: 'waiting',
        serviceName: 'Fresh request',
        acceptDueAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        completeDueAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      },
    ]);
    show(['request.read', 'request.assign']);
    const escalated = (await screen.findByText('Escalated water')).closest('article')!;
    expect(escalated.className).toContain('late');
    expect(escalated.className).toContain('escalated');
    expect(escalated.textContent).toContain('Escalated · level 2');
    const waiting = screen.getByText('Fresh request').closest('article')!;
    expect(waiting.className).toContain('waiting');
    expect(waiting.textContent).not.toContain('Escalated');
  });
});
