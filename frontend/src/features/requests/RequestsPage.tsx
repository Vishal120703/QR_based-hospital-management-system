import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  ApiError,
  staffApi,
  type EligibleStaff,
  type StaffRequest,
  type StaffRequestAction,
} from '../../api';
import { LoadState, PageHeading } from '../../components';
import { clockTime, useAutoRefresh, useNow } from '../../lib/request-status';
import { useAdmin } from '../workspace/AdminLayout';
import { AlertSettings } from './AlertSettings';
import { RequestCard } from './RequestCard';
import { cancelReasons, ReasonDialog, rejectReasons, TransferDialog } from './RequestDialogs';
import { RequestTimelineDialog } from './RequestTimelineDialog';
import { pageSize, useRequestQueue, type OpenFilter, type Tab } from './use-request-queue';

const successMessages: Record<StaffRequestAction, string> = {
  assign: 'Request assigned.',
  accept: 'Request accepted. Start work when you reach the bed.',
  start: 'Work started. Mark it complete when finished.',
  complete: 'Request completed.',
  close: 'Request closed.',
  cancel: 'Request cancelled.',
  reject: 'Request turned down. The reason is kept in its history.',
  transfer: 'Request handed over.',
};

export function RequestsPage() {
  const [params, setParams] = useSearchParams();
  const selected = params.get('request');
  const { token, me, can, canAnywhere, reportError, reportSuccess } = useAdmin();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('open');
  const [filter, setFilter] = useState<OpenFilter>('all');
  const [candidates, setCandidates] = useState<Record<string, EligibleStaff[]>>({});
  const [assignees, setAssignees] = useState<Record<string, string>>({});
  const [cancelTarget, setCancelTarget] = useState<StaffRequest | null>(null);
  const [rejectTarget, setRejectTarget] = useState<StaffRequest | null>(null);
  const [transferTarget, setTransferTarget] = useState<StaffRequest | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const now = useNow();
  const { queue, error, updatedAt, page, setPage, refresh } = useRequestQueue(
    token,
    { tab, filter, selected },
    reportError,
  );
  // New patient requests appear without a manual refresh.
  useAutoRefresh(
    useCallback(() => {
      if (!busyId) void refresh();
    }, [busyId, refresh]),
    15_000,
  );

  async function showCandidates(request: StaffRequest) {
    setBusyId(request.id);
    try {
      const staff = await staffApi.eligible(token, request.bedId, request.departmentId);
      setCandidates((current) => ({ ...current, [request.id]: staff }));
      if (staff.length === 1 && staff[0]) {
        setAssignees((current) => ({ ...current, [request.id]: staff[0]!.membershipId }));
      }
    } catch (cause) {
      reportError(cause);
    } finally {
      setBusyId(null);
    }
  }

  async function act(
    request: StaffRequest,
    action: StaffRequestAction,
    reason?: string,
    transferTo?: string,
  ) {
    if (busyId) return false;
    const assigneeId = action === 'transfer' ? transferTo : assignees[request.id];
    if ((action === 'assign' || action === 'transfer') && !assigneeId) return false;
    setBusyId(request.id);
    try {
      await staffApi.requestAction(token, request.id, action, {
        expectedVersion: request.version,
        ...(assigneeId && (action === 'assign' || action === 'transfer') ? { assigneeId } : {}),
        ...(reason ? { reason } : {}),
      });
      reportSuccess(successMessages[action]);
      setCandidates((current) => {
        const next = { ...current };
        delete next[request.id];
        return next;
      });
      await refresh();
      return true;
    } catch (cause) {
      reportError(cause);
      if (cause instanceof ApiError && cause.status === 409) await refresh();
      return false;
    } finally {
      setBusyId(null);
    }
  }

  // Managers see every request in their area; other staff only their own work
  // (the server sends only what each person may see).
  const manager = canAnywhere('request.assign');
  const counts = queue?.counts;
  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'open', label: manager ? 'Open' : 'My open work', count: counts?.open ?? 0 },
    {
      id: 'completed',
      label: manager ? 'Ready to close' : 'Completed',
      count: counts?.completed ?? 0,
    },
    { id: 'history', label: 'History', count: counts?.history ?? 0 },
  ];
  const filters: { id: OpenFilter; label: string; count: number }[] = [
    { id: 'all', label: 'All open', count: counts?.open ?? 0 },
    { id: 'overdue', label: 'Overdue', count: counts?.overdue ?? 0 },
    ...(manager
      ? [{ id: 'waiting' as const, label: 'Waiting for assignment', count: counts?.waiting ?? 0 }]
      : []),
  ];
  const visible = queue?.serviceRequests ?? [];
  const total = queue?.total ?? 0;
  const shownPage = selected ? 1 : page;
  const firstShown = (shownPage - 1) * pageSize + 1;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <>
      {selected && (
        <div className="notice notice-info">
          Viewing the request linked from your inbox. If it is unavailable, it may have moved
          outside your access area.
          <button
            type="button"
            className="secondary"
            onClick={() => {
              const next = new URLSearchParams(params);
              next.delete('request');
              setParams(next);
            }}
          >
            Show all requests
          </button>
        </div>
      )}
      <PageHeading
        title={manager ? 'Patient requests' : 'My requests'}
        description={
          manager
            ? 'Assign new patient requests to an eligible staff member, then close them once the work is done.'
            : 'Accept the work assigned to you, start it at the bed, then mark it complete.'
        }
      >
        <div className="heading-actions">
          <AlertSettings />
          {updatedAt && (
            <span className="muted small" aria-live="polite">
              Updated {clockTime(updatedAt)}
            </span>
          )}
          <button
            className="secondary"
            type="button"
            onClick={() => void refresh()}
            disabled={busyId !== null}
          >
            Refresh
          </button>
        </div>
      </PageHeading>

      <ol className="how-it-works small" aria-label="How a request moves">
        <li className={manager ? 'current' : ''}>
          <strong>1. Assign</strong> Manager picks eligible staff
        </li>
        <li className={manager ? '' : 'current'}>
          <strong>2. Accept → Start → Complete</strong> Staff member does the work
        </li>
        <li className={manager ? 'current' : ''}>
          <strong>3. Close</strong> Manager confirms it is done
        </li>
      </ol>

      {!queue ? (
        <LoadState
          loading={!error}
          error={error}
          label="Loading requests…"
          onRetry={() => void refresh()}
        />
      ) : (
        <>
          {error && <p className="notice notice-warning">{error}</p>}
          <div className="tabs" role="group" aria-label="Request list">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                className={tab === item.id ? 'tab active' : 'tab'}
                aria-pressed={tab === item.id}
                onClick={() => {
                  if (selected) {
                    const next = new URLSearchParams(params);
                    next.delete('request');
                    setParams(next);
                  }
                  setTab(item.id);
                  setFilter('all');
                  setPage(1);
                }}
              >
                {item.label} <span className="count">{item.count}</span>
              </button>
            ))}
            {(counts?.overdue ?? 0) > 0 && (
              <span className="badge badge-danger" role="status">
                {counts?.overdue} overdue
              </span>
            )}
          </div>
          {!selected && tab === 'open' && (counts?.open ?? 0) > 0 && (
            <div className="filter-chips" role="group" aria-label="Show">
              {filters.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={filter === item.id ? 'tab active' : 'tab'}
                  aria-pressed={filter === item.id}
                  onClick={() => {
                    setFilter(item.id);
                    setPage(1);
                  }}
                >
                  {item.label} <span className="count">{item.count}</span>
                </button>
              ))}
            </div>
          )}

          {visible.length === 0 ? (
            <div className="card empty-state">
              <p>
                {selected
                  ? 'This request is no longer available in your access area. Choose Show all requests to return to your queue.'
                  : tab === 'open' && filter !== 'all'
                    ? 'No requests match this filter right now.'
                    : tab === 'open'
                      ? manager
                        ? 'No patient requests need attention right now. New ones appear here automatically.'
                        : 'Nothing is assigned to you right now. New work appears here automatically.'
                      : tab === 'completed'
                        ? 'No completed requests are waiting.'
                        : 'No closed or cancelled requests yet.'}
              </p>
            </div>
          ) : (
            <div className="request-list">
              {visible.map((request) => (
                <RequestCard
                  key={request.id}
                  request={request}
                  now={now}
                  isMine={request.assigneeId === me.membershipId}
                  manager={manager}
                  busy={busyId !== null}
                  candidates={candidates[request.id]}
                  assignee={assignees[request.id] ?? ''}
                  canManageStaff={can('staff.manage')}
                  canAnywhere={canAnywhere}
                  onChooseStaff={() => void showCandidates(request)}
                  onAssignee={(membershipId) =>
                    setAssignees((current) => ({ ...current, [request.id]: membershipId }))
                  }
                  onAct={(action) => void act(request, action)}
                  onReject={() => setRejectTarget(request)}
                  onTransfer={() => setTransferTarget(request)}
                  onCancel={() => setCancelTarget(request)}
                  onHistory={() => setHistoryId(request.id)}
                />
              ))}
            </div>
          )}
          {total > pageSize && (
            <nav className="pager" aria-label="Pages">
              <span className="muted small">
                Showing {firstShown}–{Math.min(firstShown + visible.length - 1, total)} of {total}
                {tab === 'open' && ' · overdue first, then oldest first'}
              </span>
              <button
                type="button"
                className="secondary"
                disabled={page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                Previous
              </button>
              <span className="small">
                Page {page} of {pages}
              </span>
              <button
                type="button"
                className="secondary"
                disabled={page >= pages}
                onClick={() => setPage((current) => current + 1)}
              >
                Next
              </button>
            </nav>
          )}
        </>
      )}

      {historyId && <RequestTimelineDialog id={historyId} onClose={() => setHistoryId(null)} />}
      {cancelTarget && (
        <ReasonDialog
          title={`Cancel ${cancelTarget.serviceName}?`}
          request={cancelTarget}
          explanation="The patient will see the request as cancelled. The reason is kept in the request history."
          reasons={cancelReasons}
          keepLabel="Keep request"
          confirmLabel="Cancel request"
          busy={busyId !== null}
          onClose={() => setCancelTarget(null)}
          onConfirm={async (reason) => {
            if (await act(cancelTarget, 'cancel', reason)) setCancelTarget(null);
          }}
        />
      )}
      {rejectTarget && (
        <ReasonDialog
          title={`Turn down ${rejectTarget.serviceName}?`}
          request={rejectTarget}
          explanation="The request ends and the patient sees it as Rejected; they can send it again. Your manager sees your reason in Reports."
          reasons={rejectReasons}
          keepLabel="Keep it"
          confirmLabel="Turn down request"
          busy={busyId !== null}
          onClose={() => setRejectTarget(null)}
          onConfirm={async (reason) => {
            if (await act(rejectTarget, 'reject', reason)) setRejectTarget(null);
          }}
        />
      )}
      {transferTarget && (
        <TransferDialog
          request={transferTarget}
          busy={busyId !== null}
          onClose={() => setTransferTarget(null)}
          onConfirm={async (assigneeId, reason) => {
            if (await act(transferTarget, 'transfer', reason, assigneeId)) setTransferTarget(null);
          }}
        />
      )}
    </>
  );
}
