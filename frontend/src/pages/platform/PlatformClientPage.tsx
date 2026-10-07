import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { platformApi, type PlatformClient } from '../../api';
import { LoadState } from '../../components';
import { NewHospitalDialog } from './NewHospitalDialog';
import { HospitalMark, StatusBadge } from './platform-shared';
import { usePlatform } from './PlatformLayout';

const emptyDetails = { name: '', contactName: '', contactEmail: '', contactPhone: '' };

function detailsOf(client: PlatformClient) {
  return {
    name: client.name,
    contactName: client.contactName ?? '',
    contactEmail: client.contactEmail ?? '',
    contactPhone: client.contactPhone ?? '',
  };
}

// One customer: contact details, status, and its hospitals. Nothing from
// inside a hospital (patients, requests, staff records) is shown here.
export function PlatformClientPage() {
  const { id = '' } = useParams();
  const { token, reportError, reportSuccess } = usePlatform();
  const [client, setClient] = useState<PlatformClient | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [details, setDetails] = useState(emptyDetails);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let current = true;
    platformApi.client(token, id).then(
      (loaded) => {
        if (!current) return;
        setClient(loaded);
        setDetails(detailsOf(loaded));
      },
      (cause: unknown) => {
        if (!current) return;
        setError(cause instanceof Error ? cause.message : 'Could not load the client.');
        reportError(cause);
      },
    );
    return () => {
      current = false;
    };
  }, [token, id, version, reportError]);

  async function update(input: Parameters<typeof platformApi.updateClient>[2], success: string) {
    setBusy(true);
    try {
      const fresh = await platformApi.updateClient(token, id, input);
      setClient(fresh);
      setDetails(detailsOf(fresh));
      reportSuccess(success);
    } catch (cause) {
      reportError(cause);
    } finally {
      setBusy(false);
    }
  }

  if (!client) {
    return (
      <LoadState
        loading={!error}
        error={error}
        label="Loading client…"
        onRetry={() => {
          setError(null);
          setVersion((value) => value + 1);
        }}
      />
    );
  }

  const active = client.status === 'ACTIVE';
  const saved = detailsOf(client);
  const changed = (Object.keys(details) as (keyof typeof details)[]).filter(
    (key) => details[key].trim() !== saved[key],
  );

  function saveDetails(event: FormEvent) {
    event.preventDefault();
    const input: Parameters<typeof platformApi.updateClient>[2] = {};
    for (const key of changed) {
      const value = details[key].trim();
      if (key === 'name') input.name = value;
      else input[key] = value || null;
    }
    void update(input, 'Client details saved.');
  }

  const hospitals = client.hospitals ?? [];
  const field = (key: keyof typeof details, label: string, type = 'text') => (
    <label>
      {label}
      <input
        type={type}
        value={details[key]}
        required={key === 'name'}
        minLength={key === 'name' ? 2 : undefined}
        maxLength={key === 'contactPhone' ? 40 : 200}
        onChange={(event) => setDetails((current) => ({ ...current, [key]: event.target.value }))}
      />
    </label>
  );

  return (
    <>
      <p className="breadcrumbs small">
        <Link to="/platform">Clients</Link> › {client.name}
      </p>
      <header className="panel-header platform-hospital-header">
        <div className="platform-hospital-title">
          <HospitalMark name={client.name} logoUrl={null} />
          <div>
            <h1>{client.name}</h1>
            <p className="muted small">
              Code <span className="code">{client.code}</span> · client since{' '}
              {new Date(client.createdAt).toLocaleDateString()}
            </p>
          </div>
          <StatusBadge status={client.status} />
        </div>
        <div className="panel-header-actions">
          <button
            type="button"
            className={active ? 'danger' : ''}
            disabled={busy}
            onClick={() => {
              const count = `${hospitals.length} ${hospitals.length === 1 ? 'hospital' : 'hospitals'}`;
              const message = active
                ? `Suspend ${client.name}? All ${count} close at once: staff are signed out and patients can no longer use their QR codes. No data is deleted.`
                : `Reactivate ${client.name}? Its ${count} open again (any hospital you suspended on its own stays suspended).`;
              if (window.confirm(message)) {
                void update(
                  { status: active ? 'SUSPENDED' : 'ACTIVE' },
                  active ? `${client.name} suspended.` : `${client.name} reactivated.`,
                );
              }
            }}
          >
            {active ? 'Suspend client' : 'Reactivate client'}
          </button>
        </div>
      </header>
      {!active && (
        <p className="notice notice-warning">
          Suspended: none of this client&apos;s hospitals can be used. Staff cannot sign in and
          patient QR codes do not open. Data is kept.
        </p>
      )}

      <dl className="stat-row">
        {[
          ['Hospitals', client.hospitalCount],
          ['Beds', client.activeBeds],
          ['Staff', client.activeStaff],
          ['Open requests', client.openRequests],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      <div className="profile-grid">
        <section className="card" aria-labelledby="client-details-title">
          <h2 id="client-details-title">Client details</h2>
          <form className="create-form" onSubmit={saveDetails}>
            <fieldset disabled={busy}>
              {field('name', 'Client name')}
              {field('contactName', 'Contact person')}
              {field('contactEmail', 'Contact email', 'email')}
              {field('contactPhone', 'Contact phone', 'tel')}
              <button type="submit" disabled={changed.length === 0}>
                Save details
              </button>
            </fieldset>
          </form>
        </section>

        <section className="card" aria-labelledby="client-hospitals-title">
          <div className="section-heading">
            <h2 id="client-hospitals-title">Hospitals</h2>
            <button
              type="button"
              className="secondary"
              disabled={!active}
              title={active ? undefined : 'Reactivate the client first'}
              onClick={() => setAdding(true)}
            >
              Add hospital
            </button>
          </div>
          {hospitals.length === 0 ? (
            <p className="muted">This client has no hospitals yet.</p>
          ) : (
            <div className="hospital-list">
              {hospitals.map((hospital) => (
                <Link
                  key={hospital.id}
                  to={`/platform/hospitals/${hospital.id}`}
                  className="card hospital-row"
                >
                  <HospitalMark name={hospital.name} logoUrl={hospital.logoUrl} />
                  <span className="hospital-row-main">
                    <strong>{hospital.name}</strong>
                    <span className="muted small code">{hospital.code}</span>
                  </span>
                  <span className="hospital-row-stats small muted">
                    {hospital.activeBeds ?? 0} beds · {hospital.activeStaff ?? 0} staff
                  </span>
                  <StatusBadge status={hospital.status} />
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
      {adding && (
        <NewHospitalDialog
          clients={[client]}
          presetClient={client}
          onClose={() => setAdding(false)}
        />
      )}
    </>
  );
}
