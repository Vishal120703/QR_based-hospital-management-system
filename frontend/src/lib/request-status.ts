import { useEffect, useState } from 'react';
import type { PublicRequestStatus, StaffRequest } from '../api';

export const openStatuses: PublicRequestStatus[] = [
  'SUBMITTED',
  'ASSIGNED',
  'ACCEPTED',
  'IN_PROGRESS',
];
export const finishedStatuses: PublicRequestStatus[] = ['CLOSED', 'CANCELLED', 'REJECTED'];

export const statusLabels: Record<PublicRequestStatus, string> = {
  SUBMITTED: 'Waiting for assignment',
  ASSIGNED: 'Assigned',
  ACCEPTED: 'Accepted',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
  REJECTED: 'Rejected',
};

export function statusBadgeClass(status: PublicRequestStatus): string {
  if (status === 'SUBMITTED') return 'badge badge-maintenance';
  if (status === 'COMPLETED' || status === 'CLOSED') return 'badge badge-available';
  if (status === 'CANCELLED' || status === 'REJECTED') return 'badge';
  return 'badge badge-occupied';
}

// The response-time target that applies right now: accept until someone
// accepts, then complete. Finished requests have none.
export function currentDeadline(
  request: StaffRequest,
): { label: 'Accept' | 'Complete'; dueAt: number } | null {
  if (request.status === 'SUBMITTED' || request.status === 'ASSIGNED') {
    return { label: 'Accept', dueAt: Date.parse(request.acceptDueAt) };
  }
  if (request.status === 'ACCEPTED' || request.status === 'IN_PROGRESS') {
    return { label: 'Complete', dueAt: Date.parse(request.completeDueAt) };
  }
  return null;
}

export function isOverdue(request: StaffRequest, now: number): boolean {
  const deadline = currentDeadline(request);
  return deadline !== null && !Number.isNaN(deadline.dueAt) && deadline.dueAt < now;
}

// "45 sec", "12 min", "2 h 5 min".
export function formatDuration(milliseconds: number): string {
  const minutes = Math.floor(Math.abs(milliseconds) / 60_000);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

export function timeAgo(value: string, now: number): string {
  const time = Date.parse(value);
  if (Number.isNaN(time)) return '—';
  const elapsed = now - time;
  return elapsed < 60_000 ? 'just now' : `${formatDuration(elapsed)} ago`;
}

export function clockTime(value: number | string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function isToday(value: string | null, now: number): boolean {
  if (!value) return false;
  return new Date(value).toDateString() === new Date(now).toDateString();
}

// Re-renders every interval so relative times ("3 min ago") stay current.
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

// Calls `refresh` every interval while the tab is visible, and right away
// when the tab becomes visible again.
export function useAutoRefresh(refresh: () => void, intervalMs: number): void {
  useEffect(() => {
    const whenVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const timer = window.setInterval(whenVisible, intervalMs);
    document.addEventListener('visibilitychange', whenVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', whenVisible);
    };
  }, [refresh, intervalMs]);
}
