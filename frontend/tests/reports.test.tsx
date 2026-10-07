import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode } from 'react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { reportApi, type RequestLogRow, type RequestReport } from '../src/api';
import { type AdminContext } from '../src/features/workspace/AdminLayout';
import { AuditLogPage } from '../src/features/reports/AuditLogPage';
import { ReportsPage } from '../src/features/reports/ReportsPage';
import { requestLogCsv, toCsv } from '../src/features/reports/report-format';

function show(page: ReactNode) {
  const context: AdminContext = {
    token: 'token',
    me: {
      user: { id: 'u', email: 'm@example.test', displayName: 'Manager' },
      membershipId: 'manager',
      tenant: { hospitalId: 'h', code: 'TEST', name: 'Test Hospital', logoUrl: null },
      permissions: ['analytics.read', 'audit.read'],
      scopedPermissions: ['analytics.read', 'audit.read'],
    },
    can: () => true,
    canAnywhere: () => true,
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
}

const report: RequestReport = {
  range: { from: '2026-10-01T00:00:00Z', to: '2026-10-08T00:00:00Z' },
  truncated: false,
  summary: {
    total: 5,
    open: 1,
    completed: 2,
    cancelled: 1,
    cancelledByPatient: 1,
    rejected: 1,
    overdueOpen: 1,
    acceptedOnTimePercent: 66.7,
    completedOnTimePercent: 50,
    averageMinutesToAccept: 4,
    averageMinutesToComplete: 75,
  },
  byDepartment: [
    {
      id: 'pantry',
      name: 'Pantry',
      total: 3,
      completed: 1,
      open: 1,
      cancelled: 0,
      rejected: 1,
      overdue: 1,
      averageMinutesToComplete: 12,
    },
  ],
  byService: [],
  byStaff: [
    {
      membershipId: 'pavan',
      name: 'Pavan',
      assigned: 2,
      accepted: 1,
      completed: 1,
      completedOnTime: 1,
      completedOnTimePercent: 100,
      rejected: 1,
      rejectReasons: ['Out of stock'],
      transferredAway: 0,
      openNow: 0,
      assignmentsMade: 0,
      closed: 0,
      cancelled: 0,
      averageMinutesToAccept: 3,
      averageMinutesOfWork: 9,
    },
  ],
  notCompleted: [
    {
      id: 'r2',
      publicId: 'CR-REJECTED',
      serviceName: 'Drinking Water',
      location: 'Floor A · Ward A · Bed A1',
      status: 'REJECTED',
      outcome: 'rejected',
      submittedAt: '2026-10-06T08:00:00Z',
      endedAt: '2026-10-06T08:05:00Z',
      endedBy: 'Pavan',
      reason: 'Out of stock',
      assigneeName: 'Pavan',
      overdueMinutes: null,
    },
  ],
};

const logRow: RequestLogRow = {
  id: 'r1',
  publicId: 'CR-DONE',
  serviceName: 'Drinking Water',
  departmentId: 'pantry',
  departmentName: 'Pantry',
  priority: 'NORMAL',
  location: 'Floor A · Ward A · Bed A1',
  bedName: 'Bed A1',
  status: 'CLOSED',
  outcome: 'completed',
  submittedAt: '2026-10-06T07:00:00Z',
  acceptDueAt: '2026-10-06T07:03:00Z',
  completeDueAt: '2026-10-06T07:10:00Z',
  assigneeName: 'Pavan',
  assignedBy: 'Manager',
  acceptedBy: 'Pavan',
  acceptedAt: '2026-10-06T07:02:00Z',
  completedBy: 'Pavan',
  completedAt: '2026-10-06T07:20:00Z',
  closedBy: 'Manager',
  closedAt: '2026-10-06T07:30:00Z',
  endedBy: null,
  endedAt: null,
  endReason: null,
  acceptedOnTime: true,
  completedOnTime: false,
  overdueMinutes: null,
  minutesToAccept: 2,
  minutesToComplete: 20,
};

describe('Reports', () => {
  it('shows totals and what each person did, and opens that person’s requests', async () => {
    const user = userEvent.setup();
    vi.spyOn(reportApi, 'requests').mockResolvedValue(report);
    const log = vi
      .spyOn(reportApi, 'log')
      .mockResolvedValue({ truncated: false, requests: [logRow] });
    show(<ReportsPage />);

    const tiles = await screen.findByText('Overdue now');
    expect(tiles.closest('.stat')?.textContent).toContain('1');
    expect(screen.getByText('1 by the patient')).toBeTruthy();
    const row = screen.getByRole('button', { name: 'Pavan' }).closest('tr')!;
    expect(row.textContent).toContain('Turned down: Out of stock');

    await user.click(screen.getByRole('button', { name: 'Pavan' }));
    expect(log).toHaveBeenCalledWith('token', expect.objectContaining({ membershipId: 'pavan' }));
    const table = await screen.findByRole('table');
    expect(within(table).getByText('CR-DONE')).toBeTruthy();
    expect(within(table).getByText('late')).toBeTruthy();
  });

  it('explains why requests were not completed and shows the full history', async () => {
    const user = userEvent.setup();
    vi.spyOn(reportApi, 'requests').mockResolvedValue(report);
    vi.spyOn(reportApi, 'timeline').mockResolvedValue({
      ...logRow,
      id: 'r2',
      outcome: 'rejected',
      events: [
        {
          type: 'SUBMITTED',
          at: '2026-10-06T08:00:00Z',
          actor: { type: 'GUEST', membershipId: null, name: 'Patient' },
          reason: null,
          assigneeName: null,
          previousAssigneeName: null,
        },
        {
          type: 'REJECTED',
          at: '2026-10-06T08:05:00Z',
          actor: { type: 'STAFF', membershipId: 'pavan', name: 'Pavan' },
          reason: 'Out of stock',
          assigneeName: null,
          previousAssigneeName: null,
        },
      ],
    });
    show(<ReportsPage />);
    await user.click(await screen.findByRole('button', { name: 'Not completed (1)' }));
    const item = screen.getByText('Drinking Water').closest('li')!;
    expect(item.textContent).toContain('Turned down by Pavan');
    expect(item.textContent).toContain('Reason: Out of stock');

    await user.click(within(item).getByRole('button', { name: 'Full history' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Request sent')).toBeTruthy();
    expect(within(dialog).getByText('Reason: Out of stock')).toBeTruthy();
  });
});

describe('Audit log', () => {
  it('lists changes in plain words, filters by kind, and loads older entries', async () => {
    const user = userEvent.setup();
    const entry = (id: string, action: string) => ({
      id,
      createdAt: '2026-10-06T09:00:00Z',
      action,
      actorType: 'STAFF' as const,
      actorName: 'Asha Rao',
      targetType: 'HospitalMembership',
      targetId: 't',
      targetName: 'Ravi Kumar',
      metadata: { from: 'ACTIVE', to: 'SUSPENDED' },
    });
    const audit = vi
      .spyOn(reportApi, 'audit')
      .mockResolvedValueOnce({ entries: [entry('a1', 'staff.status')], nextBefore: 'a1' })
      .mockResolvedValueOnce({ entries: [entry('a2', 'role.assign')], nextBefore: null })
      .mockResolvedValue({ entries: [entry('a3', 'request.reject')], nextBefore: null });
    show(<AuditLogPage />);

    const first = (await screen.findByText('Changed staff status')).closest('tr')!;
    expect(first.textContent).toContain('Asha Rao');
    expect(first.textContent).toContain('Ravi Kumar');
    expect(first.textContent).toContain('active → suspended');
    await user.click(screen.getByRole('button', { name: 'Load older changes' }));
    expect(await screen.findByText('Gave someone a role')).toBeTruthy();
    expect(audit).toHaveBeenLastCalledWith('token', expect.objectContaining({ before: 'a1' }));

    await user.selectOptions(screen.getByRole('combobox', { name: 'Show' }), 'request');
    expect(await screen.findByText('Turned down a request')).toBeTruthy();
    expect(audit).toHaveBeenLastCalledWith(
      'token',
      expect.objectContaining({ category: 'request' }),
    );
  });
});

describe('CSV export', () => {
  it('quotes fields, keeps Unicode, and neutralises spreadsheet formulas', () => {
    const csv = toCsv([
      ['Name', 'Note'],
      ['रवि, Kumar', 'said "ok"'],
      ['=HYPERLINK("x")', null],
    ]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('"रवि, Kumar","said ""ok"""');
    expect(csv).toContain(`"'=HYPERLINK(""x"")",`);
    expect(requestLogCsv([logRow]).split('\r\n')[1]).toContain('CR-DONE,Drinking Water,Pantry');
  });
});
