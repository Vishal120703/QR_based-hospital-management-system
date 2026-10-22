import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { BedDouble, DoorOpen, Globe, Info, Layers, RefreshCw, TriangleAlert } from 'lucide-react';
import {
  ApiError,
  assetUrl,
  credentials,
  guestApi,
  type GuestLocation,
  type PublicCategory,
  type PublicRequest,
} from '../../api';
import bedsideArt from './bedside-qr.svg';
import { BrandMark, ErrorNotice, PoweredBy } from '../../components';
import { copy, languageKey, type Language } from './patient-copy';
import { PatientRequestCard } from './PatientRequestCard';
import { ServiceCategory } from './ServiceCategory';
import { useRefreshWhileOpen, useSessionExpiry } from './use-guest-session';

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

const languageNames: Record<Language, string> = { en: 'English', hi: 'हिन्दी' };

function upsertRequest(requests: PublicRequest[], updated: PublicRequest): PublicRequest[] {
  return [updated, ...requests.filter((request) => request.publicId !== updated.publicId)].sort(
    (left, right) => Date.parse(right.submittedAt) - Date.parse(left.submittedAt),
  );
}

export function PatientPage() {
  const [guestToken] = useState(() => credentials.guest());
  const [chosenLanguage, setLanguage] = useState<Language>(() => {
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
  // Categories the patient folded away, and request cards opened for details.
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const pending = useRef(false);
  const refreshGeneration = useRef(0);
  // The hospital chooses the languages patients may use; English is always one.
  const offered: Language[] = state.kind === 'ready' ? state.location.languages : ['en', 'hi'];
  const language: Language = offered.includes(chosenLanguage) ? chosenLanguage : 'en';
  const t = copy[language];
  // The hospital paused new requests; existing ones can still be followed.
  const paused = state.kind === 'ready' && state.location.requestsPaused;

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
  useSessionExpiry(guestToken, expiresAt, endSession);

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
  useRefreshWhileOpen(ready, refreshRequests);

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
      } else if (cause instanceof ApiError && cause.code === 'PATIENT_REQUESTS_PAUSED') {
        // Paused since the page opened: say so and stop offering requests.
        setState((current) =>
          current.kind === 'ready'
            ? { ...current, location: { ...current.location, requestsPaused: true } }
            : current,
        );
        setFeedback({ kind: 'error', message: `${t.paused} ${t.pausedHelp}` });
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

  function toggle(set: ReadonlySet<string>, id: string, open?: boolean): Set<string> {
    const next = new Set(set);
    if (open ?? !next.has(id)) next.add(id);
    else next.delete(id);
    return next;
  }

  const connected = state.kind === 'ready' ? state : null;

  return (
    <main className="patient patient-page" lang={language}>
      <header className="pp-header">
        {connected?.location.hospitalLogoUrl ? (
          <img
            className="pp-logo"
            src={assetUrl(connected.location.hospitalLogoUrl)}
            alt={connected.location.hospitalName}
          />
        ) : (
          <span className="pp-brand">
            <BrandMark />
            <strong>{connected?.location.hospitalName ?? 'CARE QR'}</strong>
          </span>
        )}
        {offered.length > 1 && (
          <label className="pp-language">
            <Globe size={20} aria-hidden="true" />
            <span>{t.language}</span>
            <select
              value={language}
              onChange={(event) => changeLanguage(event.target.value as Language)}
            >
              {offered.map((option) => (
                <option key={option} value={option}>
                  {languageNames[option]}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>

      {state.kind === 'loading' && (
        <p className="muted" role="status">
          {t.loading}
        </p>
      )}
      {state.kind === 'error' && (
        <section className="card pp-card">
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
        <section className="card pp-card">
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
          <section className="card pp-hero" aria-labelledby="bed-heading">
            <div className="pp-hero-copy">
              <p className="eyebrow">{t.connected}</p>
              <h1 id="bed-heading">{state.location.bed.displayName}</h1>
              <ul className="pp-place" aria-label={t.connected}>
                {state.location.room && (
                  <li>
                    <DoorOpen size={19} aria-hidden="true" />
                    <span className="visually-hidden">{t.room}: </span>
                    {state.location.room}
                  </li>
                )}
                <li>
                  <BedDouble size={19} aria-hidden="true" />
                  <span className="visually-hidden">{t.ward}: </span>
                  {state.location.ward}
                </li>
                <li>
                  <Layers size={19} aria-hidden="true" />
                  <span className="visually-hidden">{t.floor}: </span>
                  {state.location.floor}
                </li>
              </ul>
              <p className="pp-hospital">{state.location.hospitalName}</p>
            </div>
            <div className="pp-hero-art" aria-hidden="true">
              <img src={bedsideArt} alt="" />
              <span className="pp-bed-tag">{state.location.bed.displayName}</span>
            </div>
          </section>

          <section className="pp-section-head" aria-labelledby="services-heading">
            <h2 id="services-heading">{t.services}</h2>
            <p>{t.servicesHelp}</p>
          </section>
          <p className="pp-notice" role="note">
            <Info size={22} aria-hidden="true" />
            <span>{t.processingNotice}</span>
          </p>
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
          {paused && (
            <section className="card pp-card notice-warning" role="status">
              <h2>{t.paused}</h2>
              <p>{t.pausedHelp}</p>
            </section>
          )}
          {state.categories.length === 0 && (
            <section className="card pp-card">
              <h2>{t.noServices}</h2>
              <p className="muted">{t.noServicesHelp}</p>
            </section>
          )}
          {state.categories.map((category, index) => (
            <ServiceCategory
              key={category.id}
              category={category}
              index={index}
              t={t}
              requests={state.requests}
              isOpen={!folded.has(category.id)}
              busyServiceId={busyServiceId}
              busy={paused || busyServiceId !== null || busyCancelId !== null}
              onToggle={() => setFolded((current) => toggle(current, category.id))}
              onRequest={(serviceId) => void submit(serviceId)}
              onViewRequest={(publicId) => setOpened((current) => toggle(current, publicId, true))}
            />
          ))}

          <section className="pp-requests" aria-labelledby="requests-heading">
            <div className="pp-requests-head">
              <div className="pp-section-head">
                <h2 id="requests-heading">{t.yourRequests}</h2>
                <p>{t.requestsHelp}</p>
              </div>
              <button
                type="button"
                className="secondary pp-refresh"
                disabled={refreshing || busyServiceId !== null || busyCancelId !== null}
                onClick={() => void refreshRequests()}
              >
                <RefreshCw size={18} className={refreshing ? 'pp-spin' : ''} aria-hidden="true" />
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
              <div className="card pp-card pp-empty">
                <p className="muted">{t.noRequests}</p>
              </div>
            ) : (
              <div className="pp-request-list">
                {state.requests.map((request) => (
                  <PatientRequestCard
                    key={request.publicId}
                    request={request}
                    categories={state.categories}
                    t={t}
                    language={language}
                    isOpen={opened.has(request.publicId)}
                    confirming={cancelCandidate === request.publicId}
                    busyCancelId={busyCancelId}
                    busy={busyServiceId !== null || busyCancelId !== null}
                    onToggle={() => setOpened((current) => toggle(current, request.publicId))}
                    onAskCancel={() => setCancelCandidate(request.publicId)}
                    onKeep={() => setCancelCandidate(null)}
                    onConfirmCancel={() => void cancel(request.publicId)}
                  />
                ))}
              </div>
            )}
          </section>
          <p className="small muted pp-session-note">
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

      <p className="pp-emergency" role="note">
        <TriangleAlert size={26} aria-hidden="true" />
        <span>
          <strong>{t.emergencyTitle}</strong> {t.emergencyBody}
        </span>
      </p>
      <PoweredBy language={language} />
    </main>
  );
}
