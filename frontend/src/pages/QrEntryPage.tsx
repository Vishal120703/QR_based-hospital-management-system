import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import type { IScannerControls } from '@zxing/browser';
import { ApiError, credentials, guestApi } from '../api';
import { EmergencyNotice, ErrorNotice } from '../components';

type CameraState = 'idle' | 'starting' | 'scanning';

// Bedside QR codes contain this app's /q/<opaque-token> URL. Never send an
// arbitrary scanned URL to the browser or accept a token from another origin.
export function tokenFromQrLink(value: string, origin: string): string | null {
  try {
    const url = new URL(value.trim(), origin);
    if (url.origin !== origin || url.search || url.hash) return null;
    return /^\/q\/([A-Za-z0-9_-]{43})\/?$/.exec(url.pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

export function QrEntryPage() {
  const navigate = useNavigate();
  const [link, setLink] = useState('');
  const [cameraState, setCameraState] = useState<CameraState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const cameraRun = useRef(0);
  const pending = useRef(false);
  const hasGuestSession = Boolean(credentials.guest());

  useEffect(
    () => () => {
      cameraRun.current += 1;
      controlsRef.current?.stop();
      controlsRef.current = null;
    },
    [],
  );

  function stopCamera() {
    cameraRun.current += 1;
    controlsRef.current?.stop();
    controlsRef.current = null;
    setCameraState('idle');
  }

  async function connect(scanned: string) {
    if (pending.current) return;
    setError(null);
    const token = tokenFromQrLink(scanned, window.location.origin);
    setLink('');
    if (!token) {
      setError('This is not a CARE QR link for this website. Ask staff for the bedside QR code.');
      return;
    }

    pending.current = true;
    setBusy(true);
    try {
      const { guestToken } = await guestApi.resolve(token);
      credentials.setGuest(guestToken);
      await navigate('/patient', { replace: true });
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.status === 429
          ? 'Too many scans. Please wait a minute and try again.'
          : cause instanceof ApiError && (cause.status === 0 || cause.status >= 500)
            ? cause.message
            : 'This QR code is not active for a current bed stay. Please ask hospital staff for help.',
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function startCamera() {
    if (cameraState !== 'idle' || busy) return;
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        'Camera scanning is unavailable here. Use your phone camera to open the bedside QR, or paste its link below. On another device, in-app camera access needs HTTPS.',
      );
      return;
    }

    setCameraState('starting');
    const run = ++cameraRun.current;
    try {
      const { BrowserQRCodeReader } = await import('@zxing/browser');
      if (run !== cameraRun.current) return;
      const reader = new BrowserQRCodeReader();
      const controls = await reader.decodeFromConstraints(
        { audio: false, video: { facingMode: { ideal: 'environment' } } },
        videoRef.current ?? undefined,
        (result, _error, currentControls) => {
          if (!result || run !== cameraRun.current || pending.current) return;
          currentControls.stop();
          controlsRef.current = null;
          cameraRun.current += 1;
          setCameraState('idle');
          void connect(result.getText());
        },
      );
      if (run !== cameraRun.current) {
        controls.stop();
        return;
      }
      controlsRef.current = controls;
      setCameraState('scanning');
    } catch {
      if (run !== cameraRun.current) return;
      setCameraState('idle');
      setError('The camera could not start. Allow camera access, or use the QR link below.');
    }
  }

  async function scanPhoto(file: File) {
    if (pending.current) return;
    stopCamera();
    setError(null);
    setBusy(true);
    const imageUrl = URL.createObjectURL(file);
    try {
      const { BrowserQRCodeReader } = await import('@zxing/browser');
      const result = await new BrowserQRCodeReader().decodeFromImageUrl(imageUrl);
      await connect(result.getText());
    } catch {
      setError('No readable QR code was found in that photo. Try again closer to the bedside QR.');
    } finally {
      URL.revokeObjectURL(imageUrl);
      setBusy(false);
    }
  }

  function submitLink(event: FormEvent) {
    event.preventDefault();
    stopCamera();
    void connect(link);
  }

  return (
    <main className="patient qr-entry">
      <header className="patient-header">
        <strong>CARE QR</strong>
        <Link to={credentials.staff() ? '/admin' : '/login'}>Staff sign in</Link>
      </header>
      <section className="card qr-entry-intro">
        <p className="eyebrow">For patients and attendants</p>
        <h1>Scan your bedside QR</h1>
        <p>
          Scan the code placed at your bed to request a hospital service and track its status. No
          patient login is needed.
        </p>
        {hasGuestSession && (
          <Link className="button secondary" to="/patient">
            Continue your current requests
          </Link>
        )}
      </section>
      <section className="card qr-entry-scanner" aria-labelledby="scan-heading">
        <h2 id="scan-heading">Scan QR</h2>
        <p className="muted small">
          Point your camera at the bedside QR. You can also scan it with your phone’s Camera app;
          its link will open this patient page directly.
        </p>
        {error && <ErrorNotice message={error} onDismiss={() => setError(null)} />}
        <div className={`qr-camera ${cameraState === 'idle' ? 'qr-camera-idle' : ''}`}>
          <video ref={videoRef} autoPlay playsInline muted aria-label="QR scanner camera preview" />
          {cameraState === 'idle' && <span>Camera preview appears here</span>}
          {cameraState === 'starting' && <span>Starting camera…</span>}
        </div>
        {cameraState === 'idle' ? (
          <button type="button" disabled={busy} onClick={() => void startCamera()}>
            Start camera
          </button>
        ) : (
          <button type="button" className="secondary" onClick={stopCamera}>
            Stop camera
          </button>
        )}
        <label className="qr-photo-input">
          <span>Or take / choose a QR photo</span>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            disabled={busy}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (file) void scanPhoto(file);
            }}
          />
          <small className="muted">The photo is read on this device; it is not uploaded.</small>
        </label>
        <form className="qr-entry-link" onSubmit={submitLink}>
          <label>
            <span>Or paste the bedside QR link</span>
            <input
              type="text"
              value={link}
              onChange={(event) => setLink(event.target.value)}
              placeholder="https://your-hospital.example/q/…"
              autoComplete="off"
              spellCheck={false}
              required
            />
          </label>
          <button type="submit" className="secondary" disabled={busy}>
            {busy ? 'Connecting…' : 'Open patient page'}
          </button>
        </form>
      </section>
      <EmergencyNotice />
    </main>
  );
}
