import { useEffect, useState, type ReactNode } from 'react';
import {
  ApiError,
  staffApi,
  type CoverageInput,
  type MembershipStatus,
  type Shift,
  type StaffMember,
} from '../api';
import { ErrorNotice } from '../components';
import { useAdmin } from './AdminLayout';
import { coverageLabel, nameOf, type Directory } from './staff-directory';

type CoverageType = CoverageInput['scopeType'];

const statuses: MembershipStatus[] = ['ACTIVE', 'SUSPENDED', 'INACTIVE'];
const coverageTypes: CoverageType[] = ['WARD', 'FLOOR', 'HOSPITAL'];

export function StaffDialog({
  member,
  directory,
  isSelf,
  onChanged,
  onClose,
}: {
  member: StaffMember;
  directory: Directory;
  isSelf: boolean;
  onChanged: () => void;
  onClose: () => void;
}) {
  const { token, reportError } = useAdmin();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<MembershipStatus>(member.status);
  const [departmentId, setDepartmentId] = useState('');
  const [coverageType, setCoverageType] = useState<CoverageType>('WARD');
  const [locationId, setLocationId] = useState('');
  const [roleId, setRoleId] = useState('');
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [shiftVersion, setShiftVersion] = useState(0);
  const [shiftStart, setShiftStart] = useState('');
  const [shiftEnd, setShiftEnd] = useState('');
  const [shiftDepartment, setShiftDepartment] = useState('');

  useEffect(() => {
    let cancelled = false;
    const from = encodeURIComponent(new Date(Date.now() - 86_400_000).toISOString());
    staffApi.list<Shift>(token, 'shifts', `?membershipId=${member.id}&from=${from}`).then(
      (result) => {
        if (!cancelled) setShifts(result);
      },
      (cause: unknown) => {
        if (!cancelled) reportError(cause);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [token, member.id, shiftVersion, reportError]);

  // Runs one change, then refreshes the staff list. Errors stay in the dialog.
  async function run(action: () => Promise<unknown>, after?: () => void) {
    setBusy(true);
    setError(null);
    try {
      await action();
      after?.();
      onChanged();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) reportError(cause);
      else setError(cause instanceof Error ? cause.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  const availableDepartments = directory.departments.filter(
    (department) => department.active && !member.departmentIds.includes(department.id),
  );
  const availableRoles = directory.roles.filter(
    (role) => role.active && !member.roleIds.includes(role.id),
  );
  const locations =
    coverageType === 'FLOOR' ? directory.floors : coverageType === 'WARD' ? directory.wards : [];

  function coverageInput(): CoverageInput {
    if (coverageType === 'FLOOR') return { scopeType: 'FLOOR', floorId: locationId };
    if (coverageType === 'WARD') return { scopeType: 'WARD', wardId: locationId };
    return { scopeType: 'HOSPITAL' };
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={member.displayName}>
      <div className="card dialog dialog-wide">
        <div className="dialog-header">
          <div>
            <h2>{member.displayName}</h2>
            <p className="muted small">{member.email}</p>
          </div>
          <button type="button" className="secondary" onClick={onClose}>
            Close
          </button>
        </div>
        {error && <ErrorNotice message={error} onDismiss={() => setError(null)} />}

        <Panel title="Status">
          {isSelf ? (
            <p className="muted small">You cannot change your own status.</p>
          ) : (
            <div className="inline-form">
              <select
                value={status}
                onChange={(event) => {
                  const next = statuses.find((value) => value === event.target.value);
                  if (next) setStatus(next);
                }}
              >
                <option value="ACTIVE">Active</option>
                <option value="SUSPENDED">Suspended</option>
                <option value="INACTIVE">Inactive</option>
              </select>
              <button
                type="button"
                disabled={busy || status === member.status}
                onClick={() => void run(() => staffApi.setStaffStatus(token, member.id, status))}
              >
                Save
              </button>
              <span className="muted small">
                Suspending or deactivating also takes them off duty and signs them out.
              </span>
            </div>
          )}
        </Panel>

        <Panel title="Departments">
          <Chips
            items={member.departmentIds.map((id) => ({
              id,
              label: nameOf(directory.departments, id),
            }))}
            empty="No departments."
            disabled={busy}
            onRemove={(id) => void run(() => staffApi.removeDepartment(token, member.id, id))}
          />
          <div className="inline-form">
            <select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}>
              <option value="">Choose a department…</option>
              {availableDepartments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={busy || !departmentId}
              onClick={() =>
                void run(
                  () => staffApi.addDepartment(token, member.id, departmentId),
                  () => setDepartmentId(''),
                )
              }
            >
              Add
            </button>
          </div>
        </Panel>

        <Panel title="Coverage (where they receive requests)">
          <Chips
            items={member.coverage.map((scope) => ({
              id: scope.id,
              label: coverageLabel(scope, directory),
            }))}
            empty="No coverage: they receive no requests."
            disabled={busy}
            onRemove={(id) => void run(() => staffApi.removeCoverage(token, member.id, id))}
          />
          <div className="inline-form">
            <select
              value={coverageType}
              onChange={(event) => {
                const next = coverageTypes.find((value) => value === event.target.value);
                if (next) setCoverageType(next);
                setLocationId('');
              }}
            >
              <option value="WARD">Ward</option>
              <option value="FLOOR">Floor</option>
              <option value="HOSPITAL">Whole hospital</option>
            </select>
            {coverageType !== 'HOSPITAL' && (
              <select value={locationId} onChange={(event) => setLocationId(event.target.value)}>
                <option value="">Choose…</option>
                {locations
                  .filter((location) => location.active)
                  .map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.code} — {location.name}
                    </option>
                  ))}
              </select>
            )}
            <button
              type="button"
              disabled={busy || (coverageType !== 'HOSPITAL' && !locationId)}
              onClick={() =>
                void run(
                  () => staffApi.addCoverage(token, member.id, coverageInput()),
                  () => setLocationId(''),
                )
              }
            >
              Add
            </button>
          </div>
        </Panel>

        {directory.roles.length > 0 && (
          <Panel title="Roles (what they can do in CARE QR)">
            <Chips
              items={member.roleIds.map((id) => ({ id, label: nameOf(directory.roles, id) }))}
              empty="No roles: they cannot sign in."
              disabled={busy || isSelf}
              onRemove={(id) => void run(() => staffApi.removeRole(token, member.id, id))}
            />
            <div className="inline-form">
              <select value={roleId} onChange={(event) => setRoleId(event.target.value)}>
                <option value="">Choose a role…</option>
                {availableRoles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={busy || !roleId}
                onClick={() =>
                  void run(
                    () => staffApi.assignRole(token, member.id, roleId),
                    () => setRoleId(''),
                  )
                }
              >
                Add
              </button>
            </div>
          </Panel>
        )}

        <Panel title="Upcoming shifts">
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
          <div className="inline-form">
            <input
              type="datetime-local"
              value={shiftStart}
              aria-label="Shift start"
              onChange={(event) => setShiftStart(event.target.value)}
            />
            <input
              type="datetime-local"
              value={shiftEnd}
              aria-label="Shift end"
              onChange={(event) => setShiftEnd(event.target.value)}
            />
            <select
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
            <button
              type="button"
              disabled={busy || !shiftStart || !shiftEnd}
              onClick={() =>
                void run(
                  () =>
                    staffApi.createShift(token, {
                      membershipId: member.id,
                      startsAt: new Date(shiftStart).toISOString(),
                      endsAt: new Date(shiftEnd).toISOString(),
                      ...(shiftDepartment ? { departmentId: shiftDepartment } : {}),
                    }),
                  () => {
                    setShiftStart('');
                    setShiftEnd('');
                    setShiftVersion((value) => value + 1);
                  },
                )
              }
            >
              Add shift
            </button>
          </div>
          <p className="muted small">
            Shifts are a schedule only. Use the duty button to make someone available.
          </p>
        </Panel>
      </div>
    </div>
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

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Chips({
  items,
  empty,
  disabled,
  onRemove,
}: {
  items: { id: string; label: string }[];
  empty: string;
  disabled: boolean;
  onRemove: (id: string) => void;
}) {
  if (items.length === 0) {
    return <p className="muted small">{empty}</p>;
  }
  return (
    <div className="chips">
      {items.map((item) => (
        <span key={item.id} className="chip">
          {item.label}
          <button
            type="button"
            className="chip-remove"
            disabled={disabled}
            aria-label={`Remove ${item.label}`}
            onClick={() => onRemove(item.id)}
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}
