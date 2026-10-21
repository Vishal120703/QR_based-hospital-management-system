import { type EligibleStaff, type StaffRequest, type StaffRequestAction } from '../../api';
import {
  clockTime,
  currentDeadline,
  formatDuration,
  isOverdue,
  statusBadgeClass,
  statusLabels,
  timeAgo,
} from '../../lib/request-status';

// One request in a work list: what, where, its state and deadline, and the
// actions this person may take on it now.
export function RequestCard({
  request,
  now,
  isMine,
  manager,
  busy,
  candidates,
  assignee,
  canManageStaff,
  canAnywhere,
  onChooseStaff,
  onAssignee,
  onAct,
  onReject,
  onTransfer,
  onCancel,
  onHistory,
}: {
  request: StaffRequest;
  now: number;
  // Assigned to the person viewing.
  isMine: boolean;
  // Can assign work (sees everyone's requests in their area).
  manager: boolean;
  // Another action is in progress.
  busy: boolean;
  // Eligible staff to assign, once asked for; undefined until then.
  candidates: EligibleStaff[] | undefined;
  // The chosen assignee's membership ID, or ''.
  assignee: string;
  canManageStaff: boolean;
  canAnywhere: (permission: string) => boolean;
  onChooseStaff: () => void;
  onAssignee: (membershipId: string) => void;
  onAct: (
    action: Extract<StaffRequestAction, 'assign' | 'accept' | 'start' | 'complete' | 'close'>,
  ) => void;
  onReject: () => void;
  onTransfer: () => void;
  onCancel: () => void;
  onHistory: () => void;
}) {
  const deadline = currentDeadline(request);
  const late = isOverdue(request, now);
  return (
    <article
      className={[
        'card request-card',
        late ? 'late' : request.status === 'SUBMITTED' ? 'waiting' : '',
        request.isEscalated ? 'escalated' : '',
      ]
        .filter(Boolean)
        .join(' ')}
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
          {request.isEscalated && (
            <span className="badge badge-danger">Escalated · level {request.escalationLevel}</span>
          )}
          {request.priority !== 'NORMAL' && (
            <span className="badge badge-danger">{request.priority.toLowerCase()}</span>
          )}
          <span className={statusBadgeClass(request.status)}>{statusLabels[request.status]}</span>
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
          (!candidates ? (
            <button type="button" disabled={busy} onClick={onChooseStaff}>
              Choose staff
            </button>
          ) : candidates.length === 0 ? (
            <p className="muted small">
              No eligible on-duty staff.{' '}
              {canManageStaff
                ? 'Check the department, duty, and bed coverage on the Staff screen.'
                : 'Ask a Hospital Manager to check staff duty, department, and bed coverage.'}
            </p>
          ) : (
            <>
              <select
                aria-label={`Staff for ${request.publicId}`}
                value={assignee}
                onChange={(event) => onAssignee(event.target.value)}
              >
                <option value="">Choose eligible staff…</option>
                {candidates.map((staff) => (
                  <option key={staff.membershipId} value={staff.membershipId}>
                    {staff.displayName}
                  </option>
                ))}
              </select>
              <button type="button" disabled={busy || !assignee} onClick={() => onAct('assign')}>
                Assign request
              </button>
            </>
          ))}
        {isMine && request.status === 'ASSIGNED' && canAnywhere('request.accept') && (
          <button type="button" disabled={busy} onClick={() => onAct('accept')}>
            Accept
          </button>
        )}
        {isMine && request.status === 'ASSIGNED' && canAnywhere('request.reject') && (
          <button type="button" className="secondary" disabled={busy} onClick={onReject}>
            Turn down…
          </button>
        )}
        {isMine && request.status === 'ACCEPTED' && canAnywhere('request.start') && (
          <button type="button" disabled={busy} onClick={() => onAct('start')}>
            Start work
          </button>
        )}
        {isMine && request.status === 'IN_PROGRESS' && canAnywhere('request.complete') && (
          <button type="button" disabled={busy} onClick={() => onAct('complete')}>
            Mark complete
          </button>
        )}
        {request.status === 'COMPLETED' && canAnywhere('request.close') && (
          <button type="button" disabled={busy} onClick={() => onAct('close')}>
            Close request
          </button>
        )}
        {(request.status === 'ACCEPTED' || request.status === 'IN_PROGRESS') &&
          canAnywhere('request.transfer') && (
            <button type="button" className="secondary" disabled={busy} onClick={onTransfer}>
              Hand over…
            </button>
          )}
        {(request.status === 'SUBMITTED' || request.status === 'ASSIGNED') &&
          canAnywhere('request.cancel') && (
            <button type="button" className="secondary" disabled={busy} onClick={onCancel}>
              Cancel…
            </button>
          )}
        {canAnywhere('analytics.read') && (
          <button type="button" className="link" onClick={onHistory}>
            History
          </button>
        )}
      </div>
    </article>
  );
}
