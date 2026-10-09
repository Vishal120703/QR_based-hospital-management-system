import type {
  ActivityKind,
  AuditEntry,
  PersonActivity,
  PersonReport,
  ReportOutcome,
  RequestLogRow,
  RequestReport,
} from '../../api';

export function formatMinutes(value: number | null): string {
  if (value === null) return '—';
  if (value < 1) return 'under 1 min';
  if (value < 60) return `${Math.round(value)} min`;
  const hours = Math.floor(value / 60);
  const rest = Math.round(value % 60);
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export function formatPercent(value: number | null): string {
  return value === null ? '—' : `${value}%`;
}

export function formatWhen(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export const outcomeLabels: Record<ReportOutcome, string> = {
  open: 'Open',
  completed: 'Completed',
  cancelled: 'Cancelled',
  rejected: 'Turned down',
  overdue: 'Overdue',
};

export const eventLabels: Record<string, string> = {
  SUBMITTED: 'Request sent',
  ASSIGNED: 'Assigned',
  ACCEPTED: 'Accepted',
  STARTED: 'Work started',
  COMPLETED: 'Completed',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
  REJECTED: 'Turned down',
  TRANSFERRED: 'Handed over',
};

// Plain sentences for audit actions; anything unknown is shown as written.
const actionLabels: Record<string, string> = {
  'hospital.bootstrap': 'Hospital created',
  'demo.seed': 'Demo data loaded',
  'hospital.update': 'Changed hospital details',
  'hospital.logo.update': 'Changed the hospital logo',
  'hospital.logo.remove': 'Removed the hospital logo',
  'platform.hospital.create': 'Platform created this hospital',
  'platform.hospital.update': 'Platform changed this hospital',
  'platform.hospital.logo': 'Platform changed the logo',
  'platform.hospital.logo.remove': 'Platform removed the logo',
  'platform.manager.add': 'Platform added a Hospital Manager',
  'platform.client.create': 'Platform added this client',
  'platform.client.update': 'Platform changed the client (group)',
  'staff.create': 'Added a staff member',
  'staff.status': 'Changed staff status',
  'staff.duty': 'Changed duty (on/off)',
  'staff.department.add': 'Added to a department',
  'staff.department.remove': 'Removed from a department',
  'staff.coverage.add': 'Added ward/floor coverage',
  'staff.coverage.remove': 'Removed ward/floor coverage',
  'role.create': 'Created a role',
  'role.update': 'Changed a role',
  'role.delete': 'Deleted a role',
  'role.assign': 'Gave someone a role',
  'role.unassign': 'Took a role away',
  'request.assign': 'Assigned a request',
  'request.transfer': 'Handed a request to someone else',
  'request.cancel': 'Cancelled a request',
  'request.reject': 'Turned down a request',
  'bedSession.start': 'Admitted a patient (bed session started)',
  'bedSession.close': 'Discharged (bed session closed)',
  'qr.generate': 'Created a QR code',
  'qr.rotate': 'Replaced a QR code',
  'qr.revoke': 'Disabled a QR code',
  'bed.bulk_create': 'Added beds in bulk',
  'shift.create': 'Added a shift',
  'shift.delete': 'Removed a shift',
};

export function actionLabel(action: string): string {
  if (actionLabels[action]) return actionLabels[action];
  const [subject = action, verb = ''] = action.split('.');
  const verbs: Record<string, string> = {
    create: 'Added',
    update: 'Changed',
    delete: 'Deleted',
  };
  const thing = subject.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return verbs[verb] ? `${verbs[verb]} ${thing === 'sla' ? 'response target' : thing}` : action;
}

export const auditCategories: { value: string; label: string }[] = [
  { value: '', label: 'All changes' },
  { value: 'request', label: 'Request handling' },
  { value: 'staff', label: 'Staff' },
  { value: 'role', label: 'Roles & access' },
  { value: 'bedSession', label: 'Admissions' },
  { value: 'qr', label: 'QR codes' },
  { value: 'bed', label: 'Beds' },
  { value: 'ward', label: 'Wards' },
  { value: 'floor', label: 'Floors' },
  { value: 'service', label: 'Services' },
  { value: 'sla', label: 'Response targets' },
  { value: 'department', label: 'Departments' },
  { value: 'hospital', label: 'Hospital' },
  { value: 'platform', label: 'Platform' },
];

// CSV that opens correctly in Excel: quoted fields, CRLF lines, and a BOM so
// non-English names keep their characters.
export function toCsv(rows: readonly (readonly (string | number | null)[])[]): string {
  const cell = (value: string | number | null) => {
    const text = value === null ? '' : String(value);
    // A leading = + - @ (or a tab or line break before one) would run as a
    // spreadsheet formula.
    const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return `\uFEFF${rows.map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`;
}

export function requestLogCsv(rows: readonly RequestLogRow[]): string {
  const yesNo = (value: boolean | null) => (value === null ? '' : value ? 'yes' : 'no');
  return toCsv([
    [
      'Reference',
      'Service',
      'Department',
      'Location',
      'Status',
      'Sent',
      'Assigned to',
      'Assigned by',
      'Accepted by',
      'Accepted at',
      'Accepted on time',
      'Completed by',
      'Completed at',
      'Completed on time',
      'Closed by',
      'Cancelled / turned down by',
      'Reason',
      'Minutes to accept',
      'Minutes to complete',
    ],
    ...rows.map((row) => [
      row.publicId,
      row.serviceName,
      row.departmentName,
      row.location,
      outcomeLabels[row.outcome],
      row.submittedAt,
      row.assigneeName,
      row.assignedBy,
      row.acceptedBy,
      row.acceptedAt,
      yesNo(row.acceptedOnTime),
      row.completedBy,
      row.completedAt,
      yesNo(row.completedOnTime),
      row.closedBy,
      row.endedBy,
      row.endReason,
      row.minutesToAccept,
      row.minutesToComplete,
    ]),
  ]);
}

// The audit entries shown, one row per change, for a spreadsheet.
export function auditCsv(entries: readonly AuditEntry[]): string {
  return toCsv([
    ['When', 'Who', 'What happened', 'Item', 'What changed', 'Details'],
    ...entries.map((entry) => [
      formatWhen(entry.createdAt),
      entry.actorName,
      actionLabel(entry.action),
      entry.targetName,
      entry.changes.map((item) => `${item.field}: ${item.before} → ${item.after}`).join('; '),
      entry.details.map((item) => `${item.label}: ${item.value}`).join('; '),
    ]),
  ]);
}

// "to" is exclusive (the next midnight, or now): the last day it covers.
const lastDay = (range: { to: string }) => new Date(new Date(range.to).getTime() - 1).toISOString();

// File name for a report download, using the period's local dates.
export function reportFileName(kind: string, range: { from: string; to: string }): string {
  return `care-qr-${kind}-${fileDate(range.from)}-to-${fileDate(lastDay(range))}.csv`;
}

const dayOf = (value: string) =>
  new Date(value).toLocaleDateString(undefined, { dateStyle: 'medium' });

// A local calendar date for file names: 2026-10-09 (not the UTC date).
export function fileDate(value: string | Date): string {
  const date = new Date(value);
  const pad = (number: number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// The report's period in words. "to" is exclusive (the next midnight, or now).
export function periodLabel(range: { from: string; to: string }): string {
  return `${dayOf(range.from)} – ${dayOf(lastDay(range))}`;
}

// Spreadsheet cells: minutes and percentages as plain numbers, so Excel can
// sort, total, and chart them; the unit is in the column heading.
const minutesCell = (value: number | null) => (value === null ? null : Math.round(value));
const percentCell = (value: number | null) => value;

// The whole report in one spreadsheet: totals, staff work, departments,
// services, and the requests that were not completed.
export function reportCsv(report: RequestReport, hospitalName: string): string {
  const { summary } = report;
  const group = (rows: RequestReport['byService']) => [
    [
      'Name',
      'Total',
      'Completed',
      'Completed (%)',
      'Open',
      'Cancelled',
      'Turned down',
      'Overdue',
      'Average time to complete (minutes)',
    ],
    ...rows.map((row) => [
      row.name,
      row.total,
      row.completed,
      row.total ? Math.round((row.completed / row.total) * 1000) / 10 : null,
      row.open,
      row.cancelled,
      row.rejected,
      row.overdue,
      minutesCell(row.averageMinutesToComplete),
    ]),
  ];
  return toCsv([
    ['CARE QR request report'],
    ['Hospital', hospitalName],
    ['Period', periodLabel(report.range)],
    ['Downloaded', formatWhen(new Date().toISOString())],
    [],
    ['Summary'],
    ['Requests', summary.total],
    ['Completed', summary.completed],
    ['Still open', summary.open],
    ['Overdue now', summary.overdueOpen],
    ['Cancelled', summary.cancelled],
    ['Cancelled by the patient', summary.cancelledByPatient],
    ['Turned down', summary.rejected],
    ['Accepted on time (%)', percentCell(summary.acceptedOnTimePercent)],
    ['Completed on time (%)', percentCell(summary.completedOnTimePercent)],
    ['Average time to accept (minutes)', minutesCell(summary.averageMinutesToAccept)],
    ['Average time to complete (minutes)', minutesCell(summary.averageMinutesToComplete)],
    [],
    ['Staff work'],
    [
      'Person',
      'Assigned',
      'Accepted',
      'Completed',
      'Completed on time (%)',
      'Turned down',
      'Handed over',
      'Open now',
      'Average time to accept (minutes)',
      'Average work time (minutes)',
      'Assigned to others',
      'Closed',
      'Reasons for turning down',
    ],
    ...report.byStaff.map((person) => [
      person.name,
      person.assigned,
      person.accepted,
      person.completed,
      percentCell(person.completedOnTimePercent),
      person.rejected,
      person.transferredAway,
      person.openNow,
      minutesCell(person.averageMinutesToAccept),
      minutesCell(person.averageMinutesOfWork),
      person.assignmentsMade,
      person.closed,
      person.rejectReasons.join('; '),
    ]),
    [],
    ['By department'],
    ...group(report.byDepartment),
    [],
    ['By service'],
    ...group(report.byService),
    [],
    ['Not completed'],
    [
      'Reference',
      'Service',
      'Where',
      'Result',
      'Sent',
      'With / ended by',
      'Reason',
      'Overdue by (minutes)',
    ],
    ...report.notCompleted.map((item) => [
      item.publicId,
      item.serviceName,
      item.location,
      outcomeLabels[item.outcome],
      formatWhen(item.submittedAt),
      item.endedBy ?? item.assigneeName,
      item.reason,
      minutesCell(item.overdueMinutes),
    ]),
  ]);
}

export const activityLabels: Record<ActivityKind, string> = {
  assignedToThem: 'Assigned to them',
  accepted: 'Accepted',
  started: 'Started work',
  completed: 'Completed',
  rejected: 'Turned down',
  handedOver: 'Handed over',
  assignedOthers: 'Assigned to someone',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

// One line about an action: with whom, how long it took, on time, and why.
export function activityDetail(item: PersonActivity): string {
  const parts: string[] = [];
  if (item.kind === 'assignedToThem' && item.otherName) parts.push(`by ${item.otherName}`);
  if ((item.kind === 'handedOver' || item.kind === 'assignedOthers') && item.otherName) {
    parts.push(`to ${item.otherName}`);
  }
  if (item.minutes !== null) {
    parts.push(
      item.kind === 'accepted'
        ? `${formatMinutes(item.minutes)} after being assigned`
        : `work took ${formatMinutes(item.minutes)}`,
    );
  }
  if (item.onTime !== null) parts.push(item.onTime ? 'on time' : 'late');
  if (item.reason) parts.push(`reason: ${item.reason}`);
  return parts.join(' · ');
}

export interface ServiceWork {
  name: string;
  accepted: number;
  completed: number;
  onTime: number;
  rejected: number;
  averageWorkMinutes: number | null;
}
export interface DayWork {
  // Local day, for sorting: 2026-10-09.
  date: string;
  label: string;
  accepted: number;
  completed: number;
  rejected: number;
}

// A person's work per service and per day, from their actions.
export function personBreakdown(activity: readonly PersonActivity[]): {
  byService: ServiceWork[];
  byDay: DayWork[];
} {
  const services = new Map<string, ServiceWork & { minutes: number[] }>();
  const days = new Map<string, DayWork>();
  for (const item of activity) {
    if (item.kind !== 'accepted' && item.kind !== 'completed' && item.kind !== 'rejected') continue;
    const service = services.get(item.serviceName) ?? {
      name: item.serviceName,
      accepted: 0,
      completed: 0,
      onTime: 0,
      rejected: 0,
      averageWorkMinutes: null,
      minutes: [],
    };
    const date = fileDate(item.at);
    const day = days.get(date) ?? {
      date,
      label: new Date(item.at).toLocaleDateString(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      }),
      accepted: 0,
      completed: 0,
      rejected: 0,
    };
    if (item.kind === 'accepted') {
      service.accepted += 1;
      day.accepted += 1;
    } else if (item.kind === 'completed') {
      service.completed += 1;
      day.completed += 1;
      if (item.onTime) service.onTime += 1;
      if (item.minutes !== null) service.minutes.push(item.minutes);
    } else {
      service.rejected += 1;
      day.rejected += 1;
    }
    services.set(item.serviceName, service);
    days.set(date, day);
  }
  return {
    byService: [...services.values()]
      .map(({ minutes, ...service }) => ({
        ...service,
        averageWorkMinutes: minutes.length
          ? Math.round((minutes.reduce((sum, value) => sum + value, 0) / minutes.length) * 10) / 10
          : null,
      }))
      .sort(
        (left, right) => right.completed - left.completed || left.name.localeCompare(right.name),
      ),
    byDay: [...days.values()].sort((left, right) => right.date.localeCompare(left.date)),
  };
}

// One person's report in one spreadsheet.
export function personCsv(report: PersonReport, hospitalName: string): string {
  const { work, hospital } = report;
  const { byService, byDay } = personBreakdown(report.activity);
  return toCsv([
    ['CARE QR staff work report'],
    ['Person', report.person.name],
    ['Hospital', hospitalName],
    ['Period', periodLabel(report.range)],
    ['Downloaded', formatWhen(new Date().toISOString())],
    [],
    ['Summary', 'This person', 'Whole hospital'],
    ['Assigned to them', work.assigned, null],
    ['Accepted', work.accepted, null],
    ['Completed', work.completed, null],
    [
      'Completed on time (%)',
      percentCell(work.completedOnTimePercent),
      percentCell(hospital.completedOnTimePercent),
    ],
    [
      'Average time to accept (minutes)',
      minutesCell(work.averageMinutesToAccept),
      minutesCell(hospital.averageMinutesToAccept),
    ],
    [
      'Average work time (minutes)',
      minutesCell(work.averageMinutesOfWork),
      minutesCell(hospital.averageMinutesOfWork),
    ],
    ['Turned down', work.rejected, null],
    ['Handed over to others', work.transferredAway, null],
    ['Open now', work.openNow, null],
    ['Assigned to others (as a manager)', work.assignmentsMade, null],
    ['Closed (as a manager)', work.closed, null],
    [],
    ['By service'],
    [
      'Service',
      'Accepted',
      'Completed',
      'Completed on time',
      'Turned down',
      'Average work time (minutes)',
    ],
    ...byService.map((item) => [
      item.name,
      item.accepted,
      item.completed,
      item.onTime,
      item.rejected,
      minutesCell(item.averageWorkMinutes),
    ]),
    [],
    ['Day by day'],
    ['Date', 'Accepted', 'Completed', 'Turned down'],
    ...byDay.map((item) => [item.date, item.accepted, item.completed, item.rejected]),
    [],
    ['Every action'],
    ['When', 'What', 'Request', 'Service', 'Where', 'With', 'Minutes', 'On time', 'Reason'],
    ...report.activity.map((item) => [
      formatWhen(item.at),
      activityLabels[item.kind],
      item.publicId,
      item.serviceName,
      item.location,
      item.otherName,
      item.minutes,
      item.onTime === null ? null : item.onTime ? 'yes' : 'no',
      item.reason,
    ]),
  ]);
}

export function downloadText(fileName: string, text: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
