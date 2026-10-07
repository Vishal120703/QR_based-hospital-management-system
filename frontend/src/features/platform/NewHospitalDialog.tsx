import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { platformApi, type NewClientInput, type PlatformClientRef } from '../../api';
import { Modal } from '../../components';
import { acceptedLogoTypes, prepareLogo } from '../../lib/logo-image';
import { allTimezones, codeFromName, PasswordField } from './platform-shared';
import { usePlatform } from './PlatformLayout';
import { emailMaxLength, hospitalCodeInput, phoneInput } from '../../lib/field-rules';

// Onboards a hospital with its first manager, for a new client (customer)
// or as another branch of an existing client.
export function NewHospitalDialog({
  clients,
  presetClient,
  newClientOnly = false,
  onClose,
}: {
  clients: readonly PlatformClientRef[];
  presetClient?: PlatformClientRef | undefined;
  newClientOnly?: boolean;
  onClose: () => void;
}) {
  const { token, reportError, reportSuccess } = usePlatform();
  const navigate = useNavigate();
  const activeClients = clients.filter((client) => client.status === 'ACTIVE');
  const [mode, setMode] = useState<'new' | 'existing'>(presetClient ? 'existing' : 'new');
  const [clientId, setClientId] = useState(presetClient?.id ?? '');
  const [client, setClient] = useState({
    name: '',
    code: '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
  });
  const [clientCodeTouched, setClientCodeTouched] = useState(false);
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

  function newClient(): NewClientInput {
    const optional = (key: 'contactName' | 'contactEmail' | 'contactPhone') =>
      client[key].trim() ? { [key]: client[key].trim() } : {};
    return {
      name: client.name.trim(),
      code: client.code.trim().toUpperCase(),
      ...optional('contactName'),
      ...optional('contactEmail'),
      ...optional('contactPhone'),
    };
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (mode === 'existing' && !clientId) return;
    setSaving(true);
    try {
      const hospital = await platformApi.createHospital(token, {
        name: name.trim(),
        code: code.trim().toUpperCase(),
        timezone,
        managerName: managerName.trim(),
        managerEmail: managerEmail.trim(),
        managerPassword,
        ...(mode === 'existing' ? { clientId } : { client: newClient() }),
      });
      if (logo) {
        try {
          await platformApi.uploadLogo(token, hospital.id, logo.blob);
        } catch (cause) {
          reportError(cause);
        }
      }
      reportSuccess(
        `${hospital.name} is ready for ${hospital.client.name}. Its manager signs in at the staff sign-in page with hospital code ${hospital.code}.`,
      );
      onClose();
      await navigate(
        newClientOnly
          ? `/platform/clients/${hospital.client.id}`
          : `/platform/hospitals/${hospital.id}`,
      );
    } catch (cause) {
      reportError(cause);
    } finally {
      setSaving(false);
    }
  }

  const title = presetClient
    ? `Add a hospital to ${presetClient.name}`
    : newClientOnly
      ? 'Add a client'
      : 'Add a hospital';

  return (
    <Modal title={title} onClose={onClose} wide>
      <form className="create-form" onSubmit={(event) => void submit(event)}>
        <fieldset disabled={saving}>
          <h3>Client</h3>
          {presetClient ? (
            <p className="muted small">
              This hospital will belong to <strong>{presetClient.name}</strong>.
            </p>
          ) : (
            <>
              {!newClientOnly && (
                <div className="choice-row" role="radiogroup" aria-label="Client">
                  <label>
                    <input
                      type="radio"
                      name="client-mode"
                      checked={mode === 'new'}
                      onChange={() => setMode('new')}
                    />
                    A new client
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="client-mode"
                      checked={mode === 'existing'}
                      disabled={activeClients.length === 0}
                      onChange={() => setMode('existing')}
                    />
                    An existing client (another branch)
                  </label>
                </div>
              )}
              {mode === 'existing' ? (
                <label>
                  Existing client
                  <select
                    value={clientId}
                    required
                    onChange={(event) => setClientId(event.target.value)}
                  >
                    <option value="">Choose a client…</option>
                    {activeClients.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} ({item.code})
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <>
                  <p className="muted small">
                    The customer you sell CARE QR to: a hospital group, or a single hospital. For a
                    single hospital you can use the same name for both.
                  </p>
                  <div className="field-grid">
                    <label>
                      Client name
                      <input
                        value={client.name}
                        required
                        minLength={2}
                        maxLength={200}
                        placeholder="Sunrise Health Group"
                        onChange={(event) => {
                          const value = event.target.value;
                          setClient((current) => ({
                            ...current,
                            name: value,
                            ...(clientCodeTouched ? {} : { code: codeFromName(value) }),
                          }));
                        }}
                      />
                    </label>
                    <label>
                      Client code
                      <input
                        value={client.code}
                        required
                        {...hospitalCodeInput}
                        placeholder="SUNRISE-GROUP"
                        onChange={(event) => {
                          setClientCodeTouched(true);
                          setClient((current) => ({ ...current, code: event.target.value }));
                        }}
                      />
                      <small className="muted">For your records. Letters, numbers, -.</small>
                    </label>
                    <label>
                      <span>
                        Contact person <em>(optional)</em>
                      </span>
                      <input
                        value={client.contactName}
                        maxLength={120}
                        onChange={(event) =>
                          setClient((current) => ({ ...current, contactName: event.target.value }))
                        }
                      />
                    </label>
                    <label>
                      <span>
                        Contact email <em>(optional)</em>
                      </span>
                      <input
                        type="email"
                        value={client.contactEmail}
                        maxLength={emailMaxLength}
                        onChange={(event) =>
                          setClient((current) => ({ ...current, contactEmail: event.target.value }))
                        }
                      />
                    </label>
                    <label>
                      <span>
                        Contact phone <em>(optional)</em>
                      </span>
                      <input
                        type="tel"
                        value={client.contactPhone}
                        {...phoneInput}
                        onChange={(event) =>
                          setClient((current) => ({ ...current, contactPhone: event.target.value }))
                        }
                      />
                    </label>
                  </div>
                </>
              )}
            </>
          )}

          <h3>{newClientOnly ? 'First hospital' : 'Hospital'}</h3>
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
                {...hospitalCodeInput}
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
                maxLength={emailMaxLength}
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
            <button type="submit">
              {saving ? 'Creating…' : newClientOnly ? 'Create client' : 'Create hospital'}
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
