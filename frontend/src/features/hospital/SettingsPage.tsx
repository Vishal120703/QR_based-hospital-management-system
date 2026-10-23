import { useCallback, useRef, useState } from 'react';
import { BedDouble, BellRing, Languages, MessageSquareText, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router';
import {
  staffApi,
  staffNotificationTypes,
  type BedOccupancyChange,
  type Hospital,
  type HospitalSettingsChange,
  type StaffNotificationType,
} from '../../api';
import { type ConfirmQuestion, LoadState, PageHeading, useConfirm } from '../../components';
import { useLoad } from '../../lib/use-load';
import { useAdmin } from '../workspace/AdminLayout';

// The hospital manager's switches: how the hospital works with patients and
// staff. Every change is checked by the server and kept in the audit log.
export function SettingsPage() {
  const { token, reportError, reportSuccess, refreshMe, can } = useAdmin();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  // The notification kinds the manager has ticked; null shows the saved ones.
  const [draftOn, setDraftOn] = useState<StaffNotificationType[] | null>(null);

  const {
    data: hospital,
    error: loadError,
    reload,
    refresh,
  } = useLoad<Hospital>(
    useCallback(() => staffApi.hospital(token), [token]),
    { failure: 'Could not load the settings.', onUnauthorized: reportError },
  );

  // One change at a time; afterwards the page, the menu, and the top bar
  // show the new settings.
  async function run<T>(action: () => Promise<T>, success: string | ((result: T) => string)) {
    if (pending.current) return false;
    pending.current = true;
    setBusy(true);
    try {
      const result = await action();
      await refresh();
      refreshMe?.();
      reportSuccess(typeof success === 'string' ? success : success(result));
      return true;
    } catch (cause) {
      reportError(cause);
      return false;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function change(
    update: HospitalSettingsChange,
    success: string,
    question?: ConfirmQuestion,
  ) {
    if (question && !(await confirm(question))) return false;
    return run(() => staffApi.updateSettings(token, update), success);
  }

  async function chooseOccupancy(enabled: boolean) {
    if (!hospital || enabled === hospital.bedOccupancyEnabled) return;
    if (!(await confirm(enabled ? turnOnAdmissions : turnOffAdmissions))) return;
    await run(() => staffApi.setBedOccupancy(token, enabled), occupancyMessage);
  }

  if (!hospital) {
    return (
      <LoadState
        loading={!loadError}
        error={loadError}
        label="Loading settings…"
        onRetry={reload}
      />
    );
  }

  const savedOn = staffNotificationTypes.filter(
    (type) => !hospital.mutedNotificationTypes.includes(type),
  );
  const notificationsOn = draftOn ?? savedOn;
  const notificationsChanged =
    notificationsOn.length !== savedOn.length ||
    notificationsOn.some((type) => !savedOn.includes(type));
  const hindi = hospital.patientLanguages.includes('hi');

  return (
    <>
      <PageHeading
        title="Settings"
        description="Control how patients use bedside QR codes, how requests flow, and which updates reach your team."
      />
      <LoadState loading={false} error={loadError} onRetry={reload} />

      <section className="card settings-overview" aria-labelledby="settings-overview-title">
        <div className="settings-overview-copy">
          <p className="eyebrow">Current setup</p>
          <h2 id="settings-overview-title">{hospital.name}</h2>
          <p className="muted small">
            Changes apply across the hospital immediately. Important changes ask for confirmation
            first, and every saved update is recorded.
          </p>
          {can('audit.read') && (
            <Link to="/admin/audit">View settings history in the audit log</Link>
          )}
        </div>
        <nav className="settings-status-grid" aria-label="Current settings summary">
          <a href="#occupancy-setting">
            <BedDouble size={18} aria-hidden="true" />
            <span>
              <small>Bed management</small>
              <strong>{hospital.bedOccupancyEnabled ? 'Admissions on' : 'QR codes only'}</strong>
            </span>
          </a>
          <a
            href="#patient-requests-setting"
            className={hospital.patientRequestsPaused ? 'is-warning' : undefined}
          >
            <MessageSquareText size={18} aria-hidden="true" />
            <span>
              <small>Patient requests</small>
              <strong>{hospital.patientRequestsPaused ? 'Paused' : 'Accepting requests'}</strong>
            </span>
          </a>
          <a
            href="#escalations-setting"
            className={hospital.escalationsPaused ? 'is-warning' : undefined}
          >
            <ShieldCheck size={18} aria-hidden="true" />
            <span>
              <small>Escalations</small>
              <strong>{hospital.escalationsPaused ? 'Paused' : 'Running'}</strong>
            </span>
          </a>
          <a href="#notifications-setting">
            <BellRing size={18} aria-hidden="true" />
            <span>
              <small>Staff notifications</small>
              <strong>
                {savedOn.length} of {staffNotificationTypes.length} on
              </strong>
            </span>
          </a>
          <a href="#languages-setting">
            <Languages size={18} aria-hidden="true" />
            <span>
              <small>Patient languages</small>
              <strong>
                {hospital.patientLanguages.length}{' '}
                {hospital.patientLanguages.length === 1 ? 'language' : 'languages'}
              </strong>
            </span>
          </a>
        </nav>
      </section>

      <div className="settings-list">
        <section className="settings-section" aria-labelledby="patient-access-title">
          <div className="settings-section-heading">
            <span className="settings-section-icon" aria-hidden="true">
              <BedDouble size={20} />
            </span>
            <div>
              <p className="eyebrow">Patient access</p>
              <h2 id="patient-access-title">Bedside care</h2>
              <p className="muted small">Choose how patients connect and ask for help.</p>
            </div>
          </div>
          <div className="settings-grid">
            <ChoiceSetting
              id="occupancy"
              title="Bed management"
              help="Choose whether staff admit and discharge patients, or patients simply scan the QR on their bed."
              legend="How patients use the bedside QR"
              busy={busy}
              value={hospital.bedOccupancyEnabled}
              status={hospital.bedOccupancyEnabled ? 'Admissions on' : 'QR codes only'}
              options={occupancyModes}
              onChoose={(enabled) => void chooseOccupancy(enabled)}
            />

            <ChoiceSetting
              id="patient-requests"
              title="Patient requests"
              help="Pause new requests for a while, for example during maintenance or a drill."
              legend="Whether patients can send new requests"
              busy={busy}
              value={hospital.patientRequestsPaused}
              status={hospital.patientRequestsPaused ? 'Paused' : 'Accepting requests'}
              warning={hospital.patientRequestsPaused}
              options={[
                {
                  value: false,
                  title: 'Accept new requests',
                  help: 'Patients send requests from the bedside QR as usual.',
                },
                {
                  value: true,
                  title: 'Pause new requests',
                  help: 'Patients still open their page and can follow or cancel their requests, but cannot send new ones. Staff see a reminder until you turn requests back on.',
                },
              ]}
              onChoose={(paused) =>
                void change(
                  { patientRequestsPaused: paused },
                  paused
                    ? 'New patient requests are paused. Patients are asked to tell a member of staff.'
                    : 'Patients can send requests again.',
                  paused ? pauseRequestsQuestion : undefined,
                )
              }
            />
          </div>
        </section>

        <section className="settings-section" aria-labelledby="workflow-settings-title">
          <div className="settings-section-heading">
            <span className="settings-section-icon" aria-hidden="true">
              <BellRing size={20} />
            </span>
            <div>
              <p className="eyebrow">Workflow and alerts</p>
              <h2 id="workflow-settings-title">Team notifications</h2>
              <p className="muted small">Control overdue escalation and staff bell updates.</p>
            </div>
          </div>
          <div className="settings-grid">
            <ChoiceSetting
              id="escalations"
              title="Escalations"
              help="Overdue requests escalate by each service's escalation policy (Response targets)."
              legend="Whether overdue requests are escalated"
              busy={busy}
              value={hospital.escalationsPaused}
              status={hospital.escalationsPaused ? 'Paused' : 'Running'}
              warning={hospital.escalationsPaused}
              options={[
                {
                  value: false,
                  title: 'Escalate overdue requests',
                  help: 'When a request misses its response target, the people in its escalation policy are told.',
                },
                {
                  value: true,
                  title: 'Pause escalations',
                  help: 'No request is escalated. When you turn escalations back on, requests that are still overdue escalate then.',
                },
              ]}
              onChoose={(paused) =>
                void change(
                  { escalationsPaused: paused },
                  paused ? 'Escalations are paused.' : 'Overdue requests escalate again.',
                  paused ? pauseEscalationsQuestion : undefined,
                )
              }
            />

            <section
              id="notifications-setting"
              className="card setting setting-wide"
              aria-labelledby="notifications-title"
            >
              <div className="setting-heading">
                <div>
                  <h3 id="notifications-title">Staff notifications</h3>
                  <p className="small muted">
                    Choose what arrives in the bell for the whole hospital. Each person controls
                    request sounds and desktop alerts on their Requests screen.
                  </p>
                </div>
                <span className="setting-status">
                  {notificationsOn.length} of {staffNotificationTypes.length} on
                </span>
              </div>
              <fieldset className="setting-checks" disabled={busy}>
                <legend className="visually-hidden">Notifications staff receive</legend>
                {staffNotificationTypes.map((type) => (
                  <label
                    key={type}
                    className={notificationsOn.includes(type) ? 'is-checked' : undefined}
                  >
                    <input
                      type="checkbox"
                      checked={notificationsOn.includes(type)}
                      onChange={(event) =>
                        setDraftOn(
                          event.target.checked
                            ? staffNotificationTypes.filter(
                                (kind) => kind === type || notificationsOn.includes(kind),
                              )
                            : notificationsOn.filter((kind) => kind !== type),
                        )
                      }
                    />
                    <span>
                      <strong>{notificationKinds[type].title}</strong>
                      <span className="muted small">{notificationKinds[type].who}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <div className="setting-actions">
                <p className="small muted" aria-live="polite">
                  {notificationsChanged
                    ? 'You have unsaved notification changes.'
                    : 'Notification choices are up to date.'}
                </p>
                <div className="actions">
                  <button
                    type="button"
                    disabled={busy || !notificationsChanged}
                    onClick={() =>
                      void change(
                        {
                          mutedNotificationTypes: staffNotificationTypes.filter(
                            (type) => !notificationsOn.includes(type),
                          ),
                        },
                        'Staff notifications saved.',
                      ).then((saved) => {
                        if (saved) setDraftOn(null);
                      })
                    }
                  >
                    Save notifications
                  </button>
                  {notificationsChanged && (
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() => setDraftOn(null)}
                    >
                      Undo changes
                    </button>
                  )}
                </div>
              </div>
            </section>
          </div>
        </section>

        <section className="settings-section" aria-labelledby="patient-page-settings-title">
          <div className="settings-section-heading">
            <span className="settings-section-icon" aria-hidden="true">
              <Languages size={20} />
            </span>
            <div>
              <p className="eyebrow">Patient experience</p>
              <h2 id="patient-page-settings-title">Patient page</h2>
              <p className="muted small">Choose the languages available at the bedside.</p>
            </div>
          </div>
          <section
            id="languages-setting"
            className="card setting setting-compact"
            aria-labelledby="languages-title"
          >
            <div className="setting-heading">
              <div>
                <h3 id="languages-title">Patient page languages</h3>
                <p className="small muted">
                  Patients can switch languages on their bedside page. English is always available.
                </p>
              </div>
              <span className="setting-status">
                {hospital.patientLanguages.length}{' '}
                {hospital.patientLanguages.length === 1 ? 'language' : 'languages'}
              </span>
            </div>
            <fieldset className="setting-checks setting-language-checks" disabled={busy}>
              <legend className="visually-hidden">Languages on the patient page</legend>
              <label className="is-checked is-required">
                <input type="checkbox" aria-label="English" checked disabled />
                <span>
                  <strong>English</strong>
                  <span className="muted small">Always available</span>
                </span>
              </label>
              <label className={hindi ? 'is-checked' : undefined}>
                <input
                  type="checkbox"
                  checked={hindi}
                  onChange={(event) =>
                    void change(
                      { patientLanguages: event.target.checked ? ['en', 'hi'] : ['en'] },
                      event.target.checked
                        ? 'Patients can choose Hindi.'
                        : 'The patient page is in English only.',
                    )
                  }
                />
                <span>
                  <strong lang="hi">हिन्दी (Hindi)</strong>
                  <span className="muted small">Optional</span>
                </span>
              </label>
            </fieldset>
          </section>
        </section>
      </div>
    </>
  );
}

// A setting with two choices, each with what it means.
function ChoiceSetting({
  id,
  title,
  help,
  legend,
  busy,
  value,
  status,
  warning = false,
  options,
  onChoose,
}: {
  id: string;
  title: string;
  help: string;
  legend: string;
  busy: boolean;
  value: boolean;
  status: string;
  warning?: boolean;
  options: { value: boolean; title: string; help: string }[];
  onChoose: (value: boolean) => void;
}) {
  return (
    <section id={`${id}-setting`} className="card setting" aria-labelledby={`${id}-title`}>
      <div className="setting-heading">
        <div>
          <h3 id={`${id}-title`}>{title}</h3>
          <p className="small muted">{help}</p>
        </div>
        <span className={`setting-status${warning ? ' is-warning' : ''}`}>{status}</span>
      </div>
      <fieldset className="size-picker" disabled={busy}>
        <legend className="visually-hidden">{legend}</legend>
        {options.map((option) => (
          <label key={option.title} className={value === option.value ? 'active' : ''}>
            <input
              type="radio"
              name={id}
              checked={value === option.value}
              onChange={() => {
                if (option.value !== value) onChoose(option.value);
              }}
            />
            <strong>{option.title}</strong>
            <span className="muted small">{option.help}</span>
          </label>
        ))}
      </fieldset>
    </section>
  );
}

// Who each kind of notification goes to (see the notifications module).
const notificationKinds: Record<StaffNotificationType, { title: string; who: string }> = {
  SUBMITTED: {
    title: 'New request needs assignment',
    who: 'To managers who assign work in that area.',
  },
  ASSIGNED: { title: 'Request assigned to you', who: 'To the person given the work.' },
  TRANSFERRED: { title: 'Request handed over to you', who: 'To the person who takes it over.' },
  COMPLETED: { title: 'Request ready to close', who: 'To managers who close requests.' },
  CANCELLED: {
    title: 'Request cancelled',
    who: 'To managers in that area and the person it was assigned to.',
  },
  REJECTED: {
    title: 'Request turned down',
    who: 'To managers, when the assigned person declines the work.',
  },
  ESCALATED: {
    title: 'Overdue request escalated',
    who: 'To the role or person named in the escalation policy.',
  },
};

const occupancyModes = [
  {
    value: true,
    title: 'Admit and discharge patients',
    help: 'Staff admit each patient in Bed management. A bed’s QR works only while a patient is admitted, and you see occupancy, free beds, and length of stay.',
  },
  {
    value: false,
    title: 'QR codes only',
    help: 'No admissions: a bed’s QR works as soon as it is on the bed, and beds are not shown as occupied. Bed management leaves the menu.',
  },
];

const turnOffAdmissions: ConfirmQuestion = {
  title: 'Use QR codes only?',
  message:
    'Patients will use a bed’s QR without being admitted, and beds will not show as occupied. Patients admitted now stay connected. Bed management leaves the menu.',
  confirmLabel: 'Use QR codes only',
};

const turnOnAdmissions: ConfirmQuestion = {
  title: 'Turn on admissions?',
  message:
    'A bed’s QR will work only after the patient is admitted in Bed management. Anyone connected through a QR now is disconnected until they are admitted.',
  confirmLabel: 'Turn on admissions',
  danger: true,
};

const pauseRequestsQuestion: ConfirmQuestion = {
  title: 'Pause patient requests?',
  message:
    'Patients will not be able to send new requests from their bedside QR. They are asked to tell a member of staff instead. Requests already sent continue as normal.',
  confirmLabel: 'Pause requests',
  danger: true,
};

const pauseEscalationsQuestion: ConfirmQuestion = {
  title: 'Pause escalations?',
  message:
    'Overdue requests will not be escalated to anyone until you turn escalations back on. Response targets still show as overdue.',
  confirmLabel: 'Pause escalations',
  danger: true,
};

function occupancyMessage(change: BedOccupancyChange): string {
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
  if (!change.enabled) {
    return change.releasedBeds > 0
      ? `QR codes only. ${plural(change.releasedBeds, 'bed')} no longer show as occupied; those patients stay connected.`
      : 'QR codes only. Patients can use a bed’s QR without being admitted.';
  }
  return change.revokedGuestSessions > 0
    ? `Admissions are on. ${plural(change.revokedGuestSessions, 'patient connection')} ended; admit patients in Bed management so they can use their QR.`
    : 'Admissions are on. Admit patients in Bed management so they can use their QR.';
}
