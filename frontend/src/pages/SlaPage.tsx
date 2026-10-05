import { useEffect, useState } from 'react';
import {
  ApiError,
  staffApi,
  type EscalationLevelInput,
  type EscalationPolicy,
  type Role,
  type SlaPolicy,
} from '../api';
import { CreateForm, ErrorNotice } from '../components';
import { useAdmin } from './AdminLayout';

interface Policies {
  sla: SlaPolicy[];
  escalation: EscalationPolicy[];
  roles: Role[];
}

async function loadPolicies(token: string, canReadRoles: boolean): Promise<Policies> {
  const [sla, escalation, roles] = await Promise.all([
    staffApi.list<SlaPolicy>(token, 'sla-policies'),
    staffApi.list<EscalationPolicy>(token, 'escalation-policies'),
    canReadRoles ? staffApi.list<Role>(token, 'roles') : Promise.resolve([]),
  ]);
  return { sla, escalation, roles };
}

const minutes = (value: string | undefined) => Number.parseInt(value ?? '', 10);

export function SlaPage() {
  const { token, me, reportError } = useAdmin();
  const [policies, setPolicies] = useState<Policies | null>(null);
  const [version, setVersion] = useState(0);
  const canManage = me.permissions.includes('sla.manage');
  const canReadRoles = me.permissions.includes('role.read');

  useEffect(() => {
    let cancelled = false;
    loadPolicies(token, canReadRoles).then(
      (result) => {
        if (!cancelled) setPolicies(result);
      },
      (cause: unknown) => {
        if (!cancelled) reportError(cause);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [token, version, canReadRoles, reportError]);

  const reload = () => setVersion((value) => value + 1);

  if (!policies) {
    return <p className="muted">Loading policies…</p>;
  }

  const roleName = (id: string | null) =>
    policies.roles.find((role) => role.id === id)?.name ?? 'a role';

  return (
    <>
      <h1>SLA &amp; escalation</h1>
      <p className="muted">
        Both times count from when the patient submits. Editing a policy saves a new version: open
        requests keep the version they started with.
      </p>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>SLA policy</th>
              <th>Version</th>
              <th>Accept within</th>
              <th>Complete within</th>
              <th>History</th>
            </tr>
          </thead>
          <tbody>
            {policies.sla.map((policy) => (
              <SlaRow
                key={`${policy.id}:${policy.currentVersion}`}
                policy={policy}
                canManage={canManage}
                onSaved={reload}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="split catalog-forms">
        <section className="card">
          <h2>Escalation policies</h2>
          <p className="muted small">
            What happens after a deadline is missed. Escalations start running in a later update;
            here you configure them.
          </p>
          {policies.escalation.length === 0 && <p className="muted">No escalation policies yet.</p>}
          {policies.escalation.map((policy) => (
            <div key={policy.id} className="escalation">
              <div className="escalation-header">
                <strong>{policy.name}</strong>
                {canManage && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      void staffApi
                        .deleteEscalationPolicy(token, policy.id)
                        .then(reload, reportError)
                    }
                  >
                    Delete
                  </button>
                )}
              </div>
              <ol>
                {policy.levels.map((level) => (
                  <li key={level.level}>
                    {level.afterMinutes === 0
                      ? 'At the deadline'
                      : `${level.afterMinutes} min after`}
                    :{' '}
                    {level.targetType === 'ASSIGNEE'
                      ? 're-alert the assigned staff'
                      : `notify ${roleName(level.roleId)}`}
                  </li>
                ))}
              </ol>
            </div>
          ))}
          {canManage && <EscalationForm roles={policies.roles} onCreated={reload} />}
        </section>

        {canManage && (
          <section className="card">
            <h2>Add SLA policy</h2>
            <CreateForm
              submitLabel="Add SLA policy"
              onError={reportError}
              fields={() => [
                { name: 'name', label: 'Name', placeholder: 'Overnight' },
                { name: 'acceptMinutes', label: 'Accept within (minutes)', placeholder: '5' },
                { name: 'completeMinutes', label: 'Complete within (minutes)', placeholder: '30' },
              ]}
              onCreate={async (values) => {
                await staffApi.createSlaPolicy(token, {
                  name: values.name ?? '',
                  acceptMinutes: minutes(values.acceptMinutes),
                  completeMinutes: minutes(values.completeMinutes),
                });
                reload();
              }}
            />
          </section>
        )}
      </div>
    </>
  );
}

function SlaRow({
  policy,
  canManage,
  onSaved,
}: {
  policy: SlaPolicy;
  canManage: boolean;
  onSaved: () => void;
}) {
  const { token, reportError } = useAdmin();
  const [accept, setAccept] = useState(String(policy.acceptMinutes));
  const [complete, setComplete] = useState(String(policy.completeMinutes));
  const [showHistory, setShowHistory] = useState(false);
  const changed =
    minutes(accept) !== policy.acceptMinutes || minutes(complete) !== policy.completeMinutes;

  async function save() {
    try {
      await staffApi.updateSlaPolicy(token, policy.id, {
        acceptMinutes: minutes(accept),
        completeMinutes: minutes(complete),
      });
      onSaved();
    } catch (cause) {
      reportError(cause);
    }
  }

  return (
    <>
      <tr>
        <td>
          <strong>{policy.name}</strong>
        </td>
        <td>v{policy.currentVersion}</td>
        <td>
          {canManage ? (
            <input
              className="minutes"
              type="number"
              min={1}
              value={accept}
              aria-label={`${policy.name} accept minutes`}
              onChange={(event) => setAccept(event.target.value)}
            />
          ) : (
            policy.acceptMinutes
          )}{' '}
          min
        </td>
        <td>
          {canManage ? (
            <input
              className="minutes"
              type="number"
              min={1}
              value={complete}
              aria-label={`${policy.name} complete minutes`}
              onChange={(event) => setComplete(event.target.value)}
            />
          ) : (
            policy.completeMinutes
          )}{' '}
          min
          {canManage && changed && (
            <button type="button" className="save-version" onClick={() => void save()}>
              Save as v{policy.currentVersion + 1}
            </button>
          )}
        </td>
        <td>
          <button type="button" className="link" onClick={() => setShowHistory(!showHistory)}>
            {showHistory
              ? 'Hide'
              : `${policy.versions.length} version${policy.versions.length === 1 ? '' : 's'}`}
          </button>
        </td>
      </tr>
      {showHistory && (
        <tr className="history">
          <td colSpan={5}>
            {policy.versions.map((entry) => (
              <div key={entry.id} className="small">
                v{entry.version}: accept {entry.acceptMinutes} min, complete {entry.completeMinutes}{' '}
                min · saved {new Date(entry.createdAt).toLocaleString()}
              </div>
            ))}
          </td>
        </tr>
      )}
    </>
  );
}

interface LevelDraft {
  targetType: 'ASSIGNEE' | 'ROLE';
  afterMinutes: string;
  roleId: string;
}

function EscalationForm({ roles, onCreated }: { roles: Role[]; onCreated: () => void }) {
  const { token, reportError } = useAdmin();
  const [name, setName] = useState('');
  const [levels, setLevels] = useState<LevelDraft[]>([
    { targetType: 'ASSIGNEE', afterMinutes: '0', roleId: '' },
  ]);
  const [error, setError] = useState<string | null>(null);

  const update = (index: number, patch: Partial<LevelDraft>) =>
    setLevels(
      levels.map((level, position) => (position === index ? { ...level, ...patch } : level)),
    );

  async function submit() {
    setError(null);
    const payload: EscalationLevelInput[] = levels.map((level) =>
      level.targetType === 'ROLE'
        ? { targetType: 'ROLE', roleId: level.roleId, afterMinutes: minutes(level.afterMinutes) }
        : { targetType: 'ASSIGNEE', afterMinutes: minutes(level.afterMinutes) },
    );
    try {
      await staffApi.createEscalationPolicy(token, { name, levels: payload });
      setName('');
      setLevels([{ targetType: 'ASSIGNEE', afterMinutes: '0', roleId: '' }]);
      onCreated();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) reportError(cause);
      else setError(cause instanceof Error ? cause.message : 'Something went wrong.');
    }
  }

  return (
    <div className="create-form">
      <h3>Add escalation policy</h3>
      {error && <ErrorNotice message={error} onDismiss={() => setError(null)} />}
      <label>
        <span>Name</span>
        <input
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
            value={level.afterMinutes}
            aria-label={`Level ${index + 1} minutes after deadline`}
            onChange={(event) => update(index, { afterMinutes: event.target.value })}
          />
          <span className="small">min after →</span>
          <select
            value={level.targetType}
            aria-label={`Level ${index + 1} target`}
            onChange={(event) =>
              update(index, { targetType: event.target.value === 'ROLE' ? 'ROLE' : 'ASSIGNEE' })
            }
          >
            <option value="ASSIGNEE">Re-alert assigned staff</option>
            <option value="ROLE">Notify a role</option>
          </select>
          {level.targetType === 'ROLE' && (
            <select
              value={level.roleId}
              aria-label={`Level ${index + 1} role`}
              onChange={(event) => update(index, { roleId: event.target.value })}
            >
              <option value="">Choose a role…</option>
              {roles
                .filter((role) => role.active)
                .map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
            </select>
          )}
          {levels.length > 1 && (
            <button
              type="button"
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
          disabled={levels.length >= 10}
          onClick={() =>
            setLevels([...levels, { targetType: 'ROLE', afterMinutes: '', roleId: '' }])
          }
        >
          Add level
        </button>
        <button type="button" disabled={!name} onClick={() => void submit()}>
          Save policy
        </button>
      </div>
    </div>
  );
}
