import { useCallback, useEffect, useState } from 'react';
import { ApiError, reportApi, type AuditEntry } from '../../api';
import { LoadState, PageHeading } from '../../components';
import { actionLabel, auditCategories, formatWhen } from './report-format';
import { useAdmin } from '../workspace/AdminLayout';

const pageSize = '50';

// Short, readable details from an entry's recorded data.
function details(metadata: unknown): string {
  if (!metadata || typeof metadata !== 'object') return '';
  const record = metadata as Record<string, unknown>;
  const parts: string[] = [];
  const from = record.from ?? (record.before as Record<string, unknown> | undefined)?.status;
  const to = record.to ?? (record.after as Record<string, unknown> | undefined)?.status;
  if (typeof from === 'string' && typeof to === 'string' && from !== to) {
    parts.push(`${from.toLowerCase()} → ${to.toLowerCase()}`);
  }
  for (const key of ['dutyStatus', 'status', 'reason', 'name', 'email', 'code', 'scopeType']) {
    const value = record[key];
    if (typeof value === 'string' && !parts.some((part) => part.includes(value.toLowerCase()))) {
      parts.push(key === 'reason' ? `reason: ${value}` : value.toLowerCase());
    }
  }
  if (Array.isArray(record.bedCodes)) parts.push(`${record.bedCodes.length} beds`);
  if (Array.isArray(record.permissionKeys)) {
    parts.push(`${record.permissionKeys.length} permissions`);
  }
  return parts.slice(0, 3).join(' · ');
}

export function AuditLogPage() {
  const { token, reportError } = useAdmin();
  const [category, setCategory] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const params = useCallback(
    (before?: string) => ({
      category: category || undefined,
      from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
      to: to
        ? new Date(new Date(`${to}T00:00:00`).getTime() + 86_400_000).toISOString()
        : undefined,
      before,
      limit: pageSize,
    }),
    [category, from, to],
  );

  useEffect(() => {
    let current = true;
    reportApi.audit(token, params()).then(
      (loaded) => {
        if (!current) return;
        setEntries(loaded.entries);
        setNext(loaded.nextBefore);
        setError(null);
      },
      (cause: unknown) => {
        if (!current) return;
        setError(cause instanceof Error ? cause.message : 'Could not load the audit log.');
        // The page shows the error with Try again; only an expired session signs out.
        if (cause instanceof ApiError && cause.status === 401) reportError(cause);
      },
    );
    return () => {
      current = false;
    };
  }, [token, params, reportError]);

  async function loadMore() {
    if (!next) return;
    setLoadingMore(true);
    try {
      const loaded = await reportApi.audit(token, params(next));
      setEntries((current) => [...(current ?? []), ...loaded.entries]);
      setNext(loaded.nextBefore);
    } catch (cause) {
      reportError(cause);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <>
      <PageHeading
        title="Audit log"
        description="Every change made in this hospital: who did it, when, and to what. Entries cannot be edited or deleted."
      />
      <div className="toolbar">
        <label>
          Show
          <select
            value={category}
            onChange={(event) => {
              setEntries(null);
              setCategory(event.target.value);
            }}
          >
            {auditCategories.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          From
          <input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(event) => {
              setEntries(null);
              setFrom(event.target.value);
            }}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(event) => {
              setEntries(null);
              setTo(event.target.value);
            }}
          />
        </label>
      </div>
      {!entries ? (
        <LoadState
          loading={!error}
          error={error}
          label="Loading the audit log…"
          onRetry={() => setError(null)}
        />
      ) : entries.length === 0 ? (
        <div className="card empty-state">
          <p>No changes recorded for this filter.</p>
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="report-table audit-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>What happened</th>
                  <th>To what</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="small">{formatWhen(entry.createdAt)}</td>
                    <td>
                      {entry.actorName}
                      {entry.actorType !== 'STAFF' && (
                        <div className="muted small">{entry.actorType.toLowerCase()}</div>
                      )}
                    </td>
                    <td>{actionLabel(entry.action)}</td>
                    <td>
                      {entry.targetName ?? (
                        <span className="muted small">
                          {entry.targetType.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()}
                        </span>
                      )}
                    </td>
                    <td className="small muted">{details(entry.metadata)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {next && (
            <button
              type="button"
              className="secondary"
              disabled={loadingMore}
              onClick={() => void loadMore()}
            >
              {loadingMore ? 'Loading…' : 'Load older changes'}
            </button>
          )}
        </>
      )}
    </>
  );
}
