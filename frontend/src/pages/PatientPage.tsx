import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  ApiError,
  credentials,
  guestApi,
  type GuestLocation,
  type PublicCategory,
  type PublicRequest,
  type PublicRequestStatus,
} from '../api';
import { EmergencyNotice, ErrorNotice } from '../components';

type Language = 'en' | 'hi';
type State =
  | { kind: 'loading' }
  | {
      kind: 'ready';
      location: GuestLocation;
      categories: PublicCategory[];
      requests: PublicRequest[];
    }
  | { kind: 'error'; message: string }
  | { kind: 'ended' };

const activeStatuses: PublicRequestStatus[] = ['SUBMITTED', 'ASSIGNED', 'ACCEPTED', 'IN_PROGRESS'];
const cancellableStatuses: PublicRequestStatus[] = ['SUBMITTED', 'ASSIGNED'];
const languageKey = 'careqr.patientLanguage';

const copy = {
  en: {
    language: 'Language',
    scanAgain: 'Please scan the QR code on your bed to continue.',
    openScanner: 'Scan a QR code',
    noLogin:
      'No patient account or staff login is needed. Ask hospital staff for the bedside QR code if it is missing.',
    sessionEnded: 'Your session has ended.',
    loading: 'Loading your hospital services and requests…',
    tryAgain: 'Try again',
    dismiss: 'Dismiss',
    connected: 'You are connected to',
    services: 'Hospital services',
    servicesHelp: 'Choose a service to send a request to hospital staff.',
    processingNotice:
      'Requests go to a floor manager for manual assignment. Automatic routing and alerts are not active yet. For urgent help, tell hospital staff directly.',
    noServices: 'No services available yet',
    noServicesHelp:
      'The hospital has not published its service catalog. Please contact staff for assistance.',
    request: 'Request service',
    requesting: 'Sending…',
    viewRequest: 'View request',
    yourRequests: 'Your requests',
    requestsHelp:
      'Track requests from this bed stay. Status updates automatically while this page is open.',
    noRequests: 'No requests yet. Choose a service above to get started.',
    refresh: 'Refresh status',
    refreshing: 'Refreshing…',
    sent: 'Your request is ready to track below.',
    duplicate: 'An active request for this service already exists. Check your requests below.',
    uncertainSubmit:
      'We could not confirm whether your request was sent. Check your requests below before trying again.',
    submitFailed: 'We could not send the request. Please try again.',
    cancel: 'Cancel request',
    cancelQuestion: 'Cancel this request?',
    cancelWarning:
      'Hospital staff may already be responding. You can request the service again later if needed.',
    keepRequest: 'Keep request',
    confirmCancel: 'Yes, cancel request',
    cancelling: 'Cancelling…',
    cancelled: 'Your request was cancelled.',
    cancelChanged:
      'This request has changed and may no longer be cancellable. Please check its status.',
    cancelFailed: 'We could not cancel the request. Please check its status and try again.',
    submitted: 'Sent',
    reference: 'Reference',
    sessionUntil: 'This page stays connected until',
    requestStatus: {
      SUBMITTED: 'Submitted',
      ASSIGNED: 'Assigned',
      ACCEPTED: 'Accepted',
      IN_PROGRESS: 'In progress',
      COMPLETED: 'Completed',
      CLOSED: 'Closed',
      CANCELLED: 'Cancelled',
      REJECTED: 'Rejected',
    },
  },
  hi: {
    language: 'भाषा',
    scanAgain: 'जारी रखने के लिए अपने बिस्तर पर लगा QR कोड फिर से स्कैन करें।',
    openScanner: 'QR कोड स्कैन करें',
    noLogin:
      'मरीज के लिए खाता या कर्मचारी लॉगिन ज़रूरी नहीं है। बिस्तर पर QR कोड न हो तो अस्पताल के कर्मचारियों से पूछें।',
    sessionEnded: 'आपका सत्र समाप्त हो गया है।',
    loading: 'अस्पताल की सेवाएँ और अनुरोध लोड हो रहे हैं…',
    tryAgain: 'फिर कोशिश करें',
    dismiss: 'बंद करें',
    connected: 'आप यहाँ जुड़े हैं',
    services: 'अस्पताल की सेवाएँ',
    servicesHelp: 'अस्पताल के कर्मचारियों को अनुरोध भेजने के लिए सेवा चुनें।',
    processingNotice:
      'अनुरोध फ़्लोर मैनेजर को भेजा जाता है, जो इसे कर्मचारी को सौंपता है। अपने-आप सौंपने और सूचना भेजने की सुविधा अभी चालू नहीं है। तुरंत मदद के लिए सीधे अस्पताल के कर्मचारी को बताएँ।',
    noServices: 'अभी कोई सेवा उपलब्ध नहीं है',
    noServicesHelp:
      'अस्पताल ने अभी सेवाएँ प्रकाशित नहीं की हैं। मदद के लिए कर्मचारी से संपर्क करें।',
    request: 'सेवा का अनुरोध करें',
    requesting: 'भेजा जा रहा है…',
    viewRequest: 'अनुरोध देखें',
    yourRequests: 'आपके अनुरोध',
    requestsHelp:
      'इस बिस्तर पर रहने के दौरान भेजे गए अनुरोध देखें। पेज खुला रहने पर स्थिति अपने-आप अपडेट होती है।',
    noRequests: 'अभी कोई अनुरोध नहीं है। ऊपर से कोई सेवा चुनें।',
    refresh: 'स्थिति अपडेट करें',
    refreshing: 'अपडेट हो रहा है…',
    sent: 'आपका अनुरोध नीचे देखा जा सकता है।',
    duplicate: 'इस सेवा का एक सक्रिय अनुरोध पहले से है। नीचे अपने अनुरोध देखें।',
    uncertainSubmit:
      'अनुरोध भेजा गया या नहीं, इसकी पुष्टि नहीं हो सकी। दोबारा कोशिश करने से पहले नीचे अपने अनुरोध देखें।',
    submitFailed: 'अनुरोध नहीं भेजा जा सका। कृपया फिर कोशिश करें।',
    cancel: 'अनुरोध रद्द करें',
    cancelQuestion: 'क्या यह अनुरोध रद्द करना है?',
    cancelWarning:
      'अस्पताल के कर्मचारी जवाब देना शुरू कर चुके हो सकते हैं। ज़रूरत हो तो आप बाद में फिर अनुरोध कर सकते हैं।',
    keepRequest: 'अनुरोध बनाए रखें',
    confirmCancel: 'हाँ, अनुरोध रद्द करें',
    cancelling: 'रद्द हो रहा है…',
    cancelled: 'आपका अनुरोध रद्द कर दिया गया है।',
    cancelChanged:
      'इस अनुरोध की स्थिति बदल गई है और शायद इसे रद्द नहीं किया जा सकता। कृपया स्थिति देखें।',
    cancelFailed: 'अनुरोध रद्द नहीं हो सका। स्थिति देखें और फिर कोशिश करें।',
    submitted: 'भेजा गया',
    reference: 'संदर्भ संख्या',
    sessionUntil: 'यह पेज इस समय तक जुड़ा रहेगा',
    requestStatus: {
      SUBMITTED: 'भेजा गया',
      ASSIGNED: 'कर्मचारी नियुक्त',
      ACCEPTED: 'स्वीकार किया गया',
      IN_PROGRESS: 'काम जारी है',
      COMPLETED: 'पूरा हुआ',
      CLOSED: 'बंद',
      CANCELLED: 'रद्द',
      REJECTED: 'अस्वीकृत',
    },
  },
} as const;

function requestTime(value: string, language: Language): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString(language === 'hi' ? 'hi-IN' : 'en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
        // Hindi readers get a 24-hour clock instead of a Latin "am/pm".
        ...(language === 'hi' ? { hourCycle: 'h23' as const } : {}),
      });
}

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
    <ol className="request-progress" aria-label={labels[status]}>
      {progressSteps.map((step, index) => (
        <li
          key={step}
          className={[index <= current ? 'reached' : '', index === current ? 'now' : '']
            .filter(Boolean)
            .join(' ')}
          aria-current={index === current ? 'step' : undefined}
        >
          {labels[step]}
        </li>
      ))}
    </ol>
  );
}

function upsertRequest(requests: PublicRequest[], updated: PublicRequest): PublicRequest[] {
  return [updated, ...requests.filter((request) => request.publicId !== updated.publicId)].sort(
    (left, right) => Date.parse(right.submittedAt) - Date.parse(left.submittedAt),
  );
}

export function PatientPage() {
  const [guestToken] = useState(() => credentials.guest());
  const [language, setLanguage] = useState<Language>(() => {
    try {
      return sessionStorage.getItem(languageKey) === 'hi' ? 'hi' : 'en';
    } catch {
      return 'en';
    }
  });
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<State>(() =>
    guestToken ? { kind: 'loading' } : { kind: 'ended' },
  );
  const [busyServiceId, setBusyServiceId] = useState<string | null>(null);
  const [busyCancelId, setBusyCancelId] = useState<string | null>(null);
  const [cancelCandidate, setCancelCandidate] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(
    null,
  );
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const pending = useRef(false);
  const refreshGeneration = useRef(0);
  const t = copy[language];

  const endSession = useCallback(() => {
    refreshGeneration.current += 1;
    credentials.setGuest(null);
    setState({ kind: 'ended' });
  }, []);

  useEffect(() => {
    if (!guestToken) return;
    let cancelled = false;
    Promise.all([
      guestApi.session(guestToken),
      guestApi.services(guestToken),
      guestApi.requests(guestToken),
    ]).then(
      ([{ location }, categories, requests]) => {
        if (!cancelled) setState({ kind: 'ready', location, categories, requests });
      },
      (cause: unknown) => {
        if (cancelled) return;
        if (cause instanceof ApiError && cause.status === 401) {
          endSession();
        } else {
          setState({
            kind: 'error',
            message:
              cause instanceof Error ? cause.message : 'We couldn’t reach the hospital system.',
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [guestToken, attempt, endSession]);

  const expiresAt = state.kind === 'ready' ? state.location.expiresAt : null;
  useEffect(() => {
    if (!guestToken || !expiresAt) return;
    let cancelled = false;
    const end = () => {
      if (!cancelled) endSession();
    };
    // End expired credentials locally, and recheck revocation while this
    // page is open (including when a mobile browser becomes visible again).
    const expiration = window.setTimeout(end, Math.max(0, Date.parse(expiresAt) - Date.now()));
    const validate = () => {
      if (document.visibilityState === 'hidden') return;
      void guestApi.session(guestToken).catch((cause: unknown) => {
        if (cause instanceof ApiError && cause.status === 401) end();
      });
    };
    const interval = window.setInterval(validate, 30_000);
    document.addEventListener('visibilitychange', validate);
    return () => {
      cancelled = true;
      window.clearTimeout(expiration);
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', validate);
    };
  }, [guestToken, expiresAt, endSession]);

  const refreshRequests = useCallback(
    async (silent = false) => {
      if (!guestToken || pending.current) return;
      const generation = ++refreshGeneration.current;
      if (!silent) setRefreshing(true);
      try {
        const requests = await guestApi.requests(guestToken);
        if (generation !== refreshGeneration.current) return;
        setState((current) => (current.kind === 'ready' ? { ...current, requests } : current));
        setRefreshError(null);
      } catch (cause) {
        if (generation !== refreshGeneration.current) return;
        if (cause instanceof ApiError && cause.status === 401) {
          endSession();
        } else {
          setRefreshError(
            cause instanceof Error ? cause.message : 'Could not refresh request statuses.',
          );
        }
      } finally {
        if (generation === refreshGeneration.current) setRefreshing(false);
      }
    },
    [guestToken, endSession],
  );

  const ready = state.kind === 'ready';
  useEffect(() => {
    if (!ready) return;
    const refreshWhenVisible = () => {
      if (document.visibilityState !== 'hidden') void refreshRequests(true);
    };
    const interval = window.setInterval(refreshWhenVisible, 30_000);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [ready, refreshRequests]);

  async function submit(serviceId: string) {
    if (!guestToken || pending.current) return;
    pending.current = true;
    refreshGeneration.current += 1;
    setRefreshing(false);
    setBusyServiceId(serviceId);
    setFeedback(null);
    let shouldRefresh = false;
    try {
      const serviceRequest = await guestApi.submitRequest(guestToken, serviceId);
      setState((current) =>
        current.kind === 'ready'
          ? { ...current, requests: upsertRequest(current.requests, serviceRequest) }
          : current,
      );
      setFeedback({ kind: 'success', message: t.sent });
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        endSession();
      } else {
        shouldRefresh = true;
        setFeedback({
          kind: 'error',
          message:
            cause instanceof ApiError && cause.status === 409
              ? t.duplicate
              : cause instanceof ApiError && cause.status === 0
                ? t.uncertainSubmit
                : cause instanceof Error
                  ? cause.message
                  : t.submitFailed,
        });
      }
    } finally {
      pending.current = false;
      setBusyServiceId(null);
    }
    if (shouldRefresh) void refreshRequests(true);
  }

  async function cancel(publicId: string) {
    if (!guestToken || pending.current) return;
    pending.current = true;
    refreshGeneration.current += 1;
    setRefreshing(false);
    setBusyCancelId(publicId);
    setFeedback(null);
    let shouldRefresh = false;
    try {
      const serviceRequest = await guestApi.cancelRequest(
        guestToken,
        publicId,
        'Cancelled by patient',
      );
      setState((current) =>
        current.kind === 'ready'
          ? { ...current, requests: upsertRequest(current.requests, serviceRequest) }
          : current,
      );
      setCancelCandidate(null);
      setFeedback({ kind: 'success', message: t.cancelled });
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        endSession();
      } else {
        shouldRefresh = true;
        setFeedback({
          kind: 'error',
          message:
            cause instanceof ApiError && cause.status === 409
              ? t.cancelChanged
              : cause instanceof Error
                ? cause.message
                : t.cancelFailed,
        });
      }
    } finally {
      pending.current = false;
      setBusyCancelId(null);
    }
    if (shouldRefresh) void refreshRequests(true);
  }

  function changeLanguage(next: Language) {
    setLanguage(next);
    try {
      sessionStorage.setItem(languageKey, next);
    } catch {
      // The selected language still works for this page in private mode.
    }
  }

  return (
    <main className="patient" lang={language}>
      <header className="patient-header">
        <strong>CARE QR</strong>
        <label className="patient-language">
          <span>{t.language}</span>
          <select
            value={language}
            onChange={(event) => changeLanguage(event.target.value as Language)}
          >
            <option value="en">English</option>
            <option value="hi">हिन्दी</option>
          </select>
        </label>
      </header>

      {state.kind === 'loading' && (
        <p className="muted" role="status">
          {t.loading}
        </p>
      )}
      {state.kind === 'error' && (
        <section className="card">
          <ErrorNotice message={state.message} />
          <button
            type="button"
            onClick={() => {
              setState({ kind: 'loading' });
              setAttempt((value) => value + 1);
            }}
          >
            {t.tryAgain}
          </button>
        </section>
      )}

      {state.kind === 'ended' && (
        <section className="card">
          <p>
            {guestToken ? `${t.sessionEnded} ` : ''}
            {t.scanAgain}
          </p>
          <p className="small muted patient-access-help">{t.noLogin}</p>
          <Link className="button secondary" to="/">
            {t.openScanner}
          </Link>
        </section>
      )}

      {state.kind === 'ready' && (
        <>
          <section className="card bed-card">
            <p className="muted">{t.connected}</p>
            <h1>{state.location.bed.displayName}</h1>
            <p>
              {[state.location.room, state.location.ward, state.location.floor]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <p className="small muted">{state.location.hospitalName}</p>
          </section>
          <section aria-labelledby="services-heading">
            <h2 id="services-heading" className="section-title">
              {t.services}
            </h2>
            <p className="small muted patient-section-help">{t.servicesHelp}</p>
            <p className="notice notice-warning small patient-processing-notice" role="note">
              {t.processingNotice}
            </p>
          </section>
          {feedback &&
            (feedback.kind === 'error' ? (
              <ErrorNotice
                message={feedback.message}
                onDismiss={() => setFeedback(null)}
                dismissLabel={t.dismiss}
              />
            ) : (
              <p className="notice notice-success" role="status">
                {feedback.message}
              </p>
            ))}
          {state.categories.length === 0 && (
            <section className="card">
              <h2>{t.noServices}</h2>
              <p className="muted">{t.noServicesHelp}</p>
            </section>
          )}
          {state.categories.map((category) => (
            <section key={category.id} className="card service-group">
              <h2>{category.name}</h2>
              {category.description && <p className="muted small">{category.description}</p>}
              {category.emergencyNotice && <EmergencyNotice language={language} />}
              <div className="service-grid">
                {category.services.map((service) => {
                  const existing = state.requests.find(
                    (request) =>
                      request.serviceId === service.id && activeStatuses.includes(request.status),
                  );
                  return (
                    <div key={service.id} className="service-tile">
                      <strong>{service.name}</strong>
                      {service.description && <p className="muted small">{service.description}</p>}
                      {existing ? (
                        <a className="button secondary" href={`#request-${existing.publicId}`}>
                          {t.viewRequest}
                        </a>
                      ) : (
                        <button
                          type="button"
                          disabled={busyServiceId !== null || busyCancelId !== null}
                          onClick={() => void submit(service.id)}
                        >
                          {busyServiceId === service.id ? t.requesting : t.request}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
          <section className="patient-requests" aria-labelledby="requests-heading">
            <div className="patient-section-heading">
              <div>
                <h2 id="requests-heading" className="section-title">
                  {t.yourRequests}
                </h2>
                <p className="small muted patient-section-help">{t.requestsHelp}</p>
              </div>
              <button
                type="button"
                className="secondary"
                disabled={refreshing || busyServiceId !== null || busyCancelId !== null}
                onClick={() => void refreshRequests()}
              >
                {refreshing ? t.refreshing : t.refresh}
              </button>
            </div>
            {refreshError && (
              <ErrorNotice
                message={refreshError}
                onDismiss={() => setRefreshError(null)}
                dismissLabel={t.dismiss}
              />
            )}
            {state.requests.length === 0 ? (
              <div className="card">
                <p className="muted">{t.noRequests}</p>
              </div>
            ) : (
              <div className="request-list">
                {state.requests.map((request) => (
                  <article
                    className="card patient-request-card"
                    id={`request-${request.publicId}`}
                    key={request.publicId}
                  >
                    <div className="patient-request-title">
                      <h3>{request.serviceName}</h3>
                      <span className="badge">{t.requestStatus[request.status]}</span>
                    </div>
                    <RequestProgress status={request.status} labels={t.requestStatus} />
                    <dl className="patient-request-meta">
                      <div>
                        <dt>{t.reference}</dt>
                        <dd className="code">{request.publicId}</dd>
                      </div>
                      <div>
                        <dt>{t.submitted}</dt>
                        <dd>{requestTime(request.submittedAt, language)}</dd>
                      </div>
                    </dl>
                    {cancellableStatuses.includes(request.status) && (
                      <div className="patient-cancel-area">
                        {cancelCandidate === request.publicId ? (
                          <div className="patient-cancel-confirm">
                            <strong>{t.cancelQuestion}</strong>
                            <p className="small muted">{t.cancelWarning}</p>
                            <div className="actions">
                              <button
                                type="button"
                                className="secondary"
                                disabled={busyCancelId !== null}
                                onClick={() => setCancelCandidate(null)}
                              >
                                {t.keepRequest}
                              </button>
                              <button
                                type="button"
                                className="danger"
                                disabled={busyCancelId !== null}
                                onClick={() => void cancel(request.publicId)}
                              >
                                {busyCancelId === request.publicId ? t.cancelling : t.confirmCancel}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="secondary"
                            disabled={busyServiceId !== null || busyCancelId !== null}
                            onClick={() => setCancelCandidate(request.publicId)}
                          >
                            {t.cancel}
                          </button>
                        )}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
          <p className="small muted">
            {t.sessionUntil}{' '}
            {new Date(state.location.expiresAt).toLocaleTimeString(
              language === 'hi' ? 'hi-IN' : 'en-IN',
              {
                hour: '2-digit',
                minute: '2-digit',
                ...(language === 'hi' ? { hourCycle: 'h23' as const } : {}),
              },
            )}
            .
          </p>
        </>
      )}

      <EmergencyNotice language={language} />
    </main>
  );
}
