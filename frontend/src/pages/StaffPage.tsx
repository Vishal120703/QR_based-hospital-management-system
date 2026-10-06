import { useEffect, useRef, useState } from 'react';
import {
  ApiError,
  staffApi,
  type Department,
  type Floor,
  type Role,
  type StaffMember,
  type Ward,
} from '../api';
import { CreateForm, LoadState, PageHeading } from '../components';
import { useAdmin } from './AdminLayout';
import { StaffDialog } from './StaffDialog';
import { coverageLabel, nameOf, type Directory } from './staff-directory';

export function StaffPage() {
  const { token, me, reportError, reportSuccess, can } = useAdmin();
  const [directory, setDirectory] = useState<Directory | null>(null);
  const [version, setVersion] = useState(0);
  const [managing, setManaging] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const pending = useRef(false);
  const canManage = can('staff.manage');
  const canReadRoles = can('role.read');
  const canManageRoles = can('role.manage') && canReadRoles;
  const canReadLocations = can('location.read');

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      staffApi.list<StaffMember>(token, 'staff'),
      staffApi.list<Department>(token, 'departments'),
      canReadRoles ? staffApi.list<Role>(token, 'roles') : Promise.resolve([]),
      canReadLocations ? staffApi.list<Floor>(token, 'floors') : Promise.resolve([]),
      canReadLocations ? staffApi.list<Ward>(token, 'wards') : Promise.resolve([]),
    ]).then(
      ([staff, departments, roles, floors, wards]) => {
        if (!cancelled) {
          setDirectory({ staff, departments, roles, floors, wards });
          setLoading(false);
          setLoadError(null);
        }
      },
      (cause: unknown) => {
        if (!cancelled) {
          setLoading(false);
          setLoadError(cause instanceof Error ? cause.message : 'Unable to load staff.');
          if (cause instanceof ApiError && cause.status === 401) reportError(cause);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [token, version, canReadRoles, canReadLocations, reportError]);

  const reload = () => {
    setLoadError(null);
    setLoading(true);
    setVersion((value) => value + 1);
  };

  async function toggleDuty(member: StaffMember) {
    if (pending.current) return;
    pending.current = true;
    setBusyMemberId(member.id);
    try {
      await staffApi.setDuty(
        token,
        member.id,
        member.dutyStatus === 'ON_DUTY' ? 'OFF_DUTY' : 'ON_DUTY',
      );
      reportSuccess(
        `${member.displayName} is now ${member.dutyStatus === 'ON_DUTY' ? 'off' : 'on'} duty.`,
      );
      reload();
    } catch (cause) {
      reportError(cause);
    } finally {
      pending.current = false;
      setBusyMemberId(null);
    }
  }

  if (!directory) {
    return (
      <LoadState loading={loading} error={loadError} onRetry={reload} label="Loading staff…" />
    );
  }

  const managed = directory.staff.find((member) => member.id === managing);
  const query = search.trim().toLowerCase();
  const staff = directory.staff.filter((member) =>
    `${member.displayName} ${member.email}`.toLowerCase().includes(query),
  );

  return (
    <>
      <PageHeading
        title="Staff"
        description="Set up each person’s department, coverage, and duty. These decide who will be eligible to respond when request routing is enabled."
      />
      <LoadState loading={false} error={loadError} onRetry={reload} />
      <label className="search-field">
        <span>Find a staff member</span>
        <input
          type="search"
          placeholder="Search name or email"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Duty</th>
              <th>Departments</th>
              <th>Coverage</th>
              <th>Roles</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {staff.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  {directory.staff.length === 0
                    ? 'No staff members yet. Add a person below to get started.'
                    : 'No staff match your search.'}
                </td>
              </tr>
            )}
            {staff.map((member) => (
              <tr key={member.id}>
                <td>
                  <strong>{member.displayName}</strong>
                  {member.id === me.membershipId && <span className="muted"> (you)</span>}
                  <div className="muted small">{member.email}</div>
                </td>
                <td>
                  <span
                    className={`badge ${member.status === 'ACTIVE' ? 'badge-available' : 'badge-maintenance'}`}
                  >
                    {member.status.toLowerCase()}
                  </span>
                </td>
                <td>
                  <div className="duty-cell">
                    <span
                      className={`badge ${member.dutyStatus === 'ON_DUTY' ? 'badge-available' : ''}`}
                    >
                      {member.dutyStatus === 'ON_DUTY' ? 'On duty' : 'Off duty'}
                    </span>
                    {canManage && (
                      <button
                        type="button"
                        className="secondary compact"
                        aria-label={`${member.dutyStatus === 'ON_DUTY' ? 'Set off duty' : 'Set on duty'}: ${member.displayName}`}
                        disabled={
                          busyMemberId !== null ||
                          (member.status !== 'ACTIVE' && member.dutyStatus === 'OFF_DUTY')
                        }
                        onClick={() => void toggleDuty(member)}
                      >
                        {busyMemberId === member.id
                          ? 'Saving…'
                          : member.dutyStatus === 'ON_DUTY'
                            ? 'Set off duty'
                            : 'Set on duty'}
                      </button>
                    )}
                  </div>
                </td>
                <td>
                  {member.departmentIds.length === 0 && (
                    <span className="muted small">Not assigned</span>
                  )}
                  {member.departmentIds.map((id) => (
                    <span key={id} className="badge">
                      {nameOf(directory.departments, id)}
                    </span>
                  ))}
                </td>
                <td>
                  {member.coverage.length === 0 && <span className="muted small">No coverage</span>}
                  {member.coverage.map((scope) => (
                    <span key={scope.id} className="badge">
                      {scope.scopeType !== 'HOSPITAL' && !canReadLocations
                        ? `${scope.scopeType.toLowerCase()} coverage`
                        : coverageLabel(scope, directory)}
                    </span>
                  ))}
                </td>
                <td>
                  {member.roleIds.length === 0 && (
                    <span className="muted small">Needs a role to sign in</span>
                  )}
                  {member.roleIds.map((id) => (
                    <span key={id} className="badge">
                      {canReadRoles ? nameOf(directory.roles, id) : 'Assigned role'}
                    </span>
                  ))}
                </td>
                <td>
                  {canManage && (
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setManaging(member.id)}
                    >
                      Manage
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canManage && (
        <section className="card add-staff">
          <h2>Add staff member</h2>
          <CreateForm
            submitLabel="Add staff member"
            onError={reportError}
            fields={() => [
              { name: 'displayName', label: 'Full name', placeholder: 'Asha Kumar' },
              { name: 'email', label: 'Email', type: 'email', placeholder: 'asha@hospital.org' },
              {
                name: 'password',
                label: 'Temporary password (12+ characters)',
                type: 'password',
                minLength: 12,
              },
              ...(canManageRoles
                ? [
                    {
                      name: 'roleId',
                      label: 'Role',
                      optional: true,
                      options: directory.roles
                        .filter((role) => role.active)
                        .map((role) => ({ value: role.id, label: role.name })),
                    },
                  ]
                : []),
            ]}
            onCreate={async (values) => {
              const { staff } = await staffApi.createStaff(token, {
                displayName: values.displayName ?? '',
                email: values.email ?? '',
                password: values.password ?? '',
              });
              if (values.roleId) {
                try {
                  await staffApi.assignRole(token, staff.id, values.roleId);
                } catch (cause) {
                  reload();
                  setManaging(staff.id);
                  if (cause instanceof ApiError && cause.status === 401) reportError(cause);
                  else
                    reportError(
                      new Error(
                        `${staff.displayName} was created, but their role was not assigned. Do not create them again; use Manage to finish setup. ${cause instanceof Error ? cause.message : ''}`,
                      ),
                    );
                  return;
                }
              }
              reload();
              setManaging(staff.id);
              reportSuccess(
                `${staff.displayName} was created. Add departments and coverage to finish setup.`,
              );
            }}
          />
          {!canManageRoles && (
            <p className="muted small">
              Role assignment needs role management access. A role administrator can finish sign-in
              setup after you create this person.
            </p>
          )}
        </section>
      )}

      {managed && (
        <StaffDialog
          member={managed}
          directory={directory}
          isSelf={managed.id === me.membershipId}
          onChanged={reload}
          onClose={() => setManaging(null)}
        />
      )}
    </>
  );
}
