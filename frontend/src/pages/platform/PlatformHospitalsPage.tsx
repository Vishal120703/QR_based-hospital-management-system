import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { platformApi, type PlatformHospital } from '../../api';
import { LoadState, Modal, PageHeading } from '../../components';
import { acceptedLogoTypes, prepareLogo } from '../../logo-image';
import { allTimezones, codeFromName, HospitalMark, PasswordField } from './platform-shared';
import { usePlatform } from './PlatformLayout';

export function PlatformHospitalsPage() {
  const { token, reportError } = usePlatform();
  const [hospitals, setHospitals] = useState<PlatformHospital[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(
    () =>
      platformApi.hospitals(token).then(
        (loaded) => {
          setHospitals(loaded);
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
    platformApi.hospitals(token).then(
      (loaded) => {
        if (current) setHospitals(loaded);
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
    `${hospital.name} ${hospital.code}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const total = (pick: (hospital: PlatformHospital) => number) =>
    (hospitals ?? []).reduce((sum, hospital) => sum + pick(hospital), 0);

  return (
    <>
      <PageHeading
        title="Client hospitals"
        description="Every hospital that uses CARE QR. Each one has its own staff, layout, logo, and data, fully separate from the others."
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
              ['Active', hospitals.filter((hospital) => hospital.status === 'ACTIVE').length],
              ['Suspended', hospitals.filter((hospital) => hospital.status !== 'ACTIVE').length],
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
              placeholder="Search by name or code…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {visible.length === 0 ? (
            <div className="card empty-state">
              <p>
                {hospitals.length === 0
                  ? 'No client hospitals yet. Choose Add hospital to onboard the first one.'
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
                    <span className="muted small code">{hospital.code}</span>
                  </span>
                  <span className="hospital-row-stats small muted">
                    {hospital.activeBeds ?? 0} beds · {hospital.activeStaff ?? 0} staff ·{' '}
                    {hospital.openRequests ?? 0} open requests
                  </span>
                  <span
                    className={`badge ${hospital.status === 'ACTIVE' ? 'badge-available' : 'badge-danger'}`}
                  >
                    {hospital.status.toLowerCase()}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
      {adding && <NewHospitalDialog onClose={() => setAdding(false)} />}
    </>
  );
}

function NewHospitalDialog({ onClose }: { onClose: () => void }) {
  const { token, reportError, reportSuccess } = usePlatform();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [codeTouched, setCodeTouched] = useState(false);
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const [managerName, setManagerName] = useState('');
  const [managerEmail, setManagerEmail] = useState('');
  const [managerPassword, setManagerPassword] = useState('');
  const [logo, setLogo] = useState<{ blob: Blob; url: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!logo) return;
    return () => URL.revokeObjectURL(logo.url);
  }, [logo]);

  async function chooseLogo(file: File | undefined) {
    if (!file) return;
    try {
      const prepared = await prepareLogo(file);
      setLogo({ blob: prepared.blob, url: URL.createObjectURL(prepared.blob) });
    } catch (cause) {
      reportError(cause);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const hospital = await platformApi.createHospital(token, {
        name: name.trim(),
        code: code.trim().toUpperCase(),
        timezone,
        managerName: managerName.trim(),
        managerEmail: managerEmail.trim(),
        managerPassword,
      });
      if (logo) {
        try {
          await platformApi.uploadLogo(token, hospital.id, logo.blob);
        } catch (cause) {
          reportError(cause);
        }
      }
      reportSuccess(
        `${hospital.name} is ready. Its manager signs in at the staff sign-in page with hospital code ${hospital.code}.`,
      );
      onClose();
      await navigate(`/platform/hospitals/${hospital.id}`);
    } catch (cause) {
      reportError(cause);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Add a client hospital" onClose={onClose} wide>
      <form className="create-form" onSubmit={(event) => void submit(event)}>
        <fieldset disabled={saving}>
          <h3>Hospital</h3>
          <div className="field-grid">
            <label>
              Hospital name
              <input
                value={name}
                required
                minLength={2}
                maxLength={200}
                placeholder="Sunrise Multispeciality Hospital"
                onChange={(event) => {
                  setName(event.target.value);
                  if (!codeTouched) setCode(codeFromName(event.target.value));
                }}
              />
            </label>
            <label>
              Hospital code
              <input
                value={code}
                required
                minLength={2}
                maxLength={32}
                pattern="[A-Za-z0-9\-]+"
                placeholder="SUNRISE"
                onChange={(event) => {
                  setCodeTouched(true);
                  setCode(event.target.value);
                }}
              />
              <small className="muted">
                Staff type this when they sign in. Letters, numbers, -.
              </small>
            </label>
            <label>
              Time zone
              <select value={timezone} onChange={(event) => setTimezone(event.target.value)}>
                {allTimezones().map((zone) => (
                  <option key={zone}>{zone}</option>
                ))}
              </select>
            </label>
            <label>
              <span>
                Logo <em>(optional)</em>
              </span>
              <input
                type="file"
                accept={acceptedLogoTypes}
                onChange={(event) => void chooseLogo(event.target.files?.[0])}
              />
              {logo && <img className="logo-preview" src={logo.url} alt="Logo preview" />}
            </label>
          </div>
          <h3>First Hospital Manager</h3>
          <p className="muted small">
            They run this hospital in CARE QR: layout, staff, roles, and QR labels. They can add
            more managers and staff themselves.
          </p>
          <div className="field-grid">
            <label>
              Full name
              <input
                value={managerName}
                required
                minLength={2}
                maxLength={120}
                onChange={(event) => setManagerName(event.target.value)}
              />
            </label>
            <label>
              Email
              <input
                type="email"
                value={managerEmail}
                required
                onChange={(event) => setManagerEmail(event.target.value)}
              />
            </label>
            <PasswordField value={managerPassword} onChange={setManagerPassword} />
          </div>
          <p className="small muted">
            The hospital starts with the standard roles (Hospital Manager, Floor Manager, Ward
            Manager, Department Supervisor, Care Staff), 7 departments, and 4 example services it
            can change.
          </p>
          <div className="actions">
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit">{saving ? 'Creating…' : 'Create hospital'}</button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
