import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { ApiError, credentials, staffApi } from '../api';
import { ErrorNotice } from '../components';

export function LoginPage() {
  const navigate = useNavigate();
  const [hospitalCode, setHospitalCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { token } = await staffApi.login({
        hospitalCode: hospitalCode.trim(),
        email: email.trim(),
        password,
      });
      credentials.setStaff(token);
      await navigate('/admin', { replace: true });
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.status !== 401
          ? cause.message
          : 'Sign-in failed. Check the hospital code, email, and password.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="center-page login-page">
      <section className="login-intro">
        <span className="brand">
          <span className="brand-mark" aria-hidden="true">
            +
          </span>{' '}
          CARE QR
        </span>
        <p className="eyebrow">Hospital service workspace</p>
        <h1>
          A clearer way to
          <br />
          coordinate care.
        </h1>
        <p>
          One place to set up care locations, manage staff coverage, and configure the services
          patients see.
        </p>
        <div className="login-feature">
          <span>01</span>
          <div>
            <strong>Prepare your hospital</strong>
            <p>Locations, beds, and secure QR sessions.</p>
          </div>
        </div>
        <div className="login-feature">
          <span>02</span>
          <div>
            <strong>Connect your team</strong>
            <p>Departments, duty, and location coverage.</p>
          </div>
        </div>
        <div className="login-feature">
          <span>03</span>
          <div>
            <strong>Define your services</strong>
            <p>Patient catalog and response-time targets.</p>
          </div>
        </div>
      </section>
      <form className="card login" onSubmit={(event) => void submit(event)}>
        <span className="eyebrow">Staff access</span>
        <h2>Welcome back</h2>
        <p className="muted">Sign in to your hospital workspace.</p>
        {error && <ErrorNotice message={error} />}
        <fieldset disabled={busy}>
          <label>
            <span>Hospital code</span>
            <input
              value={hospitalCode}
              onChange={(event) => setHospitalCode(event.target.value)}
              autoComplete="organization"
              placeholder="Your hospital code"
              required
            />
          </label>
          <label>
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="username"
              placeholder="you@hospital.com"
              required
            />
          </label>
          <label>
            <span>Password</span>
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <button
            type="button"
            className="link password-toggle"
            aria-pressed={showPassword}
            onClick={() => setShowPassword((value) => !value)}
          >
            {showPassword ? 'Hide password' : 'Show password'}
          </button>
        </fieldset>
        <button type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="small muted">
          Use the hospital code and staff account provided by your administrator. Patients should
          scan their bedside QR code.
        </p>
      </form>
    </main>
  );
}
