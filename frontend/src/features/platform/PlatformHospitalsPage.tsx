import { useCallback, useState } from 'react';
import { Link } from 'react-router';
import { platformApi, type PlatformHospital } from '../../api';
import { LoadState, PageHeading } from '../../components';
import { useLoad } from '../../lib/use-load';
import { NewHospitalDialog } from './NewHospitalDialog';
import { HospitalMark, StatusBadge } from './platform-shared';
import { usePlatform } from './PlatformLayout';

export function PlatformHospitalsPage() {
  const { token, reportError } = usePlatform();
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const { data, error, reload } = useLoad(
    useCallback(
      () =>
        Promise.all([platformApi.hospitals(token), platformApi.clients(token)]).then(
          ([hospitals, clients]) => ({ hospitals, clients }),
        ),
      [token],
    ),
    { failure: 'Could not load hospitals.', onUnauthorized: reportError },
  );
  const hospitals = data?.hospitals ?? null;
  const clients = data?.clients ?? [];

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
        <LoadState loading={!error} error={error} label="Loading hospitals…" onRetry={reload} />
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
