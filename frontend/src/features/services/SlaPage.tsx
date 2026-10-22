import { useCallback, useRef, useState } from 'react';
import { ApiError, staffApi, type EscalationPolicy, type Role, type SlaPolicy } from '../../api';
import { CreateForm, ErrorNotice, LoadState, PageHeading, useConfirm } from '../../components';
import { useLoad } from '../../lib/use-load';
import { useAdmin } from '../workspace/AdminLayout';
import { EscalationForm } from './EscalationForm';

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

function minutes(value: string | undefined, label: string, min: number, max: number): number {
  if (!value || !/^\d+$/.test(value))
    throw new Error(`${label} must be a whole number of minutes.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} must be between ${min} and ${max} minutes.`);
  }
  return parsed;
}

function timings(accept: string | undefined, complete: string | undefined) {
  const acceptMinutes = minutes(accept, 'Acceptance time', 1, 1440);
  const completeMinutes = minutes(complete, 'Completion time', 1, 10_080);
  if (completeMinutes < acceptMinutes)
    throw new Error('Completion time must be at least the acceptance time.');
  return { acceptMinutes, completeMinutes };
}

export function SlaPage() {
  const { token, reportError, reportSuccess, can } = useAdmin();
  const confirm = useConfirm();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const pendingDelete = useRef(false);
  const canManage = can('sla.manage');
  const canReadRoles = can('role.read');

  const {
    data: policies,
    loading,
    error: loadError,
    reload,
  } = useLoad(
    useCallback(() => loadPolicies(token, canReadRoles), [token, canReadRoles]),
    { failure: 'Unable to load SLA policies.', onUnauthorized: reportError },
  );

  async function removePolicy(policy: EscalationPolicy) {
    if (
      pendingDelete.current ||
      !(await confirm(
        `Delete ${policy.name}? This cannot be undone. Policies used by services cannot be deleted.`,
      ))
    )
      return;
    pendingDelete.current = true;
    setDeletingId(policy.id);
    try {
      await staffApi.deleteEscalationPolicy(token, policy.id);
      reload();
      reportSuccess(`${policy.name} was deleted.`);
    } catch (cause) {
      reportError(cause);
    } finally {
      pendingDelete.current = false;
      setDeletingId(null);
    }
  }

  if (!policies) {
    return (
      <LoadState loading={loading} error={loadError} onRetry={reload} label="Loading policies…" />
    );
  }

  const roleName = (id: string | null) =>
    policies.roles.find((role) => role.id === id)?.name ?? 'a role';

  return (
    <>
      <PageHeading
        title="Response times & escalation"
        description="SLA means the time allowed to accept and complete a request. Both deadlines will count from submission. Editing saves a new version, so existing requests will keep their original timing."
      />
      <LoadState loading={false} error={loadError} onRetry={reload} />

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
            {policies.sla.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No response-time policies yet. Add one below before creating services.
                </td>
              </tr>
            )}
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
                    disabled={deletingId !== null}
                    onClick={() => void removePolicy(policy)}
                  >
                    {deletingId === policy.id ? 'Deleting…' : 'Delete'}
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
          {canManage && (
            <EscalationForm roles={policies.roles} canReadRoles={canReadRoles} onCreated={reload} />
          )}
        </section>

        {canManage && (
          <section className="card">
            <h2>Add SLA policy</h2>
            <CreateForm
              submitLabel="Add SLA policy"
              onError={reportError}
              fields={() => [
                { name: 'name', label: 'Name', placeholder: 'Overnight' },
                {
                  name: 'acceptMinutes',
                  label: 'Accept within (minutes)',
                  type: 'number',
                  min: 1,
                  max: 1440,
                  step: 1,
                  placeholder: '5',
                },
                {
                  name: 'completeMinutes',
                  label: 'Complete within (minutes)',
                  type: 'number',
                  min: 1,
                  max: 10_080,
                  step: 1,
                  placeholder: '30',
                },
              ]}
              onCreate={async (values) => {
                await staffApi.createSlaPolicy(token, {
                  name: values.name ?? '',
                  ...timings(values.acceptMinutes, values.completeMinutes),
                });
                reload();
                reportSuccess(`${values.name} was added.`);
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
  const { token, reportError, reportSuccess } = useAdmin();
  const [accept, setAccept] = useState(String(policy.acceptMinutes));
  const [complete, setComplete] = useState(String(policy.completeMinutes));
  const [showHistory, setShowHistory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const formId = `sla-${policy.id}`;
  const changed =
    Number(accept) !== policy.acceptMinutes || Number(complete) !== policy.completeMinutes;

  async function save() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const { slaPolicy } = await staffApi.updateSlaPolicy(
        token,
        policy.id,
        timings(accept, complete),
      );
      onSaved();
      reportSuccess(`${policy.name} was saved as version ${slaPolicy.currentVersion}.`);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) reportError(cause);
      else setError(cause instanceof Error ? cause.message : 'Unable to save the policy.');
    } finally {
      pending.current = false;
      setBusy(false);
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
              max={1440}
              step={1}
              required
              disabled={busy}
              form={formId}
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
              max={10_080}
              step={1}
              required
              disabled={busy}
              form={formId}
              value={complete}
              aria-label={`${policy.name} complete minutes`}
              onChange={(event) => setComplete(event.target.value)}
            />
          ) : (
            policy.completeMinutes
          )}{' '}
          min
          {canManage && (
            <form
              id={formId}
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              {changed && (
                <div className="actions">
                  <button type="submit" disabled={busy}>
                    {busy ? 'Saving…' : `Save as v${policy.currentVersion + 1}`}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => {
                      setAccept(String(policy.acceptMinutes));
                      setComplete(String(policy.completeMinutes));
                      setError(null);
                    }}
                  >
                    Cancel edit
                  </button>
                </div>
              )}
              {error && <ErrorNotice message={error} onDismiss={() => setError(null)} />}
            </form>
          )}
        </td>
        <td>
          <button
            type="button"
            className="link"
            aria-expanded={showHistory}
            onClick={() => setShowHistory(!showHistory)}
          >
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
