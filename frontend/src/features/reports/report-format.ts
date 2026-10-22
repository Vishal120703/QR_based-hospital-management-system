import type { AuditEntry, ReportOutcome, RequestLogRow, RequestReport } from '../../api';
import { dayIn, dayLabel } from '../../lib/hospital-time';

// The signed-in hospital, for report headings and its time zone.
export interface HospitalInfo {
  name: string;
  timezone: string;
}

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

// A moment in words; on reports, in the hospital's time zone.
export function formatWhen(value: string | null, timeZone?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone });
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
  'staff.password.change': 'Changed their own password',
  'staff.password.reset': 'Reset a staff password',
  'hospital.logo.update': 'Changed the hospital logo',
  'hospital.logo.remove': 'Removed the hospital logo',
  'hospital.bedOccupancy.enable': 'Turned on admissions (bed occupancy management)',
  'hospital.bedOccupancy.disable': 'Switched to QR codes only (no admissions)',
  'hospital.settings.update': 'Changed hospital settings',
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
  'qr.print': 'Viewed a QR code for printing',
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
export function auditCsv(entries: readonly AuditEntry[], timeZone: string): string {
  return toCsv([
    ['When', 'Who', 'What happened', 'Item', 'What changed', 'Details'],
    ...entries.map((entry) => [
      formatWhen(entry.createdAt, timeZone),
      entry.actorName,
      actionLabel(entry.action),
      entry.targetName,
      entry.changes.map((item) => `${item.field}: ${item.before} → ${item.after}`).join('; '),
      entry.details.map((item) => `${item.label}: ${item.value}`).join('; '),
    ]),
  ]);
}

// File name for a report download: the chosen hospital days, both included.
export function reportFileName(kind: string, days: { from: string; to: string }): string {
  return `care-qr-${kind}-${days.from}-to-${days.to}.csv`;
}

// The period a report covers, in words, as hospital days. The server's "to"
// is exclusive (the next midnight, or now), so the last day ends just before.
export function periodLabel(range: { from: string; to: string }, timeZone: string): string {
  const last = new Date(new Date(range.to).getTime() - 1);
  return `${dayLabel(dayIn(range.from, timeZone))} – ${dayLabel(dayIn(last, timeZone))}`;
}

// Spreadsheet cells: minutes and percentages as plain numbers, so Excel can
// sort, total, and chart them; the unit is in the column heading.
const minutesCell = (value: number | null) => (value === null ? null : Math.round(value));
const percentCell = (value: number | null) => value;

// The whole report in one spreadsheet: totals, staff work, departments,
// services, and the requests that were not completed.
export function reportCsv(report: RequestReport, hospital: HospitalInfo): string {
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
    ['Hospital', hospital.name],
    ['Period', periodLabel(report.range, hospital.timezone)],
    ['Downloaded', formatWhen(new Date().toISOString(), hospital.timezone)],
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
      formatWhen(item.submittedAt, hospital.timezone),
      item.endedBy ?? item.assigneeName,
      item.reason,
      minutesCell(item.overdueMinutes),
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
