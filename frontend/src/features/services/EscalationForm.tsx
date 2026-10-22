import { useRef, useState } from 'react';
import { ApiError, staffApi, type EscalationLevelInput, type Role } from '../../api';
import { ErrorNotice } from '../../components';
import { useAdmin } from '../workspace/AdminLayout';

interface LevelDraft {
  targetType: 'ASSIGNEE' | 'ROLE';
  afterMinutes: string;
  roleId: string;
}

function minutes(value: string, label: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`${label} must be a whole number of minutes.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 1440) {
    throw new Error(`${label} must be between 0 and 1440 minutes.`);
  }
  return parsed;
}

export function EscalationForm({
  roles,
  canReadRoles,
  onCreated,
}: {
  roles: Role[];
  canReadRoles: boolean;
  onCreated: () => void;
}) {
  const { token, reportError, reportSuccess } = useAdmin();
  const [name, setName] = useState('');
  const [levels, setLevels] = useState<LevelDraft[]>([
    { targetType: 'ASSIGNEE', afterMinutes: '0', roleId: '' },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const activeRoles = roles.filter((role) => role.active);

  const update = (index: number, patch: Partial<LevelDraft>) =>
    setLevels(
      levels.map((level, position) => (position === index ? { ...level, ...patch } : level)),
    );

  async function submit() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      if (!name.trim()) throw new Error('Enter a policy name.');
      const payload: EscalationLevelInput[] = levels.map((level, index) => {
        const afterMinutes = minutes(level.afterMinutes, `Level ${index + 1} delay`);
        if (level.targetType === 'ROLE') {
          if (!activeRoles.some((role) => role.id === level.roleId)) {
            throw new Error(`Choose an active role for level ${index + 1}.`);
          }
          return { targetType: 'ROLE', roleId: level.roleId, afterMinutes };
        }
        return { targetType: 'ASSIGNEE', afterMinutes };
      });
      if (
        payload.some(
          (level, index) =>
            index > 0 && level.afterMinutes <= (payload[index - 1]?.afterMinutes ?? -1),
        )
      ) {
        throw new Error('Each escalation level must start later than the previous level.');
      }
      const savedName = name.trim();
      await staffApi.createEscalationPolicy(token, { name: savedName, levels: payload });
      setName('');
      setLevels([{ targetType: 'ASSIGNEE', afterMinutes: '0', roleId: '' }]);
      onCreated();
      reportSuccess(`${savedName} was added.`);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) reportError(cause);
      else setError(cause instanceof Error ? cause.message : 'Something went wrong.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <form
      className="create-form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h3>Add escalation policy</h3>
      {error && <ErrorNotice message={error} onDismiss={() => setError(null)} />}
      <label>
        <span>Name</span>
        <input
          required
          maxLength={120}
          disabled={busy}
          value={name}
          placeholder="Ward escalation"
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      {levels.map((level, index) => (
        <div key={index} className="inline-form level-row">
          <span className="muted small">Level {index + 1}</span>
          <input
            className="minutes"
            type="number"
            min={0}
            max={1440}
            step={1}
            required
            disabled={busy}
            value={level.afterMinutes}
            aria-label={`Level ${index + 1} minutes after deadline`}
            onChange={(event) => update(index, { afterMinutes: event.target.value })}
          />
          <span className="small">min after →</span>
          <select
            disabled={busy}
            value={level.targetType}
            aria-label={`Level ${index + 1} target`}
            onChange={(event) =>
              update(index, { targetType: event.target.value === 'ROLE' ? 'ROLE' : 'ASSIGNEE' })
            }
          >
            <option value="ASSIGNEE">Re-alert assigned staff</option>
            <option value="ROLE" disabled={!canReadRoles || activeRoles.length === 0}>
              Notify a role
            </option>
          </select>
          {level.targetType === 'ROLE' && (
            <select
              required
              disabled={busy}
              value={level.roleId}
              aria-label={`Level ${index + 1} role`}
              onChange={(event) => update(index, { roleId: event.target.value })}
            >
              <option value="">Choose a role…</option>
              {activeRoles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          )}
          {levels.length > 1 && (
            <button
              type="button"
              disabled={busy}
              className="chip-remove"
              aria-label={`Remove level ${index + 1}`}
              onClick={() => setLevels(levels.filter((_, position) => position !== index))}
            >
              ×
            </button>
          )}
        </div>
      ))}
      <div className="actions">
        <button
          type="button"
          className="secondary"
          disabled={busy || levels.length >= 10}
          onClick={() =>
            setLevels([
              ...levels,
              {
                targetType: canReadRoles && activeRoles.length > 0 ? 'ROLE' : 'ASSIGNEE',
                afterMinutes: '',
                roleId: '',
              },
            ])
          }
        >
          Add level
        </button>
        <button type="submit" disabled={busy || !name.trim()}>
          {busy ? 'Saving…' : 'Save policy'}
        </button>
      </div>
      <p className="muted small">
        Delays count from the missed deadline. Each later level must have a larger delay.
      </p>
      {!canReadRoles && (
        <p className="muted small">
          Role notifications need role read access. You can configure reminders to the assigned
          staff.
        </p>
      )}
    </form>
  );
}
