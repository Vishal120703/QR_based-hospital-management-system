import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ApiError,
  staffApi,
  type EligibleStaff,
  type StaffRequest,
  type StaffRequestAction,
} from '../api';
import { LoadState, Modal, PageHeading } from '../components';
import {
  clockTime,
  currentDeadline,
  finishedStatuses,
  formatDuration,
  isOverdue,
  openStatuses,
  statusBadgeClass,
  statusLabels,
  timeAgo,
  useAutoRefresh,
  useNow,
} from '../request-status';
import { useAdmin } from './AdminLayout';
import { RequestTimelineDialog } from './RequestTimelineDialog';

type Tab = 'open' | 'completed' | 'history';

const cancelReasons = [
  'Patient no longer needs it',
  'Duplicate request',
  'Raised by mistake',
  'Other',
];

const rejectReasons = [
  'Item or equipment not available',
  'Not my department or skill',
  'Patient not at the bed',
  'Patient refused the service',
  'Other',
];

const transferReasons = [
  'My shift has ended',
  'Busy with another patient',
  'Needs someone more experienced',
  'Other',
];

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
  const { token, me, can, canAnywhere, reportError, reportSuccess } = useAdmin();
  const [requests, setRequests] = useState<StaffRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('open');
  const [candidates, setCandidates] = useState<Record<string, EligibleStaff[]>>({});
  const [assignees, setAssignees] = useState<Record<string, string>>({});
  const [cancelTarget, setCancelTarget] = useState<StaffRequest | null>(null);
  const [rejectTarget, setRejectTarget] = useState<StaffRequest | null>(null);
  const [transferTarget, setTransferTarget] = useState<StaffRequest | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const loading = useRef(false);
  const now = useNow();

  const refresh = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      setRequests(await staffApi.requests(token));
      setUpdatedAt(Date.now());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load requests.');
      if (cause instanceof ApiError && cause.status === 401) reportError(cause);
    } finally {
      loading.current = false;
    }
  }, [token, reportError]);

  useEffect(() => {
    let cancelled = false;
    staffApi.requests(token).then(
      (loaded) => {
        if (cancelled) return;
        setRequests(loaded);
        setUpdatedAt(Date.now());
      },
      (cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : 'Could not load requests.');
        if (cause instanceof ApiError && cause.status === 401) reportError(cause);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [token, reportError]);
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

  const manager = canAnywhere('request.assign');
  // Managers see every request in their area; other staff see their own work.
  const mine = (request: StaffRequest) => manager || request.assigneeId === me.membershipId;
  const groups: Record<Tab, StaffRequest[]> = {
    open: (requests ?? [])
      .filter((request) => mine(request) && openStatuses.includes(request.status))
      .sort((left, right) => {
        const leftDue = currentDeadline(left)?.dueAt ?? 0;
        const rightDue = currentDeadline(right)?.dueAt ?? 0;
        return leftDue - rightDue;
      }),
    completed: (requests ?? []).filter(
      (request) => mine(request) && request.status === 'COMPLETED',
    ),
    history: (requests ?? []).filter(
      (request) => mine(request) && finishedStatuses.includes(request.status),
    ),
  };
  const overdue = groups.open.filter((request) => isOverdue(request, now)).length;
  const tabs: { id: Tab; label: string }[] = [
    { id: 'open', label: manager ? 'Open' : 'My open work' },
    { id: 'completed', label: manager ? 'Ready to close' : 'Completed' },
    { id: 'history', label: 'History' },
  ];
  const visible = groups[tab];

  return (
    <>
      <PageHeading
        title={manager ? 'Patient requests' : 'My requests'}
        description={
          manager
            ? 'Assign new patient requests to an eligible staff member, then close them once the work is done.'
            : 'Accept the work assigned to you, start it at the bed, then mark it complete.'
        }
      >
        <div className="heading-actions">
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

      {!requests ? (
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
                onClick={() => setTab(item.id)}
              >
                {item.label} <span className="count">{groups[item.id].length}</span>
              </button>
            ))}
            {overdue > 0 && (
              <span className="badge badge-danger" role="status">
                {overdue} overdue
              </span>
            )}
          </div>

          {visible.length === 0 ? (
            <div className="card empty-state">
              <p>
                {tab === 'open'
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
              {visible.map((request) => {
                const deadline = currentDeadline(request);
                const late = isOverdue(request, now);
                const isMine = request.assigneeId === me.membershipId;
                const busy = busyId !== null;
                return (
                  <article
                    className={late ? 'card request-card late' : 'card request-card'}
                    key={request.id}
                  >
                    <div className="request-card-head">
                      <div>
                        <h2>{request.serviceName}</h2>
                        <p className="muted small">
                          <strong>{request.bed.displayName}</strong> · {request.publicId} · sent{' '}
                          {timeAgo(request.submittedAt, now)}
                        </p>
                      </div>
                      <div className="request-badges">
                        {request.priority !== 'NORMAL' && (
                          <span className="badge badge-danger">
                            {request.priority.toLowerCase()}
                          </span>
                        )}
                        <span className={statusBadgeClass(request.status)}>
                          {statusLabels[request.status]}
                        </span>
                      </div>
                    </div>

                    <div className="request-facts small">
                      {request.assigneeName && (
                        <span>
                          Assigned to <strong>{isMine ? 'you' : request.assigneeName}</strong>
                        </span>
                      )}
                      {deadline && (
                        <span className={late ? 'late-text' : ''}>
                          {late
                            ? `${deadline.label} overdue by ${formatDuration(now - deadline.dueAt)}`
                            : `${deadline.label} by ${clockTime(deadline.dueAt)} (in ${formatDuration(deadline.dueAt - now)})`}
                        </span>
                      )}
                    </div>

                    <div className="actions">
                      {manager &&
                        request.status === 'SUBMITTED' &&
                        (!candidates[request.id] ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void showCandidates(request)}
                          >
                            Choose staff
                          </button>
                        ) : candidates[request.id]?.length === 0 ? (
                          <p className="muted small">
                            No eligible on-duty staff.{' '}
                            {can('staff.manage')
                              ? 'Check the department, duty, and bed coverage on the Staff screen.'
                              : 'Ask a Hospital Manager to check staff duty, department, and bed coverage.'}
                          </p>
                        ) : (
                          <>
                            <select
                              aria-label={`Staff for ${request.publicId}`}
                              value={assignees[request.id] ?? ''}
                              onChange={(event) =>
                                setAssignees((current) => ({
                                  ...current,
                                  [request.id]: event.target.value,
                                }))
                              }
                            >
                              <option value="">Choose eligible staff…</option>
                              {candidates[request.id]?.map((staff) => (
                                <option key={staff.membershipId} value={staff.membershipId}>
                                  {staff.displayName}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              disabled={busy || !assignees[request.id]}
                              onClick={() => void act(request, 'assign')}
                            >
                              Assign request
                            </button>
                          </>
                        ))}
                      {isMine && request.status === 'ASSIGNED' && canAnywhere('request.accept') && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void act(request, 'accept')}
                        >
                          Accept
                        </button>
                      )}
                      {isMine && request.status === 'ASSIGNED' && canAnywhere('request.reject') && (
                        <button
                          type="button"
                          className="secondary"
                          disabled={busy}
                          onClick={() => setRejectTarget(request)}
                        >
                          Turn down…
                        </button>
                      )}
                      {isMine && request.status === 'ACCEPTED' && canAnywhere('request.start') && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void act(request, 'start')}
                        >
                          Start work
                        </button>
                      )}
                      {isMine &&
                        request.status === 'IN_PROGRESS' &&
                        canAnywhere('request.complete') && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void act(request, 'complete')}
                          >
                            Mark complete
                          </button>
                        )}
                      {request.status === 'COMPLETED' && canAnywhere('request.close') && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void act(request, 'close')}
                        >
                          Close request
                        </button>
                      )}
                      {(request.status === 'ACCEPTED' || request.status === 'IN_PROGRESS') &&
                        canAnywhere('request.transfer') && (
                          <button
                            type="button"
                            className="secondary"
                            disabled={busy}
                            onClick={() => setTransferTarget(request)}
                          >
                            Hand over…
                          </button>
                        )}
                      {(request.status === 'SUBMITTED' || request.status === 'ASSIGNED') &&
                        canAnywhere('request.cancel') && (
                          <button
                            type="button"
                            className="secondary"
                            disabled={busy}
                            onClick={() => setCancelTarget(request)}
                          >
                            Cancel…
                          </button>
                        )}
                      {canAnywhere('analytics.read') && (
                        <button
                          type="button"
                          className="link"
                          onClick={() => setHistoryId(request.id)}
                        >
                          History
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
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

// Who can take over this work: eligible on-duty staff other than the current assignee.
function TransferDialog({
  request,
  busy,
  onClose,
  onConfirm,
}: {
  request: StaffRequest;
  busy: boolean;
  onClose: () => void;
  onConfirm: (assigneeId: string, reason: string) => Promise<void>;
}) {
  const { token } = useAdmin();
  const [staff, setStaff] = useState<EligibleStaff[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [assigneeId, setAssigneeId] = useState('');
  const [choice, setChoice] = useState(transferReasons[0]!);
  const [details, setDetails] = useState('');
  const reason = choice === 'Other' ? details.trim() : choice;

  useEffect(() => {
    let current = true;
    staffApi.eligible(token, request.bedId, request.departmentId).then(
      (loaded) => {
        if (!current) return;
        const others = loaded.filter((person) => person.membershipId !== request.assigneeId);
        setStaff(others);
        if (others.length === 1 && others[0]) setAssigneeId(others[0].membershipId);
      },
      (cause: unknown) => {
        if (current) setError(cause instanceof Error ? cause.message : 'Could not load staff.');
      },
    );
    return () => {
      current = false;
    };
  }, [token, request.bedId, request.departmentId, request.assigneeId, attempt]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (assigneeId && reason) void onConfirm(assigneeId, reason);
  }

  return (
    <Modal title={`Hand over ${request.serviceName}`} onClose={onClose}>
      <form className="create-form" onSubmit={submit}>
        <p className="muted small">
          {request.bed.displayName} · {request.publicId} · now with{' '}
          {request.assigneeName ?? 'nobody'}. The new person must accept it again; the handover and
          its reason are kept in the request history.
        </p>
        {!staff ? (
          <LoadState
            loading={!error}
            error={error}
            label="Finding eligible staff…"
            onRetry={() => {
              setError(null);
              setAttempt((value) => value + 1);
            }}
          />
        ) : staff.length === 0 ? (
          <p className="notice notice-warning">
            Nobody else is eligible right now: they must be on duty, in this department, and cover
            this bed.
          </p>
        ) : (
          <label>
            Hand over to
            <select
              value={assigneeId}
              required
              onChange={(event) => setAssigneeId(event.target.value)}
            >
              <option value="">Choose eligible staff…</option>
              {staff.map((person) => (
                <option key={person.membershipId} value={person.membershipId}>
                  {person.displayName}
                </option>
              ))}
            </select>
          </label>
        )}
        <ReasonFields
          reasons={transferReasons}
          choice={choice}
          details={details}
          onChoice={setChoice}
          onDetails={setDetails}
        />
        <div className="actions">
          <button type="button" className="secondary" onClick={onClose}>
            Keep with {request.assigneeName ?? 'current person'}
          </button>
          <button type="submit" disabled={busy || !assigneeId || !reason}>
            Hand over
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ReasonFields({
  reasons,
  choice,
  details,
  onChoice,
  onDetails,
}: {
  reasons: readonly string[];
  choice: string;
  details: string;
  onChoice: (choice: string) => void;
  onDetails: (details: string) => void;
}) {
  return (
    <>
      <label>
        Reason
        <select value={choice} onChange={(event) => onChoice(event.target.value)}>
          {reasons.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </label>
      {choice === 'Other' && (
        <label>
          Describe the reason
          <input
            value={details}
            maxLength={500}
            required
            onChange={(event) => onDetails(event.target.value)}
          />
        </label>
      )}
    </>
  );
}

function ReasonDialog({
  title,
  request,
  explanation,
  reasons,
  keepLabel,
  confirmLabel,
  busy,
  onClose,
  onConfirm,
}: {
  title: string;
  request: StaffRequest;
  explanation: string;
  reasons: readonly string[];
  keepLabel: string;
  confirmLabel: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [choice, setChoice] = useState(reasons[0] ?? 'Other');
  const [details, setDetails] = useState('');
  const reason = choice === 'Other' ? details.trim() : choice;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (reason) void onConfirm(reason);
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form className="create-form" onSubmit={submit}>
        <p className="muted small">
          {request.bed.displayName} · {request.publicId}. {explanation}
        </p>
        <ReasonFields
          reasons={reasons}
          choice={choice}
          details={details}
          onChoice={setChoice}
          onDetails={setDetails}
        />
        <div className="actions">
          <button type="button" className="secondary" onClick={onClose}>
            {keepLabel}
          </button>
          <button type="submit" className="danger" disabled={busy || !reason}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
