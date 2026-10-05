import { useEffect, useState } from 'react';
import { staffApi, type Department } from '../api';
import { CreateForm } from '../components';
import { useAdmin } from './AdminLayout';

export function DepartmentsPage() {
  const { token, me, reportError } = useAdmin();
  const [departments, setDepartments] = useState<Department[] | null>(null);
  const [version, setVersion] = useState(0);
  const canManage = me.permissions.includes('staff.manage');

  useEffect(() => {
    let cancelled = false;
    staffApi.list<Department>(token, 'departments').then(
      (result) => {
        if (!cancelled) setDepartments(result);
      },
      (cause: unknown) => {
        if (!cancelled) reportError(cause);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [token, version, reportError]);

  const reload = () => setVersion((value) => value + 1);

  async function toggle(department: Department) {
    try {
      await staffApi.updateDepartment(token, department.id, { active: !department.active });
      reload();
    } catch (cause) {
      reportError(cause);
    }
  }

  if (!departments) {
    return <p className="muted">Loading departments…</p>;
  }

  return (
    <>
      <h1>Departments</h1>
      <p className="muted">
        Teams that respond to requests. A staff member can belong to several departments. Inactive
        departments receive no requests.
      </p>
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
                        onClick={() => void toggle(department)}
                      >
                        {department.active ? 'Deactivate' : 'Activate'}
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
              }}
            />
          </section>
        )}
      </div>
    </>
  );
}
