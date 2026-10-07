import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { ApiError, credentials, platformApi } from '../../api';
import { BrandMark, ErrorNotice, PoweredBy } from '../../components';
import { emailMaxLength } from '../../lib/field-rules';

// Sign-in for the SaaS operator who manages client hospitals.
export function PlatformLoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { token } = await platformApi.login({ email: email.trim(), password });
      credentials.setPlatform(token);
      await navigate('/platform', { replace: true });
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.status !== 401
          ? cause.message
          : 'Sign-in failed. Check the email and password.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="center-page login-page platform-login">
      <section className="login-intro">
        <span className="brand">
          <BrandMark /> CARE QR Platform
        </span>
        <p className="eyebrow">For the CARE QR team</p>
        <h1>
          Onboard and manage
          <br />
          client hospitals.
        </h1>
        <p>
          Create a hospital with its logo and first Hospital Manager, then suspend or reactivate it
          when needed. Platform accounts never see patients or requests.
        </p>
      </section>
      <form className="card login" onSubmit={(event) => void submit(event)}>
        <span className="eyebrow">Platform access</span>
        <h2>Platform sign in</h2>
        {error && <ErrorNotice message={error} />}
        <fieldset disabled={busy}>
          <label>
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="username"
              maxLength={emailMaxLength}
              required
            />
          </label>
          <label>
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
        </fieldset>
        <button type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="small muted">
          Hospital staff sign in at the <Link to="/login">staff sign-in page</Link> with their
          hospital code.
        </p>
        <PoweredBy />
      </form>
    </main>
  );
}
