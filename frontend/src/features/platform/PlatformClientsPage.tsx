import { useCallback, useState } from 'react';
import { Link } from 'react-router';
import { platformApi, type PlatformClient } from '../../api';
import { LoadState, PageHeading } from '../../components';
import { useLoad } from '../../lib/use-load';
import { NewHospitalDialog } from './NewHospitalDialog';
import { HospitalMark, StatusBadge } from './platform-shared';
import { usePlatform } from './PlatformLayout';

// The super admin's home: every customer and how many hospitals each has.
export function PlatformClientsPage() {
  const { token, reportError } = usePlatform();
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const { data, error, reload } = useLoad(
    useCallback(
      () => platformApi.clientsPage(token, { page, search: query }),
      [token, page, query],
    ),
    { failure: 'Could not load clients.', onUnauthorized: reportError },
  );

  const clients = data?.items ?? [];
  const visible = clients;
  const total = (pick: (client: PlatformClient) => number) =>
    clients.reduce((sum, client) => sum + pick(client), 0);
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 50)));

  return (
    <>
      <PageHeading
        title="Clients"
        description="Your customers. A client is a hospital group or a single hospital, and can have several hospitals. You manage clients and their hospitals here; what happens inside a hospital stays with that hospital."
      >
        <button type="button" onClick={() => setAdding(true)}>
          Add client
        </button>
      </PageHeading>
      {!data ? (
        <LoadState loading={!error} error={error} label="Loading clients…" onRetry={reload} />
      ) : (
        <>
          <dl className="stat-row">
            {[
              ['Clients', data?.total ?? clients.length],
              ['Active', clients.filter((client) => client.status === 'ACTIVE').length],
              ['Suspended', clients.filter((client) => client.status !== 'ACTIVE').length],
              ['Hospitals', total((client) => client.hospitalCount)],
              ['Beds', total((client) => client.activeBeds)],
              ['Staff', total((client) => client.activeStaff)],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <label className="search-field platform-search">
            <span className="visually-hidden">Search clients</span>
            <input
              type="search"
              placeholder="Search by name, code, or contact…"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
            />
          </label>
          {visible.length === 0 ? (
            <div className="card empty-state">
              <p>
                {clients.length === 0
                  ? 'No clients yet. Choose Add client to onboard the first one with its first hospital.'
                  : 'No client matches your search.'}
              </p>
            </div>
          ) : (
            <div className="hospital-list">
              {visible.map((client) => (
                <Link
                  key={client.id}
                  to={`/platform/clients/${client.id}`}
                  className="card hospital-row"
                >
                  <HospitalMark name={client.name} logoUrl={null} />
                  <span className="hospital-row-main">
                    <strong>{client.name}</strong>
                    <span className="muted small">
                      <span className="code">{client.code}</span>
                      {client.contactName && <> · {client.contactName}</>}
                    </span>
                  </span>
                  <span className="hospital-row-stats small muted">
                    {client.hospitalCount} {client.hospitalCount === 1 ? 'hospital' : 'hospitals'} ·{' '}
                    {client.activeBeds} beds · {client.activeStaff} staff
                  </span>
                  <StatusBadge status={client.status} />
                </Link>
              ))}
            </div>
          )}
          {data.total > data.pageSize && (
            <nav className="pager" aria-label="Client pages">
              <span className="muted small">
                Showing {(data.page - 1) * data.pageSize + 1}–
                {Math.min(data.page * data.pageSize, data.total)} of {data.total}
              </span>
              <button
                type="button"
                className="secondary"
                disabled={data.page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                Previous
              </button>
              <span className="small">
                Page {data.page} of {pages}
              </span>
              <button
                type="button"
                className="secondary"
                disabled={data.page >= pages}
                onClick={() => setPage((current) => current + 1)}
              >
                Next
              </button>
            </nav>
          )}
        </>
      )}
      {adding && (
        <NewHospitalDialog clients={clients} newClientOnly onClose={() => setAdding(false)} />
      )}
    </>
  );
}
