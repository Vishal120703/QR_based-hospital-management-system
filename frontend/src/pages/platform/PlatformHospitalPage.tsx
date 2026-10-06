import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { assetUrl, platformApi, type PlatformHospital } from '../../api';
import { LoadState } from '../../components';
import { acceptedLogoTypes, prepareLogo } from '../../logo-image';
import { allTimezones, HospitalMark, PasswordField } from './platform-shared';
import { usePlatform } from './PlatformLayout';

export function PlatformHospitalPage() {
  const { id = '' } = useParams();
  const { token, reportError, reportSuccess } = usePlatform();
  const [hospital, setHospital] = useState<PlatformHospital | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('');
  const [manager, setManager] = useState({ displayName: '', email: '', password: '' });
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let current = true;
    platformApi.hospital(token, id).then(
      (loaded) => {
        if (!current) return;
        setHospital(loaded);
        setName(loaded.name);
        setTimezone(loaded.timezone);
      },
      (cause: unknown) => {
        if (!current) return;
        setError(cause instanceof Error ? cause.message : 'Could not load the hospital.');
        reportError(cause);
      },
    );
    return () => {
      current = false;
    };
  }, [token, id, version, reportError]);

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await action();
      const fresh = await platformApi.hospital(token, id);
      setHospital(fresh);
      setName(fresh.name);
      setTimezone(fresh.timezone);
      reportSuccess(success);
      return true;
    } catch (cause) {
      reportError(cause);
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!hospital) {
    return (
      <LoadState
        loading={!error}
        error={error}
        label="Loading hospital…"
        onRetry={() => {
          setError(null);
          setVersion((value) => value + 1);
        }}
      />
    );
  }

  const active = hospital.status === 'ACTIVE';

  function saveDetails(event: FormEvent) {
    event.preventDefault();
    void run(
      () =>
        platformApi.updateHospital(token, id, {
          ...(name.trim() !== hospital?.name ? { name: name.trim() } : {}),
          ...(timezone !== hospital?.timezone ? { timezone } : {}),
        }),
      'Hospital details saved.',
    );
  }

  function addManager(event: FormEvent) {
    event.preventDefault();
    void run(
      () => platformApi.addManager(token, id, manager),
      `${manager.displayName} added as a Hospital Manager.`,
    ).then((saved) => {
      if (saved) setManager({ displayName: '', email: '', password: '' });
    });
  }

  async function chooseLogo(file: File | undefined) {
    if (!file) return;
    try {
      const prepared = await prepareLogo(file);
      await run(() => platformApi.uploadLogo(token, id, prepared.blob), 'Logo saved.');
    } catch (cause) {
      reportError(cause);
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  return (
    <>
      <p className="breadcrumbs small">
        <Link to="/platform">Client hospitals</Link> › {hospital.name}
      </p>
      <header className="panel-header platform-hospital-header">
        <div className="platform-hospital-title">
          <HospitalMark name={hospital.name} logoUrl={hospital.logoUrl} />
          <div>
            <h1>{hospital.name}</h1>
            <p className="muted small">
              Code <span className="code">{hospital.code}</span> · since{' '}
              {new Date(hospital.createdAt).toLocaleDateString()}
            </p>
          </div>
          <span className={`badge ${active ? 'badge-available' : 'badge-danger'}`}>
            {hospital.status.toLowerCase()}
          </span>
        </div>
        <div className="panel-header-actions">
          <button
            type="button"
            className={active ? 'danger' : ''}
            disabled={busy}
            onClick={() => {
              const message = active
                ? `Suspend ${hospital.name}? All its staff are signed out and patients can no longer use its QR codes until you reactivate it. No data is deleted.`
                : `Reactivate ${hospital.name}? Staff can sign in and QR codes work again.`;
              if (window.confirm(message)) {
                void run(
                  () =>
                    platformApi.updateHospital(token, id, {
                      status: active ? 'SUSPENDED' : 'ACTIVE',
                    }),
                  active ? `${hospital.name} suspended.` : `${hospital.name} reactivated.`,
                );
              }
            }}
          >
            {active ? 'Suspend hospital' : 'Reactivate hospital'}
          </button>
        </div>
      </header>
      {!active && (
        <p className="notice notice-warning">
          Suspended: staff cannot sign in and patient QR codes do not open. Data is kept.
        </p>
      )}

      <div className="profile-grid">
        <section className="card" aria-labelledby="details-title">
          <h2 id="details-title">Details</h2>
          <form className="create-form" onSubmit={saveDetails}>
            <label>
              Hospital name
              <input
                value={name}
                required
                minLength={2}
                maxLength={200}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              Time zone
              <select value={timezone} onChange={(event) => setTimezone(event.target.value)}>
                {allTimezones().map((zone) => (
                  <option key={zone}>{zone}</option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={busy || (name.trim() === hospital.name && timezone === hospital.timezone)}
            >
              Save details
            </button>
          </form>
        </section>

        <section className="card" aria-labelledby="logo-title">
          <h2 id="logo-title">Logo</h2>
          <div className="logo-stage">
            {hospital.logoUrl ? (
              <img src={assetUrl(hospital.logoUrl)} alt={`${hospital.name} logo`} />
            ) : (
              <span className="muted">No logo yet</span>
            )}
          </div>
          <div className="actions">
            <label className={`button${hospital.logoUrl ? ' secondary' : ''} file-button`}>
              {hospital.logoUrl ? 'Replace logo' : 'Upload logo'}
              <input
                ref={fileInput}
                type="file"
                accept={acceptedLogoTypes}
                disabled={busy}
                onChange={(event) => void chooseLogo(event.target.files?.[0])}
              />
            </label>
            {hospital.logoUrl && (
              <button
                type="button"
                className="danger"
                disabled={busy}
                onClick={() => void run(() => platformApi.removeLogo(token, id), 'Logo removed.')}
              >
                Remove logo
              </button>
            )}
          </div>
        </section>
      </div>

      <section className="card" aria-labelledby="managers-title">
        <h2 id="managers-title">Hospital Managers</h2>
        <p className="muted small">
          Managers run this hospital in CARE QR. Add another one if a manager leaves or forgets
          their password; they can then manage everyone else.
        </p>
        <ul className="manager-list">
          {(hospital.managers ?? []).map((item) => (
            <li key={item.membershipId}>
              <strong>{item.displayName}</strong>
              <span className="muted small">{item.email}</span>
              {item.status !== 'ACTIVE' && (
                <span className="badge">{item.status.toLowerCase()}</span>
              )}
            </li>
          ))}
        </ul>
        <form className="create-form" onSubmit={addManager}>
          <h3>Add a Hospital Manager</h3>
          <fieldset disabled={busy}>
            <div className="field-grid">
              <label>
                Full name
                <input
                  value={manager.displayName}
                  required
                  minLength={2}
                  onChange={(event) =>
                    setManager((current) => ({ ...current, displayName: event.target.value }))
                  }
                />
              </label>
              <label>
                Email
                <input
                  type="email"
                  value={manager.email}
                  required
                  onChange={(event) =>
                    setManager((current) => ({ ...current, email: event.target.value }))
                  }
                />
              </label>
              <PasswordField
                value={manager.password}
                onChange={(password) => setManager((current) => ({ ...current, password }))}
              />
            </div>
            <button type="submit">Add manager</button>
          </fieldset>
        </form>
      </section>
    </>
  );
}
