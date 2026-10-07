import type { ReportOutcome, RequestLogRow } from './api';

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
    // A leading = + - @ would run as a spreadsheet formula.
    const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
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
