import { useId, useState, type FormEvent } from 'react';
import { staffApi } from '../../api';
import { ErrorNotice } from '../../components';

const minimumLength = 12;

// What is wrong with the new password, before anything is sent.
export function newPasswordProblem(input: {
  current: string;
  next: string;
  repeat: string;
}): string | null {
  if (!input.current) return 'Enter your current password.';
  if (input.next.length < minimumLength) {
    return `The new password needs at least ${minimumLength} characters.`;
  }
  if (input.next === input.current) return 'Choose a new password, not the current one.';
  if (input.next !== input.repeat) return 'The two new passwords do not match.';
  return null;
}

// Choose a new password. `forced` after an administrator's reset: the person
// must do this before anything else, using the temporary password they were
// given as the current one.
export function ChangePasswordForm({
  token,
  forced,
  onChanged,
  changePassword = staffApi.changePassword,
}: {
  token: string;
  forced: boolean;
  onChanged: () => void;
  changePassword?: (
    token: string,
    input: { currentPassword: string; newPassword: string },
  ) => Promise<unknown>;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hintId = useId();

  async function submit(event: FormEvent) {
    event.preventDefault();
    const problem = newPasswordProblem({ current, next, repeat });
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await changePassword(token, { currentPassword: current, newPassword: next });
      setCurrent('');
      setNext('');
      setRepeat('');
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not change the password.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="card create-form password-form"
      onSubmit={(event) => void submit(event)}
      noValidate
    >
      {error && <ErrorNotice message={error} onDismiss={() => setError(null)} />}
      <label>
        {forced ? 'Temporary password' : 'Current password'}
        <input
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
          required
        />
      </label>
      <label>
        New password
        <input
          type="password"
          autoComplete="new-password"
          minLength={minimumLength}
          aria-describedby={hintId}
          value={next}
          onChange={(event) => setNext(event.target.value)}
          required
        />
      </label>
      <small id={hintId} className="muted">
        At least {minimumLength} characters. A short sentence works well.
      </small>
      <label>
        New password again
        <input
          type="password"
          autoComplete="new-password"
          value={repeat}
          onChange={(event) => setRepeat(event.target.value)}
          required
        />
      </label>
      <button type="submit" disabled={busy}>
        {busy ? 'Saving…' : 'Change password'}
      </button>
    </form>
  );
}
