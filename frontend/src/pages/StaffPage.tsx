import { useEffect, useState } from 'react';
import { staffApi, type StaffMember } from '../api';
import { CreateForm } from '../components';
import { useAdmin } from './AdminLayout';
import { StaffDialog } from './StaffDialog';
import { coverageLabel, loadDirectory, nameOf, type Directory } from './staff-directory';

export function StaffPage() {
  const { token, me, reportError } = useAdmin();
  const [directory, setDirectory] = useState<Directory | null>(null);
  const [version, setVersion] = useState(0);
  const [managing, setManaging] = useState<string | null>(null);
  const can = (permission: string) => me.permissions.includes(permission);
  const canManage = can('staff.manage');
  const canReadRoles = can('role.read');

  useEffect(() => {
    let cancelled = false;
    loadDirectory(token, canReadRoles).then(
      (result) => {
        if (!cancelled) setDirectory(result);
      },
      (cause: unknown) => {
        if (!cancelled) reportError(cause);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [token, version, canReadRoles, reportError]);

  const reload = () => setVersion((value) => value + 1);

  async function toggleDuty(member: StaffMember) {
    try {
      await staffApi.setDuty(
        token,
        member.id,
        member.dutyStatus === 'ON_DUTY' ? 'OFF_DUTY' : 'ON_DUTY',
      );
      reload();
    } catch (cause) {
      reportError(cause);
    }
  }

  if (!directory) {
    return <p className="muted">Loading staff…</p>;
  }

  const managed = directory.staff.find((member) => member.id === managing);

  return (
    <>
      <h1>Staff</h1>
      <p className="muted">
        A staff member receives requests only when they are active, on duty, in the request’s
        department, and their coverage includes the bed’s ward, floor, or the whole hospital.
      </p>

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
            {directory.staff.map((member) => (
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
                  {canManage ? (
                    <button
                      type="button"
                      className={member.dutyStatus === 'ON_DUTY' ? '' : 'secondary'}
                      disabled={member.status !== 'ACTIVE' && member.dutyStatus === 'OFF_DUTY'}
                      onClick={() => void toggleDuty(member)}
                    >
                      {member.dutyStatus === 'ON_DUTY' ? 'On duty' : 'Off duty'}
                    </button>
                  ) : (
                    <span className="badge">{member.dutyStatus === 'ON_DUTY' ? 'on' : 'off'}</span>
                  )}
                </td>
                <td>
                  {member.departmentIds.map((id) => (
                    <span key={id} className="badge">
                      {nameOf(directory.departments, id)}
                    </span>
                  ))}
                </td>
                <td>
                  {member.coverage.map((scope) => (
                    <span key={scope.id} className="badge">
                      {coverageLabel(scope, directory)}
                    </span>
                  ))}
                </td>
                <td>
                  {member.roleIds.map((id) => (
                    <span key={id} className="badge">
                      {nameOf(directory.roles, id)}
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
              },
              {
                name: 'roleId',
                label: 'Role',
                optional: true,
                options: directory.roles
                  .filter((role) => role.active)
                  .map((role) => ({ value: role.id, label: role.name })),
              },
            ]}
            onCreate={async (values) => {
              const { staff } = await staffApi.createStaff(token, {
                displayName: values.displayName ?? '',
                email: values.email ?? '',
                password: values.password ?? '',
              });
              if (values.roleId) {
                await staffApi.assignRole(token, staff.id, values.roleId);
              }
              reload();
            }}
          />
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
