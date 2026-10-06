import { useEffect, useRef, useState } from 'react';
import {
  ApiError,
  staffApi,
  type Department,
  type EscalationPolicy,
  type Priority,
  type ServiceCategory,
  type ServiceItem,
  type SlaPolicy,
} from '../api';
import { CreateForm, LoadState, PageHeading } from '../components';
import { useAdmin } from './AdminLayout';

interface Catalog {
  categories: ServiceCategory[];
  services: ServiceItem[];
  departments: Department[];
  slaPolicies: SlaPolicy[];
  escalationPolicies: EscalationPolicy[];
}

const priorities: Priority[] = ['NORMAL', 'HIGH', 'URGENT'];

async function loadCatalog(token: string, canReadDepartments: boolean): Promise<Catalog> {
  const [categories, services, departments, slaPolicies, escalationPolicies] = await Promise.all([
    staffApi.list<ServiceCategory>(token, 'service-categories'),
    staffApi.list<ServiceItem>(token, 'services'),
    canReadDepartments ? staffApi.list<Department>(token, 'departments') : Promise.resolve([]),
    staffApi.list<SlaPolicy>(token, 'sla-policies'),
    staffApi.list<EscalationPolicy>(token, 'escalation-policies'),
  ]);
  return { categories, services, departments, slaPolicies, escalationPolicies };
}

function byId<T extends { id: string }>(items: T[], id: string | null): T | undefined {
  return items.find((item) => item.id === id);
}

export function ServicesPage() {
  const { token, reportError, reportSuccess, can } = useAdmin();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [version, setVersion] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const pending = useRef(false);
  const canManage = can('service.manage');
  const canReadDepartments = can('staff.read');

  useEffect(() => {
    let cancelled = false;
    loadCatalog(token, canReadDepartments).then(
      (result) => {
        if (!cancelled) {
          setCatalog(result);
          setLoading(false);
          setLoadError(null);
        }
      },
      (cause: unknown) => {
        if (!cancelled) {
          setLoading(false);
          setLoadError(
            cause instanceof Error ? cause.message : 'Unable to load the service catalog.',
          );
          if (cause instanceof ApiError && cause.status === 401) reportError(cause);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [token, version, canReadDepartments, reportError]);

  const reload = () => {
    setLoading(true);
    setLoadError(null);
    setVersion((value) => value + 1);
  };
  async function change(key: string, action: () => Promise<unknown>) {
    if (pending.current) return;
    pending.current = true;
    setBusyKey(key);
    try {
      await action();
      reload();
      reportSuccess('Catalog settings were updated.');
    } catch (cause) {
      reportError(cause);
    } finally {
      pending.current = false;
      setBusyKey(null);
    }
  }

  if (!catalog) {
    return (
      <LoadState loading={loading} error={loadError} onRetry={reload} label="Loading catalog…" />
    );
  }

  const options = <T extends { id: string; name: string }>(items: T[]) =>
    items.map((item) => ({ value: item.id, label: item.name }));
  const query = search.trim().toLowerCase();
  const services = catalog.services.filter((service) =>
    `${service.name} ${byId(catalog.categories, service.categoryId)?.name ?? ''}`
      .toLowerCase()
      .includes(query),
  );
  const readyForService =
    catalog.categories.some((item) => item.active) &&
    catalog.departments.some((item) => item.active) &&
    catalog.slaPolicies.length > 0;

  return (
    <>
      <PageHeading
        title="Service catalog"
        description="Configure the services patients can request after scanning a bed QR. A service, its category, and its department must all be active."
      />
      <LoadState loading={false} error={loadError} onRetry={reload} />
      <label className="search-field">
        <span>Find a service</span>
        <input
          type="search"
          value={search}
          placeholder="Search service or category"
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>

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
            {services.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  {catalog.services.length === 0
                    ? 'No services yet. Create a category, department, and SLA policy, then add your first service.'
                    : 'No services match your search.'}
                </td>
              </tr>
            )}
            {services.map((service) => {
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
                    {department?.name ??
                      (canReadDepartments ? 'Unavailable department' : 'Department assigned')}
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
                        disabled={busyKey !== null}
                        onClick={() =>
                          void change(service.id, () =>
                            staffApi.updateService(token, service.id, { active: !service.active }),
                          )
                        }
                      >
                        {busyKey === service.id
                          ? 'Saving…'
                          : service.active
                            ? 'Deactivate service'
                            : 'Activate service'}
                      </button>
                    ) : (
                      <span className="badge">{service.active ? 'active' : 'inactive'}</span>
                    )}
                    {service.active &&
                      ((!category?.active && category) || (!department?.active && department)) && (
                        <div className="muted small">
                          Hidden: category or department is inactive.
                        </div>
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
            {catalog.categories.length === 0 && (
              <li className="muted">
                No categories yet. Add a group such as Comfort or Housekeeping.
              </li>
            )}
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
                      disabled={busyKey !== null}
                      onClick={() =>
                        void change(category.id, () =>
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
                      disabled={busyKey !== null}
                      onClick={() =>
                        void change(category.id, () =>
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
                reportSuccess(`${values.name} was added.`);
              }}
            />
          )}
        </section>

        {canManage && (
          <section className="card">
            <h2>Add service</h2>
            {!canReadDepartments ? (
              <p className="muted">
                Creating a service needs staff read access to choose the department responsible. You
                can still manage categories and existing services.
              </p>
            ) : !readyForService ? (
              <p className="muted">
                First add an active category, an active department, and an SLA policy. Then you can
                create a service here.
              </p>
            ) : (
              <>
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
                    reportSuccess(`${values.name} was added to the catalog.`);
                  }}
                />
                <p className="muted small">
                  “Urgent” means operationally urgent, never a medical emergency.
                </p>
              </>
            )}
          </section>
        )}
      </div>
    </>
  );
}
