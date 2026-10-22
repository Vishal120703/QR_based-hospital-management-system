import { useRef, useState } from 'react';
import {
  ApiError,
  staffApi,
  type CoverageInput,
  type MembershipStatus,
  type StaffMember,
} from '../../api';
import { ErrorNotice, Modal, useConfirm } from '../../components';
import { useAdmin } from '../workspace/AdminLayout';
import { coverageLabel, nameOf, type Directory } from './staff-directory';
import { Chips, Panel } from './staff-dialog-parts';
import { StaffShiftPanel } from './StaffShiftPanel';

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
  const confirm = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<MembershipStatus>(member.status);
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [coverageType, setCoverageType] = useState<CoverageType>(
    can('location.read') ? 'WARD' : 'HOSPITAL',
  );
  const [locationId, setLocationId] = useState('');
  const [roleId, setRoleId] = useState('');
  const [rolePlace, setRolePlace] = useState('');
  const pending = useRef(false);
  const canManageRoles = can('role.manage') && can('role.read');
  const canReadLocations = can('location.read');

  // Runs one change, then refreshes the staff list. Errors stay in the dialog.
  async function run(action: () => Promise<unknown>, after?: () => void, message?: string) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
      after?.();
      onChanged();
      reportSuccess(message ?? `${member.displayName}’s details were updated.`);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) reportError(cause);
      else setError(cause instanceof Error ? cause.message : 'Something went wrong.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function saveStatus() {
    if (
      status !== 'ACTIVE' &&
      !(await confirm({
        title: `Set ${member.displayName} to ${status.toLowerCase()}?`,
        message: 'This signs them out and takes them off duty.',
        confirmLabel: status === 'SUSPENDED' ? 'Suspend' : 'Deactivate',
        danger: true,
      }))
    )
      return;
    await run(() => staffApi.setStaffStatus(token, member.id, status));
  }

  // For someone who forgot their password: a temporary one to tell them in
  // person. They are signed out and must choose their own at next sign-in.
  async function resetPassword() {
    if (
      !(await confirm({
        title: `Reset ${member.displayName}’s password?`,
        message:
          'They are signed out everywhere and must choose a new password when they next sign in with the temporary one.',
        confirmLabel: 'Reset password',
        danger: true,
      }))
    )
      return;
    await run(
      () => staffApi.resetStaffPassword(token, member.id, temporaryPassword),
      () => setTemporaryPassword(''),
      `${member.displayName}’s password was reset. Tell them the temporary password in person; they will choose their own when they sign in.`,
    );
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
              onClick={() => void saveStatus()}
            >
              Save
            </button>
            <span className="muted small">
              Suspending or deactivating also takes them off duty and signs them out.
            </span>
          </div>
        )}
      </Panel>

      {can('staff.manage') && !isSelf && (
        <Panel title="Password">
          <form
            className="inline-form"
            onSubmit={(event) => {
              event.preventDefault();
              void resetPassword();
            }}
          >
            <input
              type="text"
              aria-label="Temporary password"
              placeholder="Temporary password (12+ characters)"
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              value={temporaryPassword}
              onChange={(event) => setTemporaryPassword(event.target.value)}
            />
            <button type="submit" disabled={busy || temporaryPassword.length < 12}>
              Reset password
            </button>
            <span className="muted small">
              For someone who forgot theirs. Tell them in person; they must choose their own when
              they next sign in.
            </span>
          </form>
        </Panel>
      )}

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

      <StaffShiftPanel
        token={token}
        member={member}
        directory={directory}
        busy={busy}
        run={run}
        reportError={reportError}
        setDialogError={setError}
      />
    </Modal>
  );
}
