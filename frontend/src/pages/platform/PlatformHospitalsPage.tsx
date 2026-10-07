import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { platformApi, type PlatformClient, type PlatformHospital } from '../../api';
import { LoadState, PageHeading } from '../../components';
import { NewHospitalDialog } from './NewHospitalDialog';
import { HospitalMark, StatusBadge } from './platform-shared';
import { usePlatform } from './PlatformLayout';

export function PlatformHospitalsPage() {
  const { token, reportError } = usePlatform();
  const [hospitals, setHospitals] = useState<PlatformHospital[] | null>(null);
  const [clients, setClients] = useState<PlatformClient[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(
    () =>
      Promise.all([platformApi.hospitals(token), platformApi.clients(token)]).then(
        ([loadedHospitals, loadedClients]) => {
          setHospitals(loadedHospitals);
          setClients(loadedClients);
          setError(null);
        },
        (cause: unknown) => {
          setError(cause instanceof Error ? cause.message : 'Could not load hospitals.');
          reportError(cause);
        },
      ),
    [token, reportError],
  );

  useEffect(() => {
    let current = true;
    Promise.all([platformApi.hospitals(token), platformApi.clients(token)]).then(
      ([loadedHospitals, loadedClients]) => {
        if (!current) return;
        setHospitals(loadedHospitals);
        setClients(loadedClients);
      },
      (cause: unknown) => {
        if (!current) return;
        setError(cause instanceof Error ? cause.message : 'Could not load hospitals.');
        reportError(cause);
      },
    );
    return () => {
      current = false;
    };
  }, [token, reportError]);

  const visible = (hospitals ?? []).filter((hospital) =>
    `${hospital.name} ${hospital.code} ${hospital.client.name}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const open = (hospital: PlatformHospital) =>
    hospital.status === 'ACTIVE' && hospital.client.status === 'ACTIVE';
  const total = (pick: (hospital: PlatformHospital) => number) =>
    (hospitals ?? []).reduce((sum, hospital) => sum + pick(hospital), 0);

  return (
    <>
      <PageHeading
        title="Hospitals"
        description="Every hospital using CARE QR, with the client it belongs to. Each hospital has its own staff, layout, logo, and data, fully separate from the others."
      >
        <button type="button" onClick={() => setAdding(true)}>
          Add hospital
        </button>
      </PageHeading>
      {!hospitals ? (
        <LoadState
          loading={!error}
          error={error}
          label="Loading hospitals…"
          onRetry={() => void load()}
        />
      ) : (
        <>
          <dl className="stat-row">
            {[
              ['Hospitals', hospitals.length],
              ['Open', hospitals.filter(open).length],
              ['Closed', hospitals.filter((hospital) => !open(hospital)).length],
              ['Beds', total((hospital) => hospital.activeBeds ?? 0)],
              ['Staff', total((hospital) => hospital.activeStaff ?? 0)],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <label className="search-field platform-search">
            <span className="visually-hidden">Search hospitals</span>
            <input
              type="search"
              placeholder="Search by hospital, code, or client…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {visible.length === 0 ? (
            <div className="card empty-state">
              <p>
                {hospitals.length === 0
                  ? 'No hospitals yet. Choose Add hospital to onboard the first one.'
                  : 'No hospital matches your search.'}
              </p>
            </div>
          ) : (
            <div className="hospital-list">
              {visible.map((hospital) => (
                <Link
                  key={hospital.id}
                  to={`/platform/hospitals/${hospital.id}`}
                  className="card hospital-row"
                >
                  <HospitalMark name={hospital.name} logoUrl={hospital.logoUrl} />
                  <span className="hospital-row-main">
                    <strong>{hospital.name}</strong>
                    <span className="muted small">
                      <span className="code">{hospital.code}</span> · client {hospital.client.name}
                    </span>
                  </span>
                  <span className="hospital-row-stats small muted">
                    {hospital.activeBeds ?? 0} beds · {hospital.activeStaff ?? 0} staff ·{' '}
                    {hospital.openRequests ?? 0} open requests
                  </span>
                  <StatusBadge
                    status={hospital.client.status === 'ACTIVE' ? hospital.status : 'SUSPENDED'}
                    note={hospital.client.status === 'ACTIVE' ? undefined : 'client suspended'}
                  />
                </Link>
              ))}
            </div>
          )}
        </>
      )}
      {adding && <NewHospitalDialog clients={clients} onClose={() => setAdding(false)} />}
    </>
  );
}
