import { call } from './client';
import {
  type Bed,
  type BedSession,
  type BulkBedsInput,
  type CoverageInput,
  type Department,
  type DutyStatus,
  type EligibleStaff,
  type EscalationLevelInput,
  type Hospital,
  type Me,
  type MembershipStatus,
  type Priority,
  type QrBatch,
  type QrBatchScope,
  type QrCode,
  type QrIssue,
  type Role,
  type RoleInput,
  type Room,
  type ServiceCategory,
  type ServiceItem,
  type Shift,
  type SlaPolicy,
  type StaffMember,
  type StaffRequest,
  type StaffRequestAction,
} from './types';

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
