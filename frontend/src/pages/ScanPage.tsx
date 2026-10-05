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
  const started = useRef(false);

  useEffect(() => {
    // StrictMode runs effects twice in development; resolve the QR only once.
    if (started.current || !token) return;
    started.current = true;
    guestApi.resolve(token).then(
      (result) => {
        credentials.setGuest(result.guestToken);
        void navigate('/patient', { replace: true });
      },
      (cause: unknown) => {
        setError(
          cause instanceof ApiError && cause.status === 429
            ? 'Too many attempts. Please wait a minute and scan again.'
            : 'This QR code is not active right now. Please ask a nurse or staff member for help.',
        );
      },
    );
  }, [token, navigate]);

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
          </>
        ) : (
          <p className="muted">Connecting to your bed…</p>
        )}
      </section>
      <EmergencyNotice />
    </main>
  );
}
