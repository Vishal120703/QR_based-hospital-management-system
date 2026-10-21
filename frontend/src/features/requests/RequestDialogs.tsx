import { useEffect, useState, type FormEvent } from 'react';
import { staffApi, type EligibleStaff, type StaffRequest } from '../../api';
import { LoadState, Modal } from '../../components';
import { useAdmin } from '../workspace/AdminLayout';

// The dialogs that need a reason: cancelling, turning down, and handing over
// a request. Each reason is kept in the request's history.

export const cancelReasons = [
  'Patient no longer needs it',
  'Duplicate request',
  'Raised by mistake',
  'Other',
];

export const rejectReasons = [
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

// Who can take over this work: eligible on-duty staff other than the current assignee.
export function TransferDialog({
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

export function ReasonDialog({
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
