import { useEffect, useState } from 'react';
import { ApiError, credentials, guestApi, type GuestLocation } from '../api';
import { EmergencyNotice } from '../components';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; location: GuestLocation }
  | { kind: 'ended'; message: string };

const scanAgain = 'Please scan the QR code on your bed to continue.';

export function PatientPage() {
  const [guestToken] = useState(() => credentials.guest());
  const [state, setState] = useState<State>(() =>
    guestToken ? { kind: 'loading' } : { kind: 'ended', message: scanAgain },
  );

  useEffect(() => {
    if (!guestToken) return;
    let cancelled = false;
    guestApi.session(guestToken).then(
      ({ location }) => {
        if (!cancelled) setState({ kind: 'ready', location });
      },
      (cause: unknown) => {
        if (cancelled) return;
        if (cause instanceof ApiError && cause.status === 401) {
          credentials.setGuest(null);
          setState({ kind: 'ended', message: `Your session has ended. ${scanAgain}` });
        } else {
          setState({ kind: 'ended', message: 'We couldn’t reach the hospital system. Try again.' });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [guestToken]);

  return (
    <main className="patient">
      <header className="patient-header">
        <strong>CARE QR</strong>
        {state.kind === 'ready' && <span>{state.location.hospitalName}</span>}
      </header>

      {state.kind === 'loading' && <p className="muted">Loading…</p>}

      {state.kind === 'ended' && (
        <section className="card">
          <p>{state.message}</p>
        </section>
      )}

      {state.kind === 'ready' && (
        <>
          <section className="card bed-card">
            <p className="muted">You are connected to</p>
            <h1>{state.location.bed.displayName}</h1>
            <p>
              {[state.location.room, state.location.ward, state.location.floor]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </section>
          <section className="card">
            <h2>Request help</h2>
            <p className="muted">
              Requesting water, cleaning, nurse assistance, and other services will be available
              here soon.
            </p>
          </section>
          <p className="small muted">
            This page stays connected until{' '}
            {new Date(state.location.expiresAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
            .
          </p>
        </>
      )}

      <EmergencyNotice />
    </main>
  );
}
