import { useCallback, useRef, useState } from 'react';
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
  const { token, reportError, reportSuccess, refreshMe } = useAdmin();
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
        description="Choose how your hospital works with CARE QR. Each change applies to everyone in the hospital straight away and is kept in the audit log."
      />
      <LoadState loading={false} error={loadError} onRetry={reload} />
      <div className="settings-list">
        <ChoiceSetting
          id="occupancy"
          title="Bed management"
          help="Choose whether staff admit and discharge patients, or patients simply scan the QR on their bed."
          legend="How patients use the bedside QR"
          busy={busy}
          value={hospital.bedOccupancyEnabled}
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

        <ChoiceSetting
          id="escalations"
          title="Escalations"
          help="Overdue requests escalate by each service's escalation policy (Response targets)."
          legend="Whether overdue requests are escalated"
          busy={busy}
          value={hospital.escalationsPaused}
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

        <section className="card setting" aria-labelledby="notifications-title">
          <h2 id="notifications-title">Staff notifications</h2>
          <p className="small muted">
            What arrives in the bell for the whole hospital. The Requests badge, sound, and desktop
            alerts are set by each person on the Requests screen.
          </p>
          <fieldset className="setting-checks" disabled={busy}>
            <legend className="visually-hidden">Notifications staff receive</legend>
            {staffNotificationTypes.map((type) => (
              <label key={type}>
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
        </section>

        <section className="card setting" aria-labelledby="languages-title">
          <h2 id="languages-title">Patient page languages</h2>
          <p className="small muted">
            The languages patients can choose on their bedside page. English is always offered.
          </p>
          <fieldset className="setting-checks" disabled={busy}>
            <legend className="visually-hidden">Languages on the patient page</legend>
            <label>
              <input type="checkbox" checked disabled />
              <span>
                <strong>English</strong>
              </span>
            </label>
            <label>
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
              </span>
            </label>
          </fieldset>
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
  options,
  onChoose,
}: {
  id: string;
  title: string;
  help: string;
  legend: string;
  busy: boolean;
  value: boolean;
  options: { value: boolean; title: string; help: string }[];
  onChoose: (value: boolean) => void;
}) {
  return (
    <section className="card setting" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{title}</h2>
      <p className="small muted">{help}</p>
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
