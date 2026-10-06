import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ApiError, credentials, guestApi } from '../api';
import { EmergencyNotice } from '../components';

// Opened from a printed QR code (/q/<token>). Exchanges the permanent QR token
// for a short-lived guest session, then replaces this URL so the QR token does
// not stay in the address bar or browser history.
export function ScanPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const started = useRef<{ key: string; promise: ReturnType<typeof guestApi.resolve> } | null>(
    null,
  );

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    // Share the in-flight operation across StrictMode's effect replay, but
    // resolve a different QR when the route token changes.
    const key = `${token}:${attempt}`;
    if (started.current?.key !== key) started.current = { key, promise: guestApi.resolve(token) };
    started.current.promise.then(
      (result) => {
        if (cancelled) return;
        credentials.setGuest(result.guestToken);
        void navigate('/patient', { replace: true });
      },
      (cause: unknown) => {
        if (cancelled) return;
        setError(
          cause instanceof ApiError && cause.status === 429
            ? 'Too many attempts. Please wait a minute and scan again.'
            : cause instanceof ApiError && (cause.status === 0 || cause.status >= 500)
              ? cause.message
              : 'This QR code is not active right now. Please ask a nurse or staff member for help.',
        );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [token, navigate, attempt]);

  return (
    <main className="patient">
      <header className="patient-header">
        <strong>CARE QR</strong>
      </header>
      <section className="card">
        {error ? (
          <>
            <h1>We couldn’t connect</h1>
            <p>{error}</p>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setError(null);
                setAttempt((value) => value + 1);
              }}
            >
              Try again
            </button>
          </>
        ) : (
          <p className="muted">Connecting to your bed…</p>
        )}
      </section>
      <EmergencyNotice />
    </main>
  );
}
