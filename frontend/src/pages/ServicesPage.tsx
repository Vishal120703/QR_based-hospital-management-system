import { useEffect, useState } from 'react';
import {
  staffApi,
  type Department,
  type EscalationPolicy,
  type Priority,
  type ServiceCategory,
  type ServiceItem,
  type SlaPolicy,
} from '../api';
import { CreateForm } from '../components';
import { useAdmin } from './AdminLayout';

interface Catalog {
  categories: ServiceCategory[];
  services: ServiceItem[];
  departments: Department[];
  slaPolicies: SlaPolicy[];
  escalationPolicies: EscalationPolicy[];
}

const priorities: Priority[] = ['NORMAL', 'HIGH', 'URGENT'];

async function loadCatalog(token: string): Promise<Catalog> {
  const [categories, services, departments, slaPolicies, escalationPolicies] = await Promise.all([
    staffApi.list<ServiceCategory>(token, 'service-categories'),
    staffApi.list<ServiceItem>(token, 'services'),
    staffApi.list<Department>(token, 'departments'),
    staffApi.list<SlaPolicy>(token, 'sla-policies'),
    staffApi.list<EscalationPolicy>(token, 'escalation-policies'),
  ]);
  return { categories, services, departments, slaPolicies, escalationPolicies };
}

function byId<T extends { id: string }>(items: T[], id: string | null): T | undefined {
  return items.find((item) => item.id === id);
}

export function ServicesPage() {
  const { token, me, reportError } = useAdmin();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [version, setVersion] = useState(0);
  const canManage = me.permissions.includes('service.manage');

  useEffect(() => {
    let cancelled = false;
    loadCatalog(token).then(
      (result) => {
        if (!cancelled) setCatalog(result);
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
  async function change(action: () => Promise<unknown>) {
    try {
      await action();
      reload();
    } catch (cause) {
      reportError(cause);
    }
  }

  if (!catalog) {
    return <p className="muted">Loading catalog…</p>;
  }

  const options = <T extends { id: string; name: string }>(items: T[]) =>
    items.map((item) => ({ value: item.id, label: item.name }));

  return (
    <>
      <h1>Service catalog</h1>
      <p className="muted">
        The buttons patients see after scanning a QR code. A service is shown only when it, its
        category, and its department are active. Changes apply to new requests only.
      </p>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Service</th>
              <th>Category</th>
              <th>Department</th>
              <th>Priority</th>
              <th>SLA (accept / complete)</th>
              <th>Escalation</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {catalog.services.map((service) => {
              const sla = byId(catalog.slaPolicies, service.slaPolicyId);
              const department = byId(catalog.departments, service.departmentId);
              const category = byId(catalog.categories, service.categoryId);
              return (
                <tr key={service.id}>
                  <td>
                    <strong>{service.name}</strong>
                  </td>
                  <td>
                    {category?.name}
                    {category && !category.active && <span className="badge"> inactive</span>}
                  </td>
                  <td>
                    {department?.name}
                    {department && !department.active && <span className="badge"> inactive</span>}
                  </td>
                  <td>
                    <span
                      className={`badge ${service.priority === 'NORMAL' ? '' : 'badge-occupied'}`}
                    >
                      {service.priority.toLowerCase()}
                    </span>
                  </td>
                  <td>
                    {sla && (
                      <>
                        {sla.name}
                        <div className="muted small">
                          {sla.acceptMinutes} / {sla.completeMinutes} min · v{sla.currentVersion}
                        </div>
                      </>
                    )}
                  </td>
                  <td>
                    {byId(catalog.escalationPolicies, service.escalationPolicyId)?.name ?? '—'}
                  </td>
                  <td>
                    {canManage ? (
                      <button
                        type="button"
                        className={service.active ? '' : 'secondary'}
                        onClick={() =>
                          void change(() =>
                            staffApi.updateService(token, service.id, { active: !service.active }),
                          )
                        }
                      >
                        {service.active ? 'Shown' : 'Hidden'}
                      </button>
                    ) : (
                      <span className="badge">{service.active ? 'shown' : 'hidden'}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="split catalog-forms">
        <section className="card">
          <h2>Categories</h2>
          <p className="muted small">
            Groups on the patient screen. An emergency notice shows the “not for emergencies”
            warning beside the group.
          </p>
          <ul className="location-list">
            {catalog.categories.map((category) => (
              <li key={category.id} className="category-row">
                <span>
                  {category.name}
                  {category.emergencyNotice && (
                    <span className="badge badge-maintenance">notice</span>
                  )}
                  {!category.active && <span className="badge">inactive</span>}
                </span>
                {canManage && (
                  <span className="actions">
                    <button
                      type="button"
                      className="secondary"
                      onClick={() =>
                        void change(() =>
                          staffApi.updateCategory(token, category.id, {
                            emergencyNotice: !category.emergencyNotice,
                          }),
                        )
                      }
                    >
                      {category.emergencyNotice ? 'Remove notice' : 'Add notice'}
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() =>
                        void change(() =>
                          staffApi.updateCategory(token, category.id, { active: !category.active }),
                        )
                      }
                    >
                      {category.active ? 'Deactivate' : 'Activate'}
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
          {canManage && (
            <CreateForm
              submitLabel="Add category"
              onError={reportError}
              fields={() => [
                { name: 'name', label: 'Name', placeholder: 'Comfort' },
                {
                  name: 'emergencyNotice',
                  label: 'Emergency notice',
                  optional: true,
                  options: [{ value: 'yes', label: 'Show the notice' }],
                },
              ]}
              onCreate={async (values) => {
                await staffApi.createCategory(token, {
                  name: values.name ?? '',
                  emergencyNotice: values.emergencyNotice === 'yes',
                });
                reload();
              }}
            />
          )}
        </section>

        {canManage && (
          <section className="card">
            <h2>Add service</h2>
            <CreateForm
              submitLabel="Add service"
              onError={reportError}
              fields={() => [
                { name: 'name', label: 'Name', placeholder: 'Extra Blanket' },
                {
                  name: 'categoryId',
                  label: 'Category',
                  options: options(catalog.categories.filter((item) => item.active)),
                },
                {
                  name: 'departmentId',
                  label: 'Department that responds',
                  options: options(catalog.departments.filter((item) => item.active)),
                },
                {
                  name: 'priority',
                  label: 'Priority',
                  options: priorities.map((value) => ({ value, label: value.toLowerCase() })),
                },
                {
                  name: 'slaPolicyId',
                  label: 'SLA policy',
                  options: catalog.slaPolicies.map((policy) => ({
                    value: policy.id,
                    label: `${policy.name} (${policy.acceptMinutes} / ${policy.completeMinutes} min)`,
                  })),
                },
                {
                  name: 'escalationPolicyId',
                  label: 'Escalation policy',
                  optional: true,
                  options: options(catalog.escalationPolicies),
                },
              ]}
              onCreate={async (values) => {
                await staffApi.createService(token, {
                  name: values.name ?? '',
                  categoryId: values.categoryId ?? '',
                  departmentId: values.departmentId ?? '',
                  slaPolicyId: values.slaPolicyId ?? '',
                  priority: priorities.find((value) => value === values.priority) ?? 'NORMAL',
                  ...(values.escalationPolicyId
                    ? { escalationPolicyId: values.escalationPolicyId }
                    : {}),
                });
                reload();
              }}
            />
            <p className="muted small">
              “Urgent” means operationally urgent, never a medical emergency.
            </p>
          </section>
        )}
      </div>
    </>
  );
}
