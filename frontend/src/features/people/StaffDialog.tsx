import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ApiError,
  staffApi,
  type CoverageInput,
  type MembershipStatus,
  type Shift,
  type StaffMember,
} from '../../api';
import { ErrorNotice, LoadState, Modal } from '../../components';
import { useAdmin } from '../workspace/AdminLayout';
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
  const { token, reportError, reportSuccess, can } = useAdmin();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<MembershipStatus>(member.status);
  const [departmentId, setDepartmentId] = useState('');
  const [coverageType, setCoverageType] = useState<CoverageType>(
    can('location.read') ? 'WARD' : 'HOSPITAL',
  );
  const [locationId, setLocationId] = useState('');
  const [roleId, setRoleId] = useState('');
  const [rolePlace, setRolePlace] = useState('');
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [shiftVersion, setShiftVersion] = useState(0);
  const [shiftStart, setShiftStart] = useState('');
  const [shiftEnd, setShiftEnd] = useState('');
  const [shiftDepartment, setShiftDepartment] = useState('');
  const [shiftError, setShiftError] = useState<string | null>(null);
  const [loadingShifts, setLoadingShifts] = useState(true);
  const pending = useRef(false);
  const canManageRoles = can('role.manage') && can('role.read');
  const canReadLocations = can('location.read');

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

  // Runs one change, then refreshes the staff list. Errors stay in the dialog.
  async function run(action: () => Promise<unknown>, after?: () => void) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
      after?.();
      onChanged();
      reportSuccess(`${member.displayName}’s details were updated.`);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) reportError(cause);
      else setError(cause instanceof Error ? cause.message : 'Something went wrong.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  const availableDepartments = directory.departments.filter(
    (department) => department.active && !member.departmentIds.includes(department.id),
  );
  // Each held role with the places it applies to.
  const assignments =
    member.roleAssignments ??
    member.roleIds.map((id) => ({ roleId: id, scopes: [{ type: 'HOSPITAL' as const, id: '' }] }));
  const chosenRole = directory.roles.find((role) => role.id === roleId);
  const chosenLevel = chosenRole?.scopeLevel ?? 'HOSPITAL';
  const heldPlaces = new Set(
    assignments
      .filter((assignment) => assignment.roleId === roleId)
      .flatMap((assignment) => assignment.scopes.map((scope) => scope.id)),
  );
  const places = (
    chosenLevel === 'FLOOR'
      ? directory.floors
      : chosenLevel === 'WARD'
        ? directory.wards
        : chosenLevel === 'DEPARTMENT'
          ? directory.departments
          : []
  ).filter((place) => place.active && !heldPlaces.has(place.id));
  // A whole-hospital role can be held once; others once per place.
  const availableRoles = directory.roles.filter(
    (role) =>
      role.active &&
      ((role.scopeLevel ?? 'HOSPITAL') !== 'HOSPITAL' || !member.roleIds.includes(role.id)),
  );
  const placeName = (scope: { type: string; id: string }) =>
    scope.type === 'FLOOR'
      ? nameOf(directory.floors, scope.id)
      : scope.type === 'WARD'
        ? nameOf(directory.wards, scope.id)
        : scope.type === 'DEPARTMENT'
          ? nameOf(directory.departments, scope.id)
          : 'whole hospital';
  const locations =
    coverageType === 'FLOOR' ? directory.floors : coverageType === 'WARD' ? directory.wards : [];

  function coverageInput(): CoverageInput {
    if (coverageType === 'FLOOR') return { scopeType: 'FLOOR', floorId: locationId };
    if (coverageType === 'WARD') return { scopeType: 'WARD', wardId: locationId };
    return { scopeType: 'HOSPITAL' };
  }

  return (
    <Modal title={`Manage ${member.displayName}`} onClose={onClose} wide>
      <p className="muted small">{member.email}</p>
      {error && <ErrorNotice message={error} onDismiss={() => setError(null)} />}

      <Panel title="Status">
        {isSelf ? (
          <p className="muted small">You cannot change your own status.</p>
        ) : (
          <div className="inline-form">
            <select
              aria-label="Staff status"
              disabled={busy}
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
              onClick={() => {
                if (
                  status !== 'ACTIVE' &&
                  !window.confirm(
                    `Set ${member.displayName} to ${status.toLowerCase()}? This signs them out and takes them off duty.`,
                  )
                )
                  return;
                void run(() => staffApi.setStaffStatus(token, member.id, status));
              }}
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
          <select
            aria-label="Department to add"
            disabled={busy}
            value={departmentId}
            onChange={(event) => setDepartmentId(event.target.value)}
          >
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
            label:
              scope.scopeType !== 'HOSPITAL' && !canReadLocations
                ? `${scope.scopeType.toLowerCase()} coverage`
                : coverageLabel(scope, directory),
          }))}
          empty="No coverage: they receive no requests."
          disabled={busy}
          onRemove={(id) => void run(() => staffApi.removeCoverage(token, member.id, id))}
        />
        <div className="inline-form">
          <select
            aria-label="Coverage type"
            disabled={busy}
            value={coverageType}
            onChange={(event) => {
              const next = coverageTypes.find((value) => value === event.target.value);
              if (next) setCoverageType(next);
              setLocationId('');
            }}
          >
            <option value="WARD" disabled={!canReadLocations}>
              Ward
            </option>
            <option value="FLOOR" disabled={!canReadLocations}>
              Floor
            </option>
            <option value="HOSPITAL">Whole hospital</option>
          </select>
          {coverageType !== 'HOSPITAL' && (
            <select
              aria-label="Coverage location"
              disabled={busy || !canReadLocations}
              value={locationId}
              onChange={(event) => setLocationId(event.target.value)}
            >
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
        {!canReadLocations && (
          <p className="muted small">
            Ward and floor coverage needs location read access. You can add whole-hospital coverage.
          </p>
        )}
      </Panel>

      {directory.roles.length > 0 && (
        <Panel title="Roles (what they can do in CARE QR)">
          <Chips
            items={assignments.flatMap((assignment) =>
              assignment.scopes.map((scope) => ({
                id: `${assignment.roleId}:${scope.type === 'HOSPITAL' ? '' : scope.id}`,
                label: `${nameOf(directory.roles, assignment.roleId)} · ${placeName(scope)}`,
              })),
            )}
            empty="No roles: they cannot sign in."
            disabled={busy || isSelf || !canManageRoles}
            onRemove={(key) => {
              const [removeRoleId = '', scopeId] = key.split(':');
              void run(() =>
                staffApi.removeRole(token, member.id, removeRoleId, scopeId || undefined),
              );
            }}
          />
          {canManageRoles ? (
            <div className="inline-form">
              <select
                aria-label="Role to add"
                disabled={busy}
                value={roleId}
                onChange={(event) => {
                  setRoleId(event.target.value);
                  setRolePlace('');
                }}
              >
                <option value="">Choose a role…</option>
                {availableRoles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </select>
              {chosenLevel !== 'HOSPITAL' && (
                <select
                  aria-label="Where the role applies"
                  disabled={busy || !roleId}
                  value={rolePlace}
                  onChange={(event) => setRolePlace(event.target.value)}
                >
                  <option value="">
                    {chosenLevel === 'FLOOR'
                      ? 'Choose the floor…'
                      : chosenLevel === 'WARD'
                        ? 'Choose the ward…'
                        : 'Choose the department…'}
                  </option>
                  {places.map((place) => (
                    <option key={place.id} value={place.id}>
                      {place.name}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                disabled={busy || !roleId || (chosenLevel !== 'HOSPITAL' && !rolePlace)}
                onClick={() =>
                  void run(
                    () =>
                      staffApi.assignRole(
                        token,
                        member.id,
                        roleId,
                        chosenLevel === 'HOSPITAL' ? undefined : rolePlace,
                      ),
                    () => {
                      setRoleId('');
                      setRolePlace('');
                    },
                  )
                }
              >
                Add
              </button>
            </div>
          ) : (
            <p className="muted small">Role assignment needs role management access.</p>
          )}
        </Panel>
      )}

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
              setError('The shift must end after it starts and last no more than 24 hours.');
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
    </Modal>
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
