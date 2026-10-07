import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  Accessibility,
  Baby,
  Bath,
  BedDouble,
  Brush,
  Check,
  ChevronRight,
  Coffee,
  ConciergeBell,
  DoorOpen,
  Droplet,
  Ellipsis,
  GlassWater,
  Globe,
  HeartPulse,
  Info,
  Layers,
  Pill,
  Plus,
  Receipt,
  RefreshCw,
  Salad,
  Sparkles,
  Stethoscope,
  Thermometer,
  TriangleAlert,
  Utensils,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import {
  ApiError,
  assetUrl,
  credentials,
  guestApi,
  type GuestLocation,
  type PublicCategory,
  type PublicRequest,
  type PublicRequestStatus,
} from '../api';
import bedsideArt from '../bedside-qr.svg';
import { ErrorNotice } from '../components';

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
    room: 'Room',
    ward: 'Ward',
    floor: 'Floor',
    requestFor: (name: string) => `Request ${name}`,
    viewRequestFor: (name: string) => `View request for ${name}`,
    serviceCount: (count: number) => (count === 1 ? '1 service' : `${count} services`),
    showServices: (name: string) => `Show ${name} services`,
    hideServices: (name: string) => `Hide ${name} services`,
    showDetails: 'Show request details',
    hideDetails: 'Hide request details',
    urgentHint: 'Urgent? Press the nurse-call button or call any staff member.',
    emergencyTitle: 'Not for emergencies.',
    emergencyBody:
      'In a medical emergency, press the nurse-call button or tell any staff member immediately.',
    history: 'What happened',
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
    room: 'कमरा',
    ward: 'वार्ड',
    floor: 'मंज़िल',
    requestFor: (name: string) => `${name} का अनुरोध करें`,
    viewRequestFor: (name: string) => `${name} का अनुरोध देखें`,
    serviceCount: (count: number) => (count === 1 ? '1 सेवा' : `${count} सेवाएँ`),
    showServices: (name: string) => `${name} सेवाएँ दिखाएँ`,
    hideServices: (name: string) => `${name} सेवाएँ छिपाएँ`,
    showDetails: 'अनुरोध का विवरण देखें',
    hideDetails: 'अनुरोध का विवरण छिपाएँ',
    urgentHint: 'तुरंत मदद चाहिए? नर्स-कॉल बटन दबाएँ या किसी भी कर्मचारी को बुलाएँ।',
    emergencyTitle: 'आपातकाल के लिए नहीं।',
    emergencyBody: 'चिकित्सा आपातकाल में नर्स-कॉल बटन दबाएँ या तुरंत किसी कर्मचारी को बताएँ।',
    history: 'अब तक क्या हुआ',
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

type Tone = 'blue' | 'rose' | 'green' | 'violet' | 'amber' | 'teal';
const tones: Tone[] = ['blue', 'rose', 'green', 'violet', 'amber', 'teal'];

// Services and categories are named by each hospital, so icons and colours
// are chosen from common words in the name, with a neutral fallback.
const categoryLooks: { match: RegExp; icon: LucideIcon; tone: Tone }[] = [
  { match: /water|food|meal|diet|drink|pantry|kitchen|canteen/i, icon: GlassWater, tone: 'blue' },
  { match: /nurs|medic|doctor|health|clinical|pain/i, icon: HeartPulse, tone: 'rose' },
  { match: /clean|room|housekeep|laundry|linen|hygiene/i, icon: Sparkles, tone: 'green' },
  { match: /assist|mobility|wheel|transport|porter|help/i, icon: Accessibility, tone: 'violet' },
  { match: /maint|repair|electric|plumb|light|fan|\bac\b/i, icon: Wrench, tone: 'amber' },
  { match: /bill|pay|insurance|discharge|account/i, icon: Receipt, tone: 'teal' },
];

const serviceIcons: { match: RegExp; icon: LucideIcon }[] = [
  { match: /water|drink/i, icon: Droplet },
  { match: /diet|salad|fruit/i, icon: Salad },
  { match: /tea|coffee/i, icon: Coffee },
  { match: /food|meal|breakfast|lunch|dinner|snack/i, icon: Utensils },
  { match: /nurse|doctor|check/i, icon: Stethoscope },
  { match: /medicine|pill|tablet|drug/i, icon: Pill },
  { match: /pain|fever|temperature/i, icon: Thermometer },
  { match: /linen|sheet|blanket|pillow|bed/i, icon: BedDouble },
  { match: /toilet|bath|wash|shower/i, icon: Bath },
  { match: /clean|sweep|mop|dust/i, icon: Brush },
  { match: /wheel|chair|mobility|transport|stretcher|walk/i, icon: Accessibility },
  { match: /repair|light|fan|electric|plumb|\bac\b|tv/i, icon: Wrench },
  { match: /bill|pay/i, icon: Receipt },
  { match: /baby|infant|feed/i, icon: Baby },
  { match: /other|misc/i, icon: Ellipsis },
];

function categoryLook(category: PublicCategory, index: number) {
  const text = `${category.name} ${category.description ?? ''}`;
  const found = categoryLooks.find((look) => look.match.test(text));
  return found ?? { icon: ConciergeBell, tone: tones[index % tones.length]! };
}

function serviceIcon(name: string, fallback: LucideIcon): LucideIcon {
  return serviceIcons.find((look) => look.match.test(name))?.icon ?? fallback;
}

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
  // Categories the patient folded away, and request cards opened for details.
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
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
            <span className="brand-mark" aria-hidden="true">
              +
            </span>
            <strong>{connected?.location.hospitalName ?? 'CARE QR'}</strong>
          </span>
        )}
        <label className="pp-language">
          <Globe size={20} aria-hidden="true" />
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
          {state.categories.length === 0 && (
            <section className="card pp-card">
              <h2>{t.noServices}</h2>
              <p className="muted">{t.noServicesHelp}</p>
            </section>
          )}
          {state.categories.map((category, index) => {
            const look = categoryLook(category, index);
            const CategoryIcon = look.icon;
            const isOpen = !folded.has(category.id);
            return (
              <section
                key={category.id}
                className={`pp-category pp-tone-${look.tone}`}
                aria-labelledby={`category-${category.id}`}
              >
                <button
                  type="button"
                  className="pp-category-head"
                  aria-expanded={isOpen}
                  aria-controls={`services-${category.id}`}
                  aria-label={
                    isOpen ? t.hideServices(category.name) : t.showServices(category.name)
                  }
                  onClick={() => setFolded((current) => toggle(current, category.id))}
                >
                  <span className="pp-icon pp-icon-large" aria-hidden="true">
                    <CategoryIcon size={30} />
                  </span>
                  <span className="pp-category-text">
                    <strong id={`category-${category.id}`}>{category.name}</strong>
                    <span>{category.description ?? t.serviceCount(category.services.length)}</span>
                  </span>
                  <ChevronRight className="pp-chevron" size={22} aria-hidden="true" />
                </button>
                {isOpen && (
                  <div className="pp-services" id={`services-${category.id}`}>
                    {category.emergencyNotice && (
                      <p className="pp-urgent">
                        <TriangleAlert size={16} aria-hidden="true" />
                        {t.urgentHint}
                      </p>
                    )}
                    {category.services.map((service) => {
                      const Icon = serviceIcon(service.name, CategoryIcon);
                      const existing = state.requests.find(
                        (request) =>
                          request.serviceId === service.id &&
                          activeStatuses.includes(request.status),
                      );
                      const body = (
                        <>
                          <span className="pp-icon" aria-hidden="true">
                            <Icon size={22} />
                          </span>
                          <span className="pp-service-text">
                            <strong>{service.name}</strong>
                            {busyServiceId === service.id ? (
                              <small>{t.requesting}</small>
                            ) : (
                              service.description && <small>{service.description}</small>
                            )}
                          </span>
                        </>
                      );
                      return existing ? (
                        <a
                          key={service.id}
                          className="pp-service pp-service-active"
                          href={`#request-${existing.publicId}`}
                          aria-label={t.viewRequestFor(service.name)}
                          onClick={() =>
                            setOpened((current) => toggle(current, existing.publicId, true))
                          }
                        >
                          {body}
                          <span className={`pp-status pp-status-${existing.status.toLowerCase()}`}>
                            {t.requestStatus[existing.status]}
                          </span>
                        </a>
                      ) : (
                        <button
                          key={service.id}
                          type="button"
                          className="pp-service"
                          aria-label={t.requestFor(service.name)}
                          disabled={busyServiceId !== null || busyCancelId !== null}
                          onClick={() => void submit(service.id)}
                        >
                          {body}
                          <span className="pp-add" aria-hidden="true">
                            <Plus size={18} strokeWidth={2.5} />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}

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
                {state.requests.map((request) => {
                  // Same icon and colour as the service's category above.
                  const index = state.categories.findIndex((category) =>
                    category.services.some((service) => service.id === request.serviceId),
                  );
                  const look =
                    index >= 0 ? categoryLook(state.categories[index]!, index) : undefined;
                  const Icon = serviceIcon(request.serviceName, look?.icon ?? ConciergeBell);
                  const isOpen = opened.has(request.publicId);
                  const canCancel = cancellableStatuses.includes(request.status);
                  return (
                    <article
                      className={`card pp-request${look ? ` pp-tone-${look.tone}` : ''}`}
                      id={`request-${request.publicId}`}
                      key={request.publicId}
                    >
                      <div className="pp-request-head">
                        <span className="pp-icon" aria-hidden="true">
                          <Icon size={22} />
                        </span>
                        <div className="pp-request-name">
                          <h3>{request.serviceName}</h3>
                          <p>
                            <span>{t.reference}</span>{' '}
                            <span className="code">{request.publicId}</span>
                          </p>
                        </div>
                        <div className="pp-request-sent">
                          <span>{t.submitted}</span>
                          <time dateTime={request.submittedAt}>
                            {requestTime(request.submittedAt, language)}
                          </time>
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
                          onClick={() => setOpened((current) => toggle(current, request.publicId))}
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
                            (cancelCandidate === request.publicId ? (
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
                                    {busyCancelId === request.publicId
                                      ? t.cancelling
                                      : t.confirmCancel}
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
                            ))}
                        </div>
                      )}
                    </article>
                  );
                })}
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
    </main>
  );
}
