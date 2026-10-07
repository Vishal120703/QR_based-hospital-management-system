import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { platformApi, type PlatformClient } from '../../api';
import { LoadState, PageHeading } from '../../components';
import { NewHospitalDialog } from './NewHospitalDialog';
import { HospitalMark, StatusBadge } from './platform-shared';
import { usePlatform } from './PlatformLayout';

// The super admin's home: every customer and how many hospitals each has.
export function PlatformClientsPage() {
  const { token, reportError } = usePlatform();
  const [clients, setClients] = useState<PlatformClient[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(
    () =>
      platformApi.clients(token).then(
        (loaded) => {
          setClients(loaded);
          setError(null);
        },
        (cause: unknown) => {
          setError(cause instanceof Error ? cause.message : 'Could not load clients.');
          reportError(cause);
        },
      ),
    [token, reportError],
  );

  useEffect(() => {
    let current = true;
    platformApi.clients(token).then(
      (loaded) => {
        if (current) setClients(loaded);
      },
      (cause: unknown) => {
        if (!current) return;
        setError(cause instanceof Error ? cause.message : 'Could not load clients.');
        reportError(cause);
      },
    );
    return () => {
      current = false;
    };
  }, [token, reportError]);

  const visible = (clients ?? []).filter((client) =>
    `${client.name} ${client.code} ${client.contactName ?? ''}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const total = (pick: (client: PlatformClient) => number) =>
    (clients ?? []).reduce((sum, client) => sum + pick(client), 0);

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
      {!clients ? (
        <LoadState
          loading={!error}
          error={error}
          label="Loading clients…"
          onRetry={() => void load()}
        />
      ) : (
        <>
          <dl className="stat-row">
            {[
              ['Clients', clients.length],
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
              onChange={(event) => setQuery(event.target.value)}
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
        </>
      )}
      {adding && (
        <NewHospitalDialog clients={clients ?? []} newClientOnly onClose={() => setAdding(false)} />
      )}
    </>
  );
}
