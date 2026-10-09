import { type Prisma } from '@prisma/client';

// Kinds of things an audit entry can point at, so the log can name them.
export type NamedKind =
  | 'membership'
  | 'user'
  | 'role'
  | 'department'
  | 'building'
  | 'floor'
  | 'ward'
  | 'room'
  | 'bed'
  | 'category'
  | 'service'
  | 'sla'
  | 'escalation'
  | 'request'
  | 'bedSession'
  | 'qr'
  | 'hospital';

// The audit target types (Prisma model names) the log can name.
export const targetKinds: Readonly<Record<string, NamedKind>> = {
  HospitalMembership: 'membership',
  Role: 'role',
  Department: 'department',
  Building: 'building',
  Floor: 'floor',
  Ward: 'ward',
  Room: 'room',
  Bed: 'bed',
  ServiceCategory: 'category',
  ServiceItem: 'service',
  SlaPolicy: 'sla',
  EscalationPolicy: 'escalation',
  ServiceRequest: 'request',
  BedSession: 'bedSession',
  BedQrCode: 'qr',
  Hospital: 'hospital',
};

// Metadata keys that hold the id of something with a name.
const referenceKeys: Readonly<Record<string, NamedKind>> = {
  assigneeId: 'membership',
  previousAssigneeId: 'membership',
  membershipId: 'membership',
  roleId: 'role',
  departmentId: 'department',
  buildingId: 'building',
  floorId: 'floor',
  wardId: 'ward',
  roomId: 'room',
  bedId: 'bed',
  categoryId: 'category',
  serviceId: 'service',
  slaPolicyId: 'sla',
  escalationPolicyId: 'escalation',
};
const scopeKinds: Readonly<Record<string, NamedKind>> = {
  HOSPITAL: 'hospital',
  FLOOR: 'floor',
  WARD: 'ward',
  DEPARTMENT: 'department',
};

const labels: Readonly<Record<string, string>> = {
  name: 'Name',
  displayName: 'Name',
  code: 'Code',
  email: 'Email',
  active: 'Active',
  status: 'Status',
  dutyStatus: 'Duty',
  unitType: 'Unit type',
  roomType: 'Room type',
  bedType: 'Bed type',
  level: 'Level',
  description: 'Description',
  priority: 'Priority',
  sortOrder: 'Order',
  emergencyNotice: 'Emergency notice',
  acceptMinutes: 'Accept within (minutes)',
  completeMinutes: 'Complete within (minutes)',
  version: 'Version',
  levels: 'Escalation levels',
  scopeLevel: 'Applies to',
  permissionKeys: 'Permissions',
  timezone: 'Time zone',
  contactName: 'Contact person',
  contactEmail: 'Contact email',
  contactPhone: 'Contact phone',
  managerEmail: 'Manager email',
  reason: 'Reason',
  bedCodes: 'Beds',
  roomCodes: 'Rooms',
  revokedGuestSessions: 'Patient sessions ended',
  revokedSessions: 'Staff sessions ended',
  dataset: 'Data set',
  assigneeId: 'Assigned to',
  membershipId: 'Person',
  roleId: 'Role',
  departmentId: 'Department',
  buildingId: 'Building',
  floorId: 'Floor',
  wardId: 'Unit',
  roomId: 'Room',
  bedId: 'Bed',
  categoryId: 'Category',
  serviceId: 'Service',
  slaPolicyId: 'Response target',
  escalationPolicyId: 'Escalation',
};

// Stored codes such as ON_DUTY or IN_PROGRESS, shown as "on duty". Everything
// else (codes like "GW-A", names, reasons) is shown exactly as typed.
const enumKeys = new Set([
  'status',
  'dutyStatus',
  'unitType',
  'roomType',
  'bedType',
  'priority',
  'scopeLevel',
]);

// Never shown: internal ids and bookkeeping.
const hiddenKeys = new Set([
  'id',
  'hospitalId',
  'userId',
  'adminUserId',
  'createdAt',
  'updatedAt',
  'requestId',
  'mode',
  'byteSize',
  'contentType',
]);
// Read together with their partner key instead of on their own.
const pairedKeys = new Set([
  'before',
  'after',
  'from',
  'to',
  'previousStatus',
  'previousAssigneeId',
  'fromVersion',
  'toVersion',
  'scopeId',
  'scopeType',
]);

export interface AuditDetail {
  readonly label: string;
  readonly value: string;
}
export interface AuditChange {
  readonly field: string;
  readonly before: string;
  readonly after: string;
}

export type NameLookup = (kind: NamedKind, id: string) => string | null;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

// Every named thing an entry's metadata points at, to look up in one go.
export function referencesIn(metadata: Prisma.JsonValue): { kind: NamedKind; id: string }[] {
  const top = asRecord(metadata);
  const found: { kind: NamedKind; id: string }[] = [];
  for (const source of [top, asRecord(top?.before), asRecord(top?.after)]) {
    for (const [key, value] of Object.entries(source ?? {})) {
      const kind = key === 'previousAssigneeId' ? 'membership' : referenceKeys[key];
      if (kind && typeof value === 'string') found.push({ kind, id: value });
    }
  }
  const scopeKind = typeof top?.scopeType === 'string' ? scopeKinds[top.scopeType] : undefined;
  if (scopeKind && typeof top?.scopeId === 'string') {
    found.push({ kind: scopeKind, id: top.scopeId });
  }
  return found;
}

function label(key: string): string {
  if (labels[key]) return labels[key];
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// One value as a person reads it, or null when it should not be shown.
function show(key: string, value: unknown, nameOf: NameLookup): string | null {
  if (value === null || value === undefined || value === '') return '—';
  const kind = referenceKeys[key];
  if (kind) return typeof value === 'string' ? (nameOf(kind, value) ?? 'a removed item') : null;
  if (key.endsWith('Id') || key.endsWith('Ids')) return null;
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    if (enumKeys.has(key)) return value.toLowerCase().replace(/_/g, ' ');
    return value.length > 160 ? `${value.slice(0, 157)}…` : value;
  }
  if (Array.isArray(value)) {
    if (key === 'permissionKeys') return `${value.length}`;
    const texts = value.filter((item): item is string => typeof item === 'string');
    if (texts.length !== value.length) return `${value.length}`;
    return texts.length <= 4
      ? texts.join(', ') || '—'
      : `${texts.length}: ${texts.slice(0, 3).join(', ')}, …`;
  }
  return null;
}

function detailsFrom(source: Record<string, unknown>, nameOf: NameLookup): AuditDetail[] {
  const details: AuditDetail[] = [];
  for (const [key, value] of Object.entries(source)) {
    if (hiddenKeys.has(key) || pairedKeys.has(key)) continue;
    const text = show(key, value, nameOf);
    if (text !== null && text !== '—') details.push({ label: label(key), value: text });
  }
  return details;
}

function change(field: string, before: string | null, after: string | null): AuditChange[] {
  return before === after ? [] : [{ field, before: before ?? '—', after: after ?? '—' }];
}

// What an audit entry did, in plain words: the fields that changed (before →
// after) and the other facts recorded with it, with names instead of ids.
export function describeAuditEntry(
  action: string,
  metadata: Prisma.JsonValue,
  nameOf: NameLookup,
): { details: AuditDetail[]; changes: AuditChange[] } {
  const top = asRecord(metadata) ?? {};
  const before = asRecord(top.before);
  const after = asRecord(top.after);
  const changes: AuditChange[] = [];
  const details: AuditDetail[] = [];

  if (before && after) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
    for (const key of keys) {
      if (hiddenKeys.has(key) || JSON.stringify(before[key]) === JSON.stringify(after[key])) {
        continue;
      }
      if (key === 'permissionKeys') {
        const was = Array.isArray(before[key]) ? before[key] : [];
        const now = Array.isArray(after[key]) ? after[key] : [];
        const added = now.filter((item) => !was.includes(item)).length;
        const removed = was.filter((item) => !now.includes(item)).length;
        changes.push({
          field: 'Permissions',
          before: `${was.length}`,
          after: `${now.length} (${added} added, ${removed} removed)`,
        });
        continue;
      }
      const was = show(key, before[key], nameOf);
      const now = show(key, after[key], nameOf);
      if (was !== null && now !== null) changes.push(...change(label(key), was, now));
    }
  } else if (after || before) {
    // Something added (only "after") or removed (only "before").
    details.push(...detailsFrom((after ?? before)!, nameOf));
  }

  if (typeof top.from === 'string' || typeof top.to === 'string') {
    const field = action === 'staff.duty' ? 'Duty' : 'Status';
    changes.push(
      ...change(field, show('status', top.from, nameOf), show('status', top.to, nameOf)),
    );
  }
  if (typeof top.previousStatus === 'string') {
    changes.push(
      ...change(
        'Status',
        show('status', top.previousStatus, nameOf),
        show('status', top.status, nameOf),
      ),
    );
  }
  if (typeof top.previousAssigneeId === 'string') {
    changes.push(
      ...change(
        'Assigned to',
        show('assigneeId', top.previousAssigneeId, nameOf),
        show('assigneeId', top.assigneeId, nameOf),
      ),
    );
  }
  if (typeof top.fromVersion === 'number' && typeof top.toVersion === 'number') {
    changes.push(...change('QR version', String(top.fromVersion), String(top.toVersion)));
  }
  const handled = new Set(['status', 'assigneeId']);
  const rest = Object.fromEntries(
    Object.entries(top).filter(
      ([key]) =>
        !handled.has(key) ||
        (key === 'assigneeId' && typeof top.previousAssigneeId !== 'string') ||
        (key === 'status' && typeof top.previousStatus !== 'string'),
    ),
  );
  details.push(...detailsFrom(rest, nameOf));

  if (typeof top.scopeType === 'string') {
    const kind = scopeKinds[top.scopeType];
    const where =
      top.scopeType === 'HOSPITAL'
        ? 'Whole hospital'
        : kind && typeof top.scopeId === 'string'
          ? nameOf(kind, top.scopeId)
          : null;
    if (where) details.push({ label: 'Where', value: where });
  }
  return { details, changes };
}
