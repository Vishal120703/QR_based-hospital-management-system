import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { credentials, staffApi } from '../api';
import { ErrorNotice } from '../components';

export function LoginPage() {
  const navigate = useNavigate();
  const [hospitalCode, setHospitalCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { token } = await staffApi.login({ hospitalCode, email, password });
      credentials.setStaff(token);
      await navigate('/admin/beds', { replace: true });
    } catch {
      setError('Sign-in failed. Check the hospital code, email, and password.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="center-page">
      <form className="card login" onSubmit={(event) => void submit(event)}>
        <h1>CARE QR</h1>
        <p className="muted">Staff sign-in</p>
        {error && <ErrorNotice message={error} />}
        <label>
          <span>Hospital code</span>
          <input
            value={hospitalCode}
            onChange={(event) => setHospitalCode(event.target.value)}
            autoComplete="organization"
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
        <button type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
