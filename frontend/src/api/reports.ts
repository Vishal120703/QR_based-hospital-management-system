import { call } from './client';
import { type Priority, type PublicRequestStatus } from './types';

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
