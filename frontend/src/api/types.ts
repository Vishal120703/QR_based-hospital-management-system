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
  | 'ISOLATION'
  | 'PEDIATRIC_COT'
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
