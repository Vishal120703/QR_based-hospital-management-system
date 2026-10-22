import { useEffect, useState } from 'react';
import { ApiError, staffApi, type Shift, type StaffMember } from '../../api';
import { LoadState } from '../../components';
import { nameOf, type Directory } from './staff-directory';
import { Chips, Panel } from './staff-dialog-parts';

type RunChange = (
  action: () => Promise<unknown>,
  after?: () => void,
  message?: string,
) => Promise<void>;

export function StaffShiftPanel({
  token,
  member,
  directory,
  busy,
  run,
  reportError,
  setDialogError,
}: {
  token: string;
  member: StaffMember;
  directory: Directory;
  busy: boolean;
  run: RunChange;
  reportError: (cause: ApiError) => void;
  setDialogError: (message: string) => void;
}) {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [shiftVersion, setShiftVersion] = useState(0);
  const [shiftStart, setShiftStart] = useState('');
  const [shiftEnd, setShiftEnd] = useState('');
  const [shiftDepartment, setShiftDepartment] = useState('');
  const [shiftError, setShiftError] = useState<string | null>(null);
  const [loadingShifts, setLoadingShifts] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const from = encodeURIComponent(new Date(Date.now() - 86_400_000).toISOString());
    staffApi.list<Shift>(token, 'shifts', `?membershipId=${member.id}&from=${from}`).then(
      (result) => {
        if (!cancelled) {
          setShifts(result);
          setLoadingShifts(false);
          setShiftError(null);
        }
      },
      (cause: unknown) => {
        if (!cancelled) {
          setLoadingShifts(false);
          setShiftError(cause instanceof Error ? cause.message : 'Unable to load shifts.');
          if (cause instanceof ApiError && cause.status === 401) reportError(cause);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [token, member.id, shiftVersion, reportError]);

  return (
    <Panel title="Upcoming shifts">
      <LoadState
        loading={loadingShifts}
        error={shiftError}
        onRetry={() => {
          setLoadingShifts(true);
          setShiftError(null);
          setShiftVersion((value) => value + 1);
        }}
        label="Loading shifts…"
      />
      <Chips
        items={shifts.map((shift) => ({
          id: shift.id,
          label: `${formatTime(shift.startsAt)} – ${formatTime(shift.endsAt)}${
            shift.departmentId ? ` · ${nameOf(directory.departments, shift.departmentId)}` : ''
          }`,
        }))}
        empty="No shifts scheduled."
        disabled={busy}
        onRemove={(id) =>
          void run(
            () => staffApi.deleteShift(token, id),
            () => setShiftVersion((value) => value + 1),
          )
        }
      />
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          const startsAt = new Date(shiftStart);
          const endsAt = new Date(shiftEnd);
          if (endsAt <= startsAt || endsAt.getTime() - startsAt.getTime() > 86_400_000) {
            setDialogError('The shift must end after it starts and last no more than 24 hours.');
            return;
          }
          void run(
            () =>
              staffApi.createShift(token, {
                membershipId: member.id,
                startsAt: startsAt.toISOString(),
                endsAt: endsAt.toISOString(),
                ...(shiftDepartment ? { departmentId: shiftDepartment } : {}),
              }),
            () => {
              setShiftStart('');
              setShiftEnd('');
              setShiftVersion((value) => value + 1);
            },
          );
        }}
      >
        <input
          type="datetime-local"
          required
          disabled={busy}
          value={shiftStart}
          aria-label="Shift start"
          onChange={(event) => setShiftStart(event.target.value)}
        />
        <input
          type="datetime-local"
          required
          disabled={busy}
          value={shiftEnd}
          aria-label="Shift end"
          onChange={(event) => setShiftEnd(event.target.value)}
        />
        <select
          aria-label="Shift department"
          disabled={busy}
          value={shiftDepartment}
          onChange={(event) => setShiftDepartment(event.target.value)}
        >
          <option value="">Any department</option>
          {member.departmentIds.map((id) => (
            <option key={id} value={id}>
              {nameOf(directory.departments, id)}
            </option>
          ))}
        </select>
        <button type="submit" disabled={busy || !shiftStart || !shiftEnd}>
          Add shift
        </button>
      </form>
      <p className="muted small">
        Shifts are a schedule only. Use the duty button to make someone available.
      </p>
    </Panel>
  );
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString([], {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
