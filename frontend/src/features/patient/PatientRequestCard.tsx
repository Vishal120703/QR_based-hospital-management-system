import { Check, ChevronRight, ConciergeBell } from 'lucide-react';
import { createElement } from 'react';
import { type PublicCategory, type PublicRequest, type PublicRequestStatus } from '../../api';
import { requestTime, type Language, type PatientText } from './patient-copy';
import { categoryLook, serviceIcon } from './patient-looks';

const cancellableStatuses: PublicRequestStatus[] = ['SUBMITTED', 'ASSIGNED'];

const progressSteps: PublicRequestStatus[] = [
  'SUBMITTED',
  'ASSIGNED',
  'ACCEPTED',
  'IN_PROGRESS',
  'COMPLETED',
];

// Shows how far a request has moved. Cancelled and rejected requests have no
// progress, so their status badge alone is shown.
function RequestProgress({
  status,
  labels,
}: {
  status: PublicRequestStatus;
  labels: Record<PublicRequestStatus, string>;
}) {
  const current = progressSteps.indexOf(status === 'CLOSED' ? 'COMPLETED' : status);
  if (current < 0) return null;
  return (
    <ol className="pp-steps" aria-label={labels[status]}>
      {progressSteps.map((step, index) => (
        <li
          key={step}
          className={[index <= current ? 'reached' : '', index === current ? 'now' : '']
            .filter(Boolean)
            .join(' ')}
          aria-current={index === current ? 'step' : undefined}
        >
          <span className="pp-step-dot" aria-hidden="true">
            {index <= current && <Check size={12} strokeWidth={3} />}
          </span>
          <span className="pp-step-label">{labels[step]}</span>
        </li>
      ))}
    </ol>
  );
}

// The times this request reached each step, oldest first.
function requestHistory(request: PublicRequest): { status: PublicRequestStatus; at: string }[] {
  const steps: [PublicRequestStatus, string | null | undefined][] = [
    ['SUBMITTED', request.submittedAt],
    ['ASSIGNED', request.assignedAt],
    ['ACCEPTED', request.acceptedAt],
    ['IN_PROGRESS', request.startedAt],
    ['COMPLETED', request.completedAt],
    ['CLOSED', request.closedAt],
    ['CANCELLED', request.cancelledAt],
    ['REJECTED', request.rejectedAt],
  ];
  return steps
    .filter((step): step is [PublicRequestStatus, string] => Boolean(step[1]))
    .map(([status, at]) => ({ status, at }));
}

// One of the patient's requests: what, when, its status and progress, and on
// opening, its history and (while still possible) a confirmed cancel.
export function PatientRequestCard({
  request,
  categories,
  t,
  language,
  isOpen,
  confirming,
  busyCancelId,
  busy,
  onToggle,
  onAskCancel,
  onKeep,
  onConfirmCancel,
}: {
  request: PublicRequest;
  // To show the same icon and colour as the service's category.
  categories: PublicCategory[];
  t: PatientText;
  language: Language;
  isOpen: boolean;
  // The patient chose Cancel and is being asked to confirm.
  confirming: boolean;
  // The request being cancelled right now, if any.
  busyCancelId: string | null;
  // A request or cancellation is in progress.
  busy: boolean;
  onToggle: () => void;
  onAskCancel: () => void;
  onKeep: () => void;
  onConfirmCancel: () => void;
}) {
  // Same icon and colour as the service's category above.
  const index = categories.findIndex((category) =>
    category.services.some((service) => service.id === request.serviceId),
  );
  const look = index >= 0 ? categoryLook(categories[index]!, index) : undefined;
  // One of the fixed icons in patient-looks.ts, never a new component.
  const icon = createElement(serviceIcon(request.serviceName, look?.icon ?? ConciergeBell), {
    size: 22,
  });
  const canCancel = cancellableStatuses.includes(request.status);
  return (
    <article
      className={`card pp-request${look ? ` pp-tone-${look.tone}` : ''}`}
      id={`request-${request.publicId}`}
    >
      <div className="pp-request-head">
        <span className="pp-icon" aria-hidden="true">
          {icon}
        </span>
        <div className="pp-request-name">
          <h3>{request.serviceName}</h3>
          <p>
            <span>{t.reference}</span> <span className="code">{request.publicId}</span>
          </p>
        </div>
        <div className="pp-request-sent">
          <span>{t.submitted}</span>
          <time dateTime={request.submittedAt}>{requestTime(request.submittedAt, language)}</time>
        </div>
        <span className={`pp-status pp-status-${request.status.toLowerCase()}`}>
          {t.requestStatus[request.status]}
        </span>
        <button
          type="button"
          className="pp-toggle"
          aria-expanded={isOpen}
          aria-controls={`details-${request.publicId}`}
          aria-label={isOpen ? t.hideDetails : t.showDetails}
          onClick={onToggle}
        >
          <ChevronRight size={20} aria-hidden="true" />
        </button>
      </div>
      <RequestProgress status={request.status} labels={t.requestStatus} />
      {isOpen && (
        <div className="pp-request-details" id={`details-${request.publicId}`}>
          <h4>{t.history}</h4>
          <ol className="pp-history">
            {requestHistory(request).map((step) => (
              <li key={step.status}>
                <span>{t.requestStatus[step.status]}</span>
                <time dateTime={step.at}>{requestTime(step.at, language)}</time>
              </li>
            ))}
          </ol>
          {canCancel &&
            (confirming ? (
              <div className="patient-cancel-confirm">
                <strong>{t.cancelQuestion}</strong>
                <p className="small muted">{t.cancelWarning}</p>
                <div className="actions">
                  <button
                    type="button"
                    className="secondary"
                    disabled={busyCancelId !== null}
                    onClick={onKeep}
                  >
                    {t.keepRequest}
                  </button>
                  <button
                    type="button"
                    className="danger"
                    disabled={busyCancelId !== null}
                    onClick={onConfirmCancel}
                  >
                    {busyCancelId === request.publicId ? t.cancelling : t.confirmCancel}
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="secondary" disabled={busy} onClick={onAskCancel}>
                {t.cancel}
              </button>
            ))}
        </div>
      )}
    </article>
  );
}
