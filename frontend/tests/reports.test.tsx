import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode } from 'react';
import { MemoryRouter, Outlet, Route, Routes, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import {
  reportApi,
  type AuditEntry,
  type PersonReport,
  type RequestLogRow,
  type RequestReport,
} from '../src/api';
import { type AdminContext } from '../src/features/workspace/AdminLayout';
import { AuditLogPage } from '../src/features/reports/AuditLogPage';
import { PersonReportPage } from '../src/features/reports/PersonReportPage';
import { ReportsPage } from '../src/features/reports/ReportsPage';
import {
  auditCsv,
  personBreakdown,
  personCsv,
  reportCsv,
  requestLogCsv,
  toCsv,
} from '../src/features/reports/report-format';

// Where the app is now, so a test can see where a link or a choice went.
function Address() {
  const location = useLocation();
  return <output data-testid="address">{`${location.pathname}${location.search}`}</output>;
}

function show(page: ReactNode, { path = '/', url = '/' }: { path?: string; url?: string } = {}) {
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
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route element={<Outlet context={context} />}>
          <Route path={path} element={page} />
          <Route path="*" element={<p>Somewhere else</p>} />
        </Route>
      </Routes>
      <Address />
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
  it('shows totals and what each person did, and links to that person’s report', async () => {
    const user = userEvent.setup();
    vi.spyOn(reportApi, 'requests').mockResolvedValue(report);
    show(<ReportsPage />, { url: '/?period=30d' });

    const tiles = await screen.findByText('Overdue now');
    expect(tiles.closest('.stat')?.textContent).toContain('1');
    expect(screen.getByText('1 by the patient')).toBeTruthy();
    const person = screen.getByRole('link', { name: 'Pavan' });
    const row = person.closest('tr')!;
    expect(row.textContent).toContain('Turned down: Out of stock');
    expect(row.textContent).toContain('1 of 2');
    expect(row.textContent).toContain('100%');
    // The person's report opens for the same period.
    expect(person.getAttribute('href')).toBe('/admin/reports/people/pavan?period=30d');

    await user.click(screen.getByRole('button', { name: 'Last 7 days' }));
    expect(screen.getByTestId('address').textContent).toBe('/?period=7d');
    expect(screen.getByRole('link', { name: 'Pavan' }).getAttribute('href')).toBe(
      '/admin/reports/people/pavan?period=7d',
    );
  });

  it('filters the request log by person', async () => {
    const user = userEvent.setup();
    vi.spyOn(reportApi, 'requests').mockResolvedValue(report);
    const log = vi
      .spyOn(reportApi, 'log')
      .mockResolvedValue({ truncated: false, requests: [logRow] });
    show(<ReportsPage />);

    await user.click(await screen.findByRole('button', { name: 'Request log' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Person' }), 'pavan');
    expect(log).toHaveBeenLastCalledWith(
      'token',
      expect.objectContaining({ membershipId: 'pavan' }),
    );
    expect(await screen.findByText('Showing requests Pavan was involved in.')).toBeTruthy();
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
  const entry = (id: string, action: string, extra: Partial<AuditEntry> = {}): AuditEntry => ({
    id,
    createdAt: new Date().toISOString(),
    action,
    actorType: 'STAFF',
    actorId: 'asha',
    actorName: 'Asha Rao',
    targetType: 'HospitalMembership',
    targetId: 'ravi',
    targetName: 'Ravi Kumar',
    details: [],
    changes: [{ field: 'Status', before: 'active', after: 'suspended' }],
    ...extra,
  });

  it('shows who changed what, grouped by day, and loads older entries', async () => {
    const user = userEvent.setup();
    const audit = vi
      .spyOn(reportApi, 'audit')
      .mockResolvedValueOnce({
        entries: [entry('a1', 'staff.status')],
        nextBefore: 'a1',
        people: [{ id: 'asha', name: 'Asha Rao' }],
      })
      .mockResolvedValueOnce({
        entries: [
          entry('a2', 'role.assign', {
            changes: [],
            details: [
              { label: 'Role', value: 'Care Staff' },
              { label: 'Where', value: 'Whole hospital' },
            ],
          }),
        ],
        nextBefore: null,
      });
    show(<AuditLogPage />);

    const today = await screen.findByRole('region', { name: 'Today' });
    const first = within(today).getByText('Changed staff status').closest('li')!;
    expect(first.textContent).toContain('Asha Rao');
    expect(first.textContent).toContain('Ravi Kumar');
    expect(within(first).getByRole('list', { name: 'What changed' }).textContent).toContain(
      'Statusactive→changed tosuspended',
    );
    await user.click(screen.getByRole('button', { name: 'Load older changes' }));
    expect(await screen.findByText('Gave someone a role')).toBeTruthy();
    expect(screen.getByText('Care Staff')).toBeTruthy();
    expect(audit).toHaveBeenLastCalledWith('token', expect.objectContaining({ before: 'a1' }));
  });

  it('shows everything one person changed, or everything that happened to one item', async () => {
    const user = userEvent.setup();
    const audit = vi.spyOn(reportApi, 'audit').mockResolvedValue({
      entries: [entry('a1', 'staff.status')],
      nextBefore: null,
      people: [{ id: 'asha', name: 'Asha Rao' }],
    });
    show(<AuditLogPage />);

    await user.click(await screen.findByRole('button', { name: 'Asha Rao' }));
    expect(audit).toHaveBeenLastCalledWith(
      'token',
      expect.objectContaining({ membershipId: 'asha' }),
    );
    expect(screen.getByLabelText('Active filters').textContent).toContain('Changes by Asha Rao');

    await user.click(screen.getByRole('button', { name: 'Ravi Kumar' }));
    expect(audit).toHaveBeenLastCalledWith(
      'token',
      expect.objectContaining({ membershipId: 'asha', targetId: 'ravi' }),
    );
    expect(screen.getByLabelText('Active filters').textContent).toContain('History of Ravi Kumar');

    await user.selectOptions(screen.getByRole('combobox', { name: 'What' }), 'request');
    expect(audit).toHaveBeenLastCalledWith(
      'token',
      expect.objectContaining({ category: 'request' }),
    );
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(audit).toHaveBeenLastCalledWith(
      'token',
      expect.objectContaining({
        category: undefined,
        membershipId: undefined,
        targetId: undefined,
      }),
    );
  });

  it('downloads the changes shown as a spreadsheet', () => {
    const csv = auditCsv([
      entry('a1', 'request.transfer', {
        targetName: 'Drinking Water (CR-1)',
        changes: [{ field: 'Assigned to', before: 'Pavan', after: 'Neha' }],
        details: [{ label: 'Reason', value: 'Busy' }],
      }),
    ]).split('\r\n');
    // The byte-order mark makes Excel read non-English names correctly.
    expect(csv[0]).toBe('\uFEFFWhen,Who,What happened,Item,What changed,Details');
    expect(csv[1]).toContain(
      'Asha Rao,Handed a request to someone else,Drinking Water (CR-1),Assigned to: Pavan → Neha,Reason: Busy',
    );
  });
});

const personReport: PersonReport = {
  range: { from: '2026-10-01T00:00:00Z', to: '2026-10-08T00:00:00Z' },
  truncated: false,
  person: { membershipId: 'pavan', name: 'Pavan' },
  work: report.byStaff[0]!,
  hospital: { averageMinutesToAccept: 5, averageMinutesOfWork: 12, completedOnTimePercent: 80 },
  people: [
    { membershipId: 'neha', name: 'Neha' },
    { membershipId: 'pavan', name: 'Pavan' },
  ],
  activity: [
    {
      kind: 'rejected',
      at: '2026-10-06T08:05:00Z',
      requestId: 'r2',
      publicId: 'CR-REJECTED',
      serviceName: 'Drinking Water',
      location: 'Floor A · Ward A · Bed A1',
      otherName: null,
      minutes: null,
      onTime: null,
      reason: 'Out of stock',
    },
    {
      kind: 'completed',
      at: '2026-10-06T07:20:00Z',
      requestId: 'r1',
      publicId: 'CR-DONE',
      serviceName: 'Drinking Water',
      location: 'Floor A · Ward A · Bed A1',
      otherName: null,
      minutes: 18,
      onTime: false,
      reason: null,
    },
    {
      kind: 'accepted',
      at: '2026-10-06T07:02:00Z',
      requestId: 'r1',
      publicId: 'CR-DONE',
      serviceName: 'Drinking Water',
      location: 'Floor A · Ward A · Bed A1',
      otherName: null,
      minutes: 2,
      onTime: true,
      reason: null,
    },
    {
      kind: 'assignedToThem',
      at: '2026-10-06T07:00:00Z',
      requestId: 'r1',
      publicId: 'CR-DONE',
      serviceName: 'Drinking Water',
      location: 'Floor A · Ward A · Bed A1',
      otherName: 'Manager',
      minutes: null,
      onTime: null,
      reason: null,
    },
  ],
};

describe('One person’s report', () => {
  const personPath = '/admin/reports/people/:membershipId';

  it('shows their work beside the whole hospital, and every action they took', async () => {
    const user = userEvent.setup();
    const load = vi.spyOn(reportApi, 'person').mockResolvedValue(personReport);
    show(<PersonReportPage />, { path: personPath, url: '/admin/reports/people/pavan?period=30d' });

    expect(await screen.findByRole('heading', { name: 'Pavan', level: 1 })).toBeTruthy();
    expect(load).toHaveBeenCalledWith('token', 'pavan', expect.any(Object));
    expect(screen.getByRole('button', { name: 'Last 30 days' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('link', { name: 'Reports' }).getAttribute('href')).toBe(
      '/admin/reports?period=30d',
    );

    const compare = screen.getByRole('region', { name: 'Compared with the whole hospital' });
    expect(compare.textContent).toContain('100%');
    expect(compare.textContent).toContain('80%');

    const byService = screen.getByRole('region', { name: 'By service' });
    expect(within(byService).getByText('Drinking Water')).toBeTruthy();

    const actions = screen.getByRole('region', { name: /Every action/ });
    expect(within(actions).getAllByRole('row')).toHaveLength(5);
    expect(within(actions).getByText('by Manager')).toBeTruthy();
    expect(within(actions).getByText('work took 18 min · late')).toBeTruthy();

    await user.selectOptions(within(actions).getByRole('combobox', { name: 'Show' }), 'rejected');
    const rows = within(actions).getAllByRole('row');
    expect(rows).toHaveLength(2);
    expect(rows[1]!.textContent).toContain('reason: Out of stock');
  });

  it('switches to another person for the same period', async () => {
    const user = userEvent.setup();
    vi.spyOn(reportApi, 'person').mockResolvedValue(personReport);
    show(<PersonReportPage />, { path: personPath, url: '/admin/reports/people/pavan?period=30d' });

    await user.selectOptions(await screen.findByRole('combobox', { name: 'Person' }), 'neha');
    expect(screen.getByTestId('address').textContent).toBe('/admin/reports/people/neha?period=30d');
  });

  it('reads chosen dates from the address', async () => {
    const load = vi.spyOn(reportApi, 'person').mockResolvedValue(personReport);
    show(<PersonReportPage />, {
      path: personPath,
      url: '/admin/reports/people/pavan?period=custom&from=2026-10-01&to=2026-10-03',
    });

    await screen.findByRole('heading', { name: 'Pavan', level: 1 });
    expect(load).toHaveBeenCalledWith('token', 'pavan', {
      from: new Date('2026-10-01T00:00:00').toISOString(),
      to: new Date('2026-10-04T00:00:00').toISOString(),
    });
    expect(screen.getByLabelText('From')).toHaveProperty('value', '2026-10-01');
    expect(screen.getByLabelText('To')).toHaveProperty('value', '2026-10-03');
  });

  it('adds up their work per service and per day, and downloads it', () => {
    const { byService, byDay } = personBreakdown(personReport.activity);
    expect(byService).toEqual([
      {
        name: 'Drinking Water',
        accepted: 1,
        completed: 1,
        onTime: 0,
        rejected: 1,
        averageWorkMinutes: 18,
      },
    ]);
    expect(byDay).toHaveLength(1);
    expect(byDay[0]).toMatchObject({ accepted: 1, completed: 1, rejected: 1 });

    const csv = personCsv(personReport, 'Test Hospital');
    expect(csv).toContain('CARE QR staff work report');
    expect(csv).toContain('Person,Pavan');
    expect(csv).toContain('Completed on time (%),100,80');
    expect(csv).toContain('Average time to accept (minutes),3,5');
    for (const section of ['By service', 'Day by day', 'Every action']) {
      expect(csv).toContain(`\r\n${section}\r\n`);
    }
    expect(csv).toContain('Turned down,CR-REJECTED,Drinking Water');
  });
});

describe('Report downloads', () => {
  it('puts every section in one spreadsheet', () => {
    const csv = reportCsv(report, 'Test Hospital');
    expect(csv).toContain('CARE QR request report');
    expect(csv).toContain('Hospital,Test Hospital');
    for (const section of [
      'Summary',
      'Staff work',
      'By department',
      'By service',
      'Not completed',
    ]) {
      expect(csv).toContain(`\r\n${section}\r\n`);
    }
    expect(csv).toContain('Pavan');
  });

  it('lays out the whole report only while printing', async () => {
    vi.spyOn(reportApi, 'requests').mockResolvedValue(report);
    show(<ReportsPage />);
    expect(await screen.findByRole('button', { name: /Download report/ })).toHaveProperty(
      'disabled',
      false,
    );
    expect(screen.queryByRole('heading', { name: 'Request report' })).toBeNull();

    act(() => {
      window.dispatchEvent(new Event('beforeprint'));
    });
    const printed = screen.getByRole('heading', { name: 'Request report' }).closest('article')!;
    for (const section of [
      'Summary',
      'Staff work',
      'By department',
      'By service',
      'Not completed',
    ]) {
      expect(within(printed).getByRole('heading', { name: section })).toBeTruthy();
    }
    act(() => {
      window.dispatchEvent(new Event('afterprint'));
    });
    expect(screen.queryByRole('heading', { name: 'Request report' })).toBeNull();
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
