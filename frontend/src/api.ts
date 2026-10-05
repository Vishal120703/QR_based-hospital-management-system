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

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

async function call<T>(method: Method, path: string, token: string | null, body?: object) {
  const response = await fetch(`/api${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload: unknown = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error =
      payload && typeof payload === 'object' && 'error' in payload
        ? (payload.error as { code?: string; message?: string })
        : {};
    throw new ApiError(
      response.status,
      error.code ?? 'UNKNOWN',
      error.message ?? `Request failed (${response.status}).`,
    );
  }
  // Response shapes are defined by the backend routes; this is the one place
  // the client trusts them.
  return payload as T;
}

// Credentials. Staff stay signed in across tabs until the 8-hour session ends;
// a guest session lives only in the tab that scanned the QR code.
const staffKey = 'careqr.staffToken';
const guestKey = 'careqr.guestToken';

function read(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function write(storage: Storage, key: string, value: string | null): void {
  try {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private mode); the user signs in again.
  }
}

export const credentials = {
  staff: () => read(localStorage, staffKey),
  setStaff: (token: string | null) => write(localStorage, staffKey, token),
  guest: () => read(sessionStorage, guestKey),
  setGuest: (token: string | null) => write(sessionStorage, guestKey, token),
};

// Shapes returned by the backend.

export interface Me {
  user: { id: string; email: string; displayName: string };
  membershipId: string;
  tenant: { hospitalId: string; code: string; name: string };
  permissions: string[];
}
export interface Building {
  id: string;
  code: string;
  name: string;
  active: boolean;
}
export interface Floor extends Building {
  buildingId: string | null;
}
export interface Ward extends Building {
  floorId: string;
}
export interface Room extends Building {
  wardId: string;
}
export type BedStatus = 'AVAILABLE' | 'OCCUPIED' | 'MAINTENANCE' | 'INACTIVE';
export interface Bed {
  id: string;
  wardId: string;
  roomId: string | null;
  code: string;
  displayName: string;
  status: BedStatus;
  active: boolean;
}
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
export interface BedSession {
  id: string;
  bedId: string;
  status: 'ACTIVE' | 'CLOSED';
  startedAt: string;
  endedAt: string | null;
}
export interface GuestLocation {
  hospitalName: string;
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
}
export interface Role {
  id: string;
  name: string;
  active: boolean;
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
  logout: (token: string) => call<null>('POST', '/auth/staff/logout', token),

  async list<T>(token: string, kind: ListKind, query = '') {
    const body = await call<Record<string, T[]>>('GET', `/admin/${kind}${query}`, token);
    return body[listKeys[kind]] ?? [];
  },
  create: (token: string, kind: LocationKind | 'departments', input: object) =>
    call<unknown>('POST', `/admin/${kind}`, token, input),
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
  assignRole: (token: string, id: string, roleId: string) =>
    call<unknown>('POST', `/admin/memberships/${id}/roles`, token, { roleId }),
  removeRole: (token: string, id: string, roleId: string) =>
    call<null>('DELETE', `/admin/memberships/${id}/roles/${roleId}`, token),
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

  generateQr: (token: string, bedId: string) =>
    call<QrIssue>('POST', `/admin/beds/${bedId}/qr`, token, {}),
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
};
