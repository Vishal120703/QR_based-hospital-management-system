import { useEffect, useRef, useState } from 'react';
import { ApiError, staffApi, type Department } from '../api';
import { CreateForm, LoadState, PageHeading } from '../components';
import { useAdmin } from './AdminLayout';

export function DepartmentsPage() {
  const { token, reportError, reportSuccess, can } = useAdmin();
  const [departments, setDepartments] = useState<Department[] | null>(null);
  const [version, setVersion] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const pending = useRef(false);
  const canManage = can('staff.manage');

  useEffect(() => {
    let cancelled = false;
    staffApi.list<Department>(token, 'departments').then(
      (result) => {
        if (!cancelled) {
          setDepartments(result);
          setLoading(false);
          setLoadError(null);
        }
      },
      (cause: unknown) => {
        if (!cancelled) {
          setLoading(false);
          setLoadError(cause instanceof Error ? cause.message : 'Unable to load departments.');
          if (cause instanceof ApiError && cause.status === 401) reportError(cause);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [token, version, reportError]);

  const reload = () => {
    setLoading(true);
    setLoadError(null);
    setVersion((value) => value + 1);
  };

  async function toggle(department: Department) {
    if (pending.current) return;
    if (
      department.active &&
      !window.confirm(
        `Deactivate ${department.name}? Its services will be hidden from patients and its staff will not be eligible for that department.`,
      )
    )
      return;
    pending.current = true;
    setBusyId(department.id);
    try {
      await staffApi.updateDepartment(token, department.id, { active: !department.active });
      reportSuccess(`${department.name} is now ${department.active ? 'inactive' : 'active'}.`);
      reload();
    } catch (cause) {
      reportError(cause);
    } finally {
      pending.current = false;
      setBusyId(null);
    }
  }

  if (!departments) {
    return (
      <LoadState
        loading={loading}
        error={loadError}
        onRetry={reload}
        label="Loading departments…"
      />
    );
  }

  return (
    <>
      <PageHeading
        title="Departments"
        description="Departments group the teams responsible for services, such as Nursing or Housekeeping. A staff member may belong to several teams. Inactive departments are hidden from the patient catalog."
      />
      <LoadState loading={false} error={loadError} onRetry={reload} />
      <div className="split">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Status</th>
                {canManage && <th />}
              </tr>
            </thead>
            <tbody>
              {departments.length === 0 && (
                <tr>
                  <td colSpan={canManage ? 4 : 3} className="muted">
                    No departments yet. Add the first team to begin staff and service setup.
                  </td>
                </tr>
              )}
              {departments.map((department) => (
                <tr key={department.id}>
                  <td className="code">{department.code}</td>
                  <td>{department.name}</td>
                  <td>
                    <span className={`badge ${department.active ? 'badge-available' : ''}`}>
                      {department.active ? 'active' : 'inactive'}
                    </span>
                  </td>
                  {canManage && (
                    <td>
                      <button
                        type="button"
                        className="secondary"
                        disabled={busyId !== null}
                        onClick={() => void toggle(department)}
                      >
                        {busyId === department.id
                          ? 'Saving…'
                          : department.active
                            ? 'Deactivate'
                            : 'Activate'}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canManage && (
          <section className="card">
            <h2>Add department</h2>
            <CreateForm
              submitLabel="Add department"
              onError={reportError}
              fields={() => [
                { name: 'code', label: 'Code', placeholder: 'PHARMACY' },
                { name: 'name', label: 'Name', placeholder: 'Pharmacy' },
              ]}
              onCreate={async (values) => {
                await staffApi.create(token, 'departments', {
                  code: values.code,
                  name: values.name,
                });
                reload();
                reportSuccess(`${values.name} was added.`);
              }}
            />
          </section>
        )}
      </div>
    </>
  );
}
