// Typed client for the CARE QR backend. All requests go to /api, which the
// dev server (and later the reverse proxy) forwards to the backend.

export class ApiError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

// JSON bodies are serialised; a Blob (for example an image) is sent as is.
async function call<T>(method: Method, path: string, token: string | null, body?: object | Blob) {
  const isFile = body instanceof Blob;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 20_000);
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      signal: controller.signal,
      headers: {
        ...(body ? { 'content-type': isFile ? body.type : 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: isFile ? body : JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      controller.signal.aborted
        ? 'The hospital system took too long to respond. Please try again.'
        : 'Cannot reach the hospital system. Check your connection and try again.',
    );
  } finally {
    window.clearTimeout(timeout);
  }
  const payload: unknown = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const candidate =
      payload && typeof payload === 'object' && 'error' in payload ? payload.error : null;
    const error = candidate && typeof candidate === 'object' ? candidate : {};
    throw new ApiError(
      response.status,
      'code' in error && typeof error.code === 'string' ? error.code : 'UNKNOWN',
      'message' in error && typeof error.message === 'string'
        ? error.message
        : `Request failed (${response.status}).`,
    );
  }
  if (response.status !== 204 && payload === null) {
    throw new ApiError(
      502,
      'INVALID_RESPONSE',
      'The hospital system returned an unreadable response. Please try again.',
    );
  }
  // Response shapes are defined by the backend routes; this is the one place
  // the client trusts them.
  return payload as T;
}

// Credentials. Staff stay signed in across tabs until the 8-hour session ends;
// a guest session lives only in the tab that scanned the QR code.
const staffKey = 'careqr.staffToken';
const platformKey = 'careqr.platformToken';
const guestKey = 'careqr.guestToken';

const memory = new Map<string, string>();
const volatileKeys = new Set<string>();

function read(storage: () => Storage, key: string): string | null {
  if (volatileKeys.has(key)) return memory.get(key) ?? null;
  try {
    return storage().getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}

function write(storage: () => Storage, key: string, value: string | null): void {
  if (value === null) memory.delete(key);
  else memory.set(key, value);
  try {
    if (value === null) storage().removeItem(key);
    else storage().setItem(key, value);
    volatileKeys.delete(key);
  } catch {
    volatileKeys.add(key);
    // Private browsers can block storage. Keep access only in memory until
    // refresh, rather than sending a successful login into a redirect loop.
  }
}

export const credentials = {
  staff: () => read(() => localStorage, staffKey),
  platform: () => read(() => localStorage, platformKey),
  setPlatform: (token: string | null) => write(() => localStorage, platformKey, token),
  setStaff: (token: string | null) => write(() => localStorage, staffKey, token),
  guest: () => read(() => sessionStorage, guestKey),
  setGuest: (token: string | null) => write(() => sessionStorage, guestKey, token),
};

// Shapes returned by the backend.

export interface Me {
  user: { id: string; email: string; displayName: string };
  membershipId: string;
  tenant: { hospitalId: string; code: string; name: string; logoUrl: string | null };
  // Held hospital-wide.
  permissions: string[];
  // Also includes permissions held only for some floors or wards.
  scopedPermissions: string[];
}
export interface Hospital {
  id: string;
  name: string;
  code: string;
  timezone: string;
  logoUrl: string | null;
  logoUpdatedAt: string | null;
}

// Server paths such as a logo URL, as the browser must request them.
export function assetUrl(path: string): string {
  return `/api${path}`;
}

export interface Building {
  id: string;
  code: string;
  name: string;
  active: boolean;
}
export interface Floor extends Building {
  buildingId: string | null;
  // -1 basement, 0 ground, 1 first, ...; null when not set.
  level: number | null;
}
export type WardType =
  | 'GENERAL'
  | 'PRIVATE'
  | 'SEMI_PRIVATE'
  | 'ICU'
  | 'HDU'
  | 'CCU'
  | 'NICU'
  | 'PICU'
  | 'EMERGENCY'
  | 'DAY_CARE'
  | 'MATERNITY'
  | 'LABOUR_ROOM'
  | 'PEDIATRIC'
  | 'ISOLATION'
  | 'BURNS'
  | 'DIALYSIS'
  | 'RECOVERY'
  | 'PSYCHIATRY'
  | 'OTHER';
export type RoomType =
  'GENERAL' | 'PRIVATE' | 'SEMI_PRIVATE' | 'DELUXE' | 'SUITE' | 'ISOLATION' | 'OTHER';
export type BedType =
  | 'STANDARD'
  | 'ICU'
  | 'VENTILATOR'
  | 'ISOLATION'
  | 'PEDIATRIC_COT'
  | 'NEONATAL'
  | 'DAY_CARE_CHAIR'
  | 'DIALYSIS_CHAIR'
  | 'EMERGENCY_TROLLEY'
  | 'LABOUR'
  | 'OTHER';
export interface Ward extends Building {
  floorId: string;
  unitType: WardType;
}
export interface Room extends Building {
  wardId: string;
  roomType: RoomType;
}
export type BedStatus = 'AVAILABLE' | 'OCCUPIED' | 'MAINTENANCE' | 'INACTIVE';
export interface Bed {
  id: string;
  wardId: string;
  roomId: string | null;
  code: string;
  displayName: string;
  bedType: BedType;
  status: BedStatus;
  active: boolean;
}
export type BulkBedsInput =
  | {
      mode: 'BEDS';
      roomId?: string;
      codePrefix: string;
      namePrefix: string;
      start: number;
      count: number;
      bedType: BedType;
    }
  | {
      mode: 'ROOMS';
      roomPrefix: string;
      start: number;
      count: number;
      roomType: RoomType;
      bedsPerRoom: number;
      bedType: BedType;
    };
export interface QrCode {
  id: string;
  bedId: string;
  status: 'ACTIVE' | 'REVOKED';
  version: number;
  issuedAt: string;
}
export interface QrIssue {
  qrCode: QrCode;
  token: string;
  url: string;
}
export interface QrBatch {
  // Sorted by building, floor, unit, room, then bed.
  issues: (QrIssue & { bedId: string; bedName: string; bedCode: string; location: string })[];
  totalBeds: number;
  replaced: number;
  skippedActive: number;
  skippedInactive: number;
}
export type QrBatchScope =
  | { kind: 'HOSPITAL' }
  | { kind: 'BUILDING' | 'FLOOR' | 'WARD' | 'ROOM'; id: string }
  | { kind: 'BEDS'; bedIds: string[] };
export interface BedSession {
  id: string;
  bedId: string;
  status: 'ACTIVE' | 'CLOSED';
  startedAt: string;
  endedAt: string | null;
}
export interface GuestLocation {
  hospitalName: string;
  hospitalLogoUrl: string | null;
  bed: { code: string; displayName: string };
  room: string | null;
  ward: string;
  floor: string;
  expiresAt: string;
}

export interface Department {
  id: string;
  code: string;
  name: string;
  active: boolean;
}
export type MembershipStatus = 'ACTIVE' | 'SUSPENDED' | 'INACTIVE';
export type DutyStatus = 'ON_DUTY' | 'OFF_DUTY';
export interface Coverage {
  id: string;
  scopeType: 'HOSPITAL' | 'FLOOR' | 'WARD';
  floorId: string | null;
  wardId: string | null;
}
export type CoverageInput =
  | { scopeType: 'HOSPITAL' }
  | { scopeType: 'FLOOR'; floorId: string }
  | { scopeType: 'WARD'; wardId: string };
export interface StaffMember {
  id: string;
  email: string;
  displayName: string;
  status: MembershipStatus;
  dutyStatus: DutyStatus;
  dutyChangedAt: string | null;
  departmentIds: string[];
  coverage: Coverage[];
  roleIds: string[];
  // Where each role applies: the hospital, or specific floors, wards, or departments.
  roleAssignments?: { roleId: string; scopes: { type: RoleScopeType; id: string }[] }[];
}
export type RoleScopeLevel = 'HOSPITAL' | 'FLOOR' | 'WARD' | 'DEPARTMENT';
export type RoleScopeType = RoleScopeLevel;
export interface Role {
  id: string;
  name: string;
  active: boolean;
  description?: string | null;
  scopeLevel?: RoleScopeLevel;
  systemKey?: string | null;
  permissionKeys?: string[];
  memberCount?: number;
  builtIn?: boolean;
  // The Hospital Manager role: always every permission, never edited.
  locked?: boolean;
}
export interface RoleInput {
  name?: string;
  description?: string | null;
  scopeLevel?: RoleScopeLevel;
  permissionKeys?: string[];
  active?: boolean;
}
export interface Shift {
  id: string;
  membershipId: string;
  departmentId: string | null;
  startsAt: string;
  endsAt: string;
}
export interface EligibleStaff {
  membershipId: string;
  displayName: string;
  dutyChangedAt: string | null;
}

export interface StaffRequest {
  id: string;
  publicId: string;
  bedId: string;
  bed: { code: string; displayName: string };
  departmentId: string;
  serviceName: string;
  priority: Priority;
  status: PublicRequestStatus;
  assigneeId: string | null;
  assigneeName: string | null;
  submittedAt: string;
  acceptDueAt: string;
  completeDueAt: string;
  completedAt: string | null;
  version: number;
}
export type StaffRequestAction =
  'assign' | 'accept' | 'start' | 'complete' | 'close' | 'cancel' | 'reject' | 'transfer';

export type Priority = 'NORMAL' | 'HIGH' | 'URGENT';
export interface ServiceCategory {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  emergencyNotice: boolean;
  active: boolean;
}
export interface ServiceItem {
  id: string;
  categoryId: string;
  departmentId: string;
  slaPolicyId: string;
  escalationPolicyId: string | null;
  name: string;
  description: string | null;
  priority: Priority;
  sortOrder: number;
  active: boolean;
}
export interface SlaPolicy {
  id: string;
  name: string;
  currentVersion: number;
  acceptMinutes: number;
  completeMinutes: number;
  versions: {
    id: string;
    version: number;
    acceptMinutes: number;
    completeMinutes: number;
    createdAt: string;
  }[];
}
export type EscalationLevelInput =
  | { targetType: 'ASSIGNEE'; afterMinutes: number }
  | { targetType: 'ROLE'; afterMinutes: number; roleId: string };
export interface EscalationPolicy {
  id: string;
  name: string;
  levels: {
    level: number;
    afterMinutes: number;
    targetType: 'ASSIGNEE' | 'ROLE';
    roleId: string | null;
  }[];
}
export interface PublicCategory {
  id: string;
  name: string;
  description: string | null;
  emergencyNotice: boolean;
  services: { id: string; name: string; description: string | null }[];
}
export type PublicRequestStatus =
  | 'SUBMITTED'
  | 'ASSIGNED'
  | 'ACCEPTED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CLOSED'
  | 'CANCELLED'
  | 'REJECTED';
export interface PublicRequest {
  publicId: string;
  serviceId: string;
  serviceName: string;
  status: PublicRequestStatus;
  submittedAt: string;
  // When each later step happened; null until it does.
  assignedAt?: string | null;
  acceptedAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  closedAt?: string | null;
  cancelledAt?: string | null;
  rejectedAt?: string | null;
}

// Each list endpoint returns { <key>: [...] }.
const listKeys = {
  buildings: 'buildings',
  floors: 'floors',
  wards: 'wards',
  rooms: 'rooms',
  beds: 'beds',
  'qr-codes': 'qrCodes',
  'bed-sessions': 'bedSessions',
  departments: 'departments',
  staff: 'staff',
  shifts: 'shifts',
  roles: 'roles',
  'service-categories': 'serviceCategories',
  services: 'services',
  'sla-policies': 'slaPolicies',
  'escalation-policies': 'escalationPolicies',
} as const;
type ListKind = keyof typeof listKeys;

export type LocationKind = 'buildings' | 'floors' | 'wards' | 'rooms' | 'beds';
type StaffResponse = { staff: StaffMember };

export const staffApi = {
  login: (input: { hospitalCode: string; email: string; password: string }) =>
    call<{ token: string; expiresAt: string }>('POST', '/auth/staff/login', null, input),
  me: (token: string) => call<Me>('GET', '/auth/staff/me', token),
  hospital: async (token: string) =>
    (await call<{ hospital: Hospital }>('GET', '/admin/hospital', token)).hospital,
  updateHospital: async (token: string, input: { name?: string; timezone?: string }) =>
    (await call<{ hospital: Hospital }>('PATCH', '/admin/hospital', token, input)).hospital,
  uploadLogo: (token: string, image: Blob) =>
    call<{ logoUrl: string }>('PUT', '/admin/hospital/logo', token, image),
  removeLogo: (token: string) => call<null>('DELETE', '/admin/hospital/logo', token),
  logout: (token: string) => call<null>('POST', '/auth/staff/logout', token),

  async list<T>(token: string, kind: ListKind, query = '') {
    const body = await call<Record<string, T[]>>('GET', `/admin/${kind}${query}`, token);
    return body[listKeys[kind]] ?? [];
  },
  create: (token: string, kind: LocationKind | 'departments', input: object) =>
    call<unknown>('POST', `/admin/${kind}`, token, input),
  updateLocation: (token: string, kind: LocationKind, id: string, input: object) =>
    call<unknown>('PATCH', `/admin/${kind}/${id}`, token, input),
  deleteLocation: (token: string, kind: LocationKind, id: string) =>
    call<null>('DELETE', `/admin/${kind}/${id}`, token),
  bulkBeds: (token: string, wardId: string, input: BulkBedsInput) =>
    call<{ rooms: Room[]; beds: Bed[] }>('POST', `/admin/wards/${wardId}/bulk-beds`, token, input),
  updateDepartment: (token: string, id: string, input: Partial<Department>) =>
    call<{ department: Department }>('PATCH', `/admin/departments/${id}`, token, input),

  createCategory: (
    token: string,
    input: { name: string; emergencyNotice: boolean; sortOrder?: number },
  ) => call<unknown>('POST', '/admin/service-categories', token, input),
  updateCategory: (token: string, id: string, input: Partial<Omit<ServiceCategory, 'id'>>) =>
    call<unknown>('PATCH', `/admin/service-categories/${id}`, token, input),
  createService: (
    token: string,
    input: {
      categoryId: string;
      departmentId: string;
      slaPolicyId: string;
      escalationPolicyId?: string;
      name: string;
      priority: Priority;
    },
  ) => call<unknown>('POST', '/admin/services', token, input),
  updateService: (token: string, id: string, input: Partial<Omit<ServiceItem, 'id'>>) =>
    call<unknown>('PATCH', `/admin/services/${id}`, token, input),
  createSlaPolicy: (
    token: string,
    input: { name: string; acceptMinutes: number; completeMinutes: number },
  ) => call<unknown>('POST', '/admin/sla-policies', token, input),
  updateSlaPolicy: (
    token: string,
    id: string,
    input: { acceptMinutes: number; completeMinutes: number },
  ) => call<{ slaPolicy: SlaPolicy }>('PATCH', `/admin/sla-policies/${id}`, token, input),
  getSlaPolicy: async (token: string, id: string) =>
    (await call<{ slaPolicy: SlaPolicy }>('GET', `/admin/sla-policies/${id}`, token)).slaPolicy,
  createEscalationPolicy: (
    token: string,
    input: { name: string; levels: EscalationLevelInput[] },
  ) => call<unknown>('POST', '/admin/escalation-policies', token, input),
  deleteEscalationPolicy: (token: string, id: string) =>
    call<null>('DELETE', `/admin/escalation-policies/${id}`, token),

  createStaff: (token: string, input: { email: string; displayName: string; password: string }) =>
    call<StaffResponse>('POST', '/admin/staff', token, input),
  setStaffStatus: (token: string, id: string, status: MembershipStatus) =>
    call<StaffResponse>('POST', `/admin/staff/${id}/status`, token, { status }),
  setDuty: (token: string, id: string, dutyStatus: DutyStatus) =>
    call<StaffResponse>('POST', `/admin/staff/${id}/duty`, token, { dutyStatus }),
  addDepartment: (token: string, id: string, departmentId: string) =>
    call<StaffResponse>('POST', `/admin/staff/${id}/departments`, token, { departmentId }),
  removeDepartment: (token: string, id: string, departmentId: string) =>
    call<StaffResponse>('DELETE', `/admin/staff/${id}/departments/${departmentId}`, token),
  addCoverage: (token: string, id: string, input: CoverageInput) =>
    call<StaffResponse>('POST', `/admin/staff/${id}/coverage`, token, input),
  removeCoverage: (token: string, id: string, coverageId: string) =>
    call<StaffResponse>('DELETE', `/admin/staff/${id}/coverage/${coverageId}`, token),
  assignRole: (token: string, id: string, roleId: string, scopeId?: string) =>
    call<unknown>('POST', `/admin/memberships/${id}/roles`, token, {
      roleId,
      ...(scopeId ? { scopeId } : {}),
    }),
  // Without scopeId the role is removed everywhere; with it, for that place only.
  removeRole: (token: string, id: string, roleId: string, scopeId?: string) =>
    call<null>(
      'DELETE',
      `/admin/memberships/${id}/roles/${roleId}${scopeId ? `/scopes/${scopeId}` : ''}`,
      token,
    ),
  roles: async (token: string) =>
    (await call<{ roles: Role[] }>('GET', '/admin/roles', token)).roles,
  createRole: async (token: string, input: RoleInput & { name: string }) =>
    (await call<{ role: Role }>('POST', '/admin/roles', token, input)).role,
  updateRole: async (token: string, id: string, input: RoleInput) =>
    (await call<{ role: Role }>('PATCH', `/admin/roles/${id}`, token, input)).role,
  deleteRole: (token: string, id: string) => call<null>('DELETE', `/admin/roles/${id}`, token),
  createShift: (
    token: string,
    input: { membershipId: string; departmentId?: string; startsAt: string; endsAt: string },
  ) => call<{ shift: Shift }>('POST', '/admin/shifts', token, input),
  deleteShift: (token: string, id: string) => call<null>('DELETE', `/admin/shifts/${id}`, token),
  eligible: async (token: string, bedId: string, departmentId: string) =>
    (
      await call<{ staff: EligibleStaff[] }>(
        'GET',
        `/admin/staff/eligible?bedId=${bedId}&departmentId=${departmentId}`,
        token,
      )
    ).staff,
  requests: async (token: string) =>
    (await call<{ serviceRequests: StaffRequest[] }>('GET', '/admin/requests', token))
      .serviceRequests,
  requestAction: async (
    token: string,
    id: string,
    action: StaffRequestAction,
    input: { expectedVersion: number; assigneeId?: string; reason?: string },
  ) =>
    (
      await call<{ serviceRequest: StaffRequest }>(
        'POST',
        `/admin/requests/${id}/${action}`,
        token,
        input,
      )
    ).serviceRequest,

  generateQr: (token: string, bedId: string) =>
    call<QrIssue>('POST', `/admin/beds/${bedId}/qr`, token, {}),
  generateQrBatch: (token: string, scope: QrBatchScope, replaceExisting = false) =>
    call<QrBatch>('POST', '/admin/qr-codes/batch', token, { scope, replaceExisting }),
  rotateQr: (token: string, bedId: string) =>
    call<QrIssue>('POST', `/admin/beds/${bedId}/qr/rotate`, token, {}),
  revokeQr: (token: string, bedId: string) =>
    call<{ qrCode: QrCode }>('POST', `/admin/beds/${bedId}/qr/revoke`, token, {}),

  startSession: (token: string, bedId: string) =>
    call<{ bedSession: BedSession }>('POST', '/admin/bed-sessions', token, { bedId }),
  closeSession: (token: string, sessionId: string) =>
    call<{ bedSession: BedSession }>('POST', `/admin/bed-sessions/${sessionId}/close`, token, {}),
};

export const guestApi = {
  resolve: (qrToken: string) =>
    call<{ guestToken: string; expiresAt: string; location: GuestLocation }>(
      'POST',
      '/public/qr/resolve',
      null,
      { token: qrToken },
    ),
  session: (guestToken: string) =>
    call<{ location: GuestLocation }>('GET', '/public/session', guestToken),
  services: async (guestToken: string) =>
    (await call<{ categories: PublicCategory[] }>('GET', '/public/services', guestToken))
      .categories,
  requests: async (guestToken: string) =>
    (await call<{ serviceRequests: PublicRequest[] }>('GET', '/public/requests', guestToken))
      .serviceRequests,
  submitRequest: async (guestToken: string, serviceId: string) =>
    (
      await call<{ serviceRequest: PublicRequest }>('POST', '/public/requests', guestToken, {
        serviceId,
      })
    ).serviceRequest,
  cancelRequest: async (guestToken: string, publicId: string, reason: string) =>
    (
      await call<{ serviceRequest: PublicRequest }>(
        'POST',
        `/public/requests/${encodeURIComponent(publicId)}/cancel`,
        guestToken,
        { reason },
      )
    ).serviceRequest,
};

// SaaS platform administration (super admin), separate from hospital staff.
export interface PlatformHospital {
  id: string;
  name: string;
  code: string;
  timezone: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'INACTIVE';
  createdAt: string;
  logoUrl: string | null;
  activeBeds?: number;
  activeStaff?: number;
  openRequests?: number;
  managers?: { membershipId: string; status: string; email: string; displayName: string }[];
}
export interface NewHospitalInput {
  name: string;
  code: string;
  timezone: string;
  managerName: string;
  managerEmail: string;
  managerPassword: string;
}

export const platformApi = {
  login: (input: { email: string; password: string }) =>
    call<{ token: string; expiresAt: string }>('POST', '/auth/platform/login', null, input),
  me: (token: string) =>
    call<{ user: { id: string; email: string; displayName: string } }>(
      'GET',
      '/auth/platform/me',
      token,
    ),
  logout: (token: string) => call<null>('POST', '/auth/platform/logout', token),
  hospitals: async (token: string) =>
    (await call<{ hospitals: PlatformHospital[] }>('GET', '/platform/hospitals', token)).hospitals,
  hospital: async (token: string, id: string) =>
    (await call<{ hospital: PlatformHospital }>('GET', `/platform/hospitals/${id}`, token))
      .hospital,
  createHospital: async (token: string, input: NewHospitalInput) =>
    (await call<{ hospital: PlatformHospital }>('POST', '/platform/hospitals', token, input))
      .hospital,
  updateHospital: async (
    token: string,
    id: string,
    input: { name?: string; timezone?: string; status?: 'ACTIVE' | 'SUSPENDED' },
  ) =>
    (await call<{ hospital: PlatformHospital }>('PATCH', `/platform/hospitals/${id}`, token, input))
      .hospital,
  uploadLogo: (token: string, id: string, image: Blob) =>
    call<{ logoUrl: string }>('PUT', `/platform/hospitals/${id}/logo`, token, image),
  removeLogo: (token: string, id: string) =>
    call<null>('DELETE', `/platform/hospitals/${id}/logo`, token),
  addManager: async (
    token: string,
    id: string,
    input: { displayName: string; email: string; password: string },
  ) =>
    (
      await call<{ hospital: PlatformHospital }>(
        'POST',
        `/platform/hospitals/${id}/managers`,
        token,
        input,
      )
    ).hospital,
};

// Reports and audit (who did what, on time or not, and why not).
export interface StaffWork {
  membershipId: string;
  name: string;
  assigned: number;
  accepted: number;
  completed: number;
  completedOnTime: number;
  completedOnTimePercent: number | null;
  rejected: number;
  rejectReasons: string[];
  transferredAway: number;
  openNow: number;
  assignmentsMade: number;
  closed: number;
  cancelled: number;
  averageMinutesToAccept: number | null;
  averageMinutesOfWork: number | null;
}
export interface ReportGroup {
  id: string;
  name: string;
  total: number;
  completed: number;
  open: number;
  cancelled: number;
  rejected: number;
  overdue: number;
  averageMinutesToComplete: number | null;
}
export type ReportOutcome = 'open' | 'completed' | 'cancelled' | 'rejected' | 'overdue';
export interface RequestReport {
  range: { from: string; to: string };
  truncated: boolean;
  summary: {
    total: number;
    open: number;
    completed: number;
    cancelled: number;
    cancelledByPatient: number;
    rejected: number;
    overdueOpen: number;
    acceptedOnTimePercent: number | null;
    completedOnTimePercent: number | null;
    averageMinutesToAccept: number | null;
    averageMinutesToComplete: number | null;
  };
  byDepartment: ReportGroup[];
  byService: ReportGroup[];
  byStaff: StaffWork[];
  notCompleted: {
    id: string;
    publicId: string;
    serviceName: string;
    location: string;
    status: PublicRequestStatus;
    outcome: ReportOutcome;
    submittedAt: string;
    endedAt: string | null;
    endedBy: string | null;
    reason: string | null;
    assigneeName: string | null;
    overdueMinutes: number | null;
  }[];
}
export interface RequestLogRow {
  id: string;
  publicId: string;
  serviceName: string;
  departmentId: string;
  departmentName: string;
  priority: Priority;
  location: string;
  bedName: string;
  status: PublicRequestStatus;
  outcome: Exclude<ReportOutcome, 'overdue'>;
  submittedAt: string;
  acceptDueAt: string;
  completeDueAt: string;
  assigneeName: string | null;
  assignedBy: string | null;
  acceptedBy: string | null;
  acceptedAt: string | null;
  completedBy: string | null;
  completedAt: string | null;
  closedBy: string | null;
  closedAt: string | null;
  endedBy: string | null;
  endedAt: string | null;
  endReason: string | null;
  acceptedOnTime: boolean | null;
  completedOnTime: boolean | null;
  overdueMinutes: number | null;
  minutesToAccept: number | null;
  minutesToComplete: number | null;
}
export interface RequestTimeline extends RequestLogRow {
  events: {
    type: string;
    at: string;
    actor: { type: 'GUEST' | 'STAFF' | 'SYSTEM'; membershipId: string | null; name: string };
    reason: string | null;
    assigneeName: string | null;
    previousAssigneeName: string | null;
  }[];
}
export interface AuditEntry {
  id: string;
  createdAt: string;
  action: string;
  actorType: 'SYSTEM' | 'STAFF' | 'PLATFORM';
  actorName: string;
  targetType: string;
  targetId: string;
  targetName: string | null;
  metadata: unknown;
}

function query(params: Record<string, string | undefined>): string {
  const entries = Object.entries(params).filter((entry): entry is [string, string] =>
    Boolean(entry[1]),
  );
  return entries.length ? `?${new URLSearchParams(entries).toString()}` : '';
}

export const reportApi = {
  requests: (token: string, range: { from: string; to: string }) =>
    call<RequestReport>('GET', `/admin/reports/requests${query(range)}`, token),
  log: (
    token: string,
    params: {
      from: string;
      to: string;
      outcome?: ReportOutcome | undefined;
      departmentId?: string | undefined;
      membershipId?: string | undefined;
      search?: string | undefined;
    },
  ) =>
    call<{ truncated: boolean; requests: RequestLogRow[] }>(
      'GET',
      `/admin/reports/requests/log${query(params)}`,
      token,
    ),
  timeline: async (token: string, id: string) =>
    (await call<{ request: RequestTimeline }>('GET', `/admin/reports/requests/${id}`, token))
      .request,
  audit: (
    token: string,
    params: {
      from?: string | undefined;
      to?: string | undefined;
      category?: string | undefined;
      before?: string | undefined;
      limit?: string | undefined;
    },
  ) =>
    call<{ entries: AuditEntry[]; nextBefore: string | null }>(
      'GET',
      `/admin/audit-log${query(params)}`,
      token,
    ),
};
