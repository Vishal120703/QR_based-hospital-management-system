import { Download, History, X } from 'lucide-react';
import { useCallback, useState } from 'react';
import { reportApi, type AuditEntry } from '../../api';
import { LoadState, PageHeading } from '../../components';
import { useLoad } from '../../lib/use-load';
import { RequestTimelineDialog } from '../requests/RequestTimelineDialog';
import { useAdmin } from '../workspace/AdminLayout';
import { actionLabel, auditCategories, auditCsv, downloadText, fileDate } from './report-format';

const pageSize = '50';

interface Filters {
  category: string;
  membershipId: string;
  // One item's history, with the name shown in the filter chip.
  target: { id: string; name: string } | null;
  from: string;
  to: string;
}
const noFilters: Filters = { category: '', membershipId: '', target: null, from: '', to: '' };

const categoryNames = new Map(auditCategories.map((item) => [item.value, item.label]));

function dayLabel(value: string): string {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

const timeOf = (value: string) =>
  new Date(value).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

// Entries in order, grouped under the day they happened.
function byDay(entries: readonly AuditEntry[]) {
  const days: { label: string; entries: AuditEntry[] }[] = [];
  for (const entry of entries) {
    const label = dayLabel(entry.createdAt);
    const day = days.at(-1);
    if (day?.label === label) day.entries.push(entry);
    else days.push({ label, entries: [entry] });
  }
  return days;
}

export function AuditLogPage() {
  const { token, reportError } = useAdmin();
  const [filters, setFilters] = useState<Filters>(noFilters);
  const [older, setOlder] = useState<{
    key: Filters;
    entries: AuditEntry[];
    next: string | null;
  }>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);

  const params = useCallback(
    (before?: string) => ({
      category: filters.category || undefined,
      membershipId: filters.membershipId || undefined,
      targetId: filters.target?.id,
      from: filters.from ? new Date(`${filters.from}T00:00:00`).toISOString() : undefined,
      to: filters.to
        ? new Date(new Date(`${filters.to}T00:00:00`).getTime() + 86_400_000).toISOString()
        : undefined,
      before,
      limit: pageSize,
    }),
    [filters],
  );
  const firstPage = useLoad(
    useCallback(() => reportApi.audit(token, params()), [token, params]),
    { failure: 'Could not load the audit log.', onUnauthorized: reportError },
  );

  // Older pages belong to the filters they were loaded with.
  const extra = older?.key === filters ? older : undefined;
  const entries = firstPage.data ? [...firstPage.data.entries, ...(extra?.entries ?? [])] : null;
  const next = extra ? extra.next : (firstPage.data?.nextBefore ?? null);
  const people = firstPage.data?.people ?? [];
  const filtered =
    filters.category || filters.membershipId || filters.target || filters.from || filters.to;

  function change(next: Partial<Filters>) {
    setFilters((current) => ({ ...current, ...next }));
  }

  async function loadOlder() {
    if (!next) return;
    setLoadingMore(true);
    try {
      const loaded = await reportApi.audit(token, params(next));
      setOlder({
        key: filters,
        entries: [...(extra?.entries ?? []), ...loaded.entries],
        next: loaded.nextBefore,
      });
    } catch (cause) {
      reportError(cause);
    } finally {
      setLoadingMore(false);
    }
  }

  const person = people.find((item) => item.id === filters.membershipId);
  return (
    <>
      <PageHeading
        title="Audit log"
        description="Every change made in this hospital: who did it, when, and what changed. Entries cannot be edited or deleted."
      >
        <button
          type="button"
          className="secondary icon-button"
          disabled={!entries || entries.length === 0}
          title="Download the changes shown below"
          onClick={() =>
            entries && downloadText(`care-qr-audit-${fileDate(new Date())}.csv`, auditCsv(entries))
          }
        >
          <Download size={16} aria-hidden="true" />
          Download CSV
        </button>
      </PageHeading>

      <div className="toolbar audit-filters">
        <label>
          Who
          <select
            value={filters.membershipId}
            onChange={(event) => change({ membershipId: event.target.value })}
          >
            <option value="">Everyone</option>
            {people.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          What
          <select
            value={filters.category}
            onChange={(event) => change({ category: event.target.value })}
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
            value={filters.from}
            max={filters.to || undefined}
            onChange={(event) => change({ from: event.target.value })}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={filters.to}
            min={filters.from || undefined}
            onChange={(event) => change({ to: event.target.value })}
          />
        </label>
        {filtered && (
          <button type="button" className="link" onClick={() => setFilters(noFilters)}>
            Clear filters
          </button>
        )}
      </div>

      {(filters.target || person) && (
        <div className="filter-chips" aria-label="Active filters">
          {person && (
            <span className="filter-chip">
              Changes by <strong>{person.name}</strong>
              <button
                type="button"
                aria-label={`Stop showing only ${person.name}`}
                onClick={() => change({ membershipId: '' })}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </span>
          )}
          {filters.target && (
            <span className="filter-chip">
              History of <strong>{filters.target.name}</strong>
              <button
                type="button"
                aria-label={`Stop showing only ${filters.target.name}`}
                onClick={() => change({ target: null })}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </span>
          )}
        </div>
      )}

      {!entries ? (
        <LoadState
          loading={!firstPage.error}
          error={firstPage.error}
          label="Loading the audit log…"
          onRetry={firstPage.reload}
        />
      ) : entries.length === 0 ? (
        <div className="card empty-state">
          <p>{filtered ? 'No changes match these filters.' : 'No changes recorded yet.'}</p>
        </div>
      ) : (
        <>
          <LoadState loading={false} error={firstPage.error} onRetry={firstPage.reload} />
          {byDay(entries).map((day) => (
            <section key={day.label} className="audit-day" aria-label={day.label}>
              <h2>
                {day.label}
                <span className="muted">
                  {day.entries.length} {day.entries.length === 1 ? 'change' : 'changes'}
                </span>
              </h2>
              <ol className="audit-list">
                {day.entries.map((entry) => (
                  <AuditRow
                    key={entry.id}
                    entry={entry}
                    onPerson={(membershipId) => change({ membershipId })}
                    onTarget={(target) => change({ target })}
                    onRequest={setRequestId}
                  />
                ))}
              </ol>
            </section>
          ))}
          {next && (
            <button
              type="button"
              className="secondary"
              disabled={loadingMore}
              onClick={() => void loadOlder()}
            >
              {loadingMore ? 'Loading…' : 'Load older changes'}
            </button>
          )}
        </>
      )}
      {requestId && <RequestTimelineDialog id={requestId} onClose={() => setRequestId(null)} />}
    </>
  );
}

function AuditRow({
  entry,
  onPerson,
  onTarget,
  onRequest,
}: {
  entry: AuditEntry;
  onPerson: (membershipId: string) => void;
  onTarget: (target: { id: string; name: string }) => void;
  onRequest: (id: string) => void;
}) {
  const kind = categoryNames.get(entry.action.split('.')[0] ?? '');
  const targetName =
    entry.targetName ?? entry.targetType.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return (
    <li className="audit-entry">
      <time className="audit-time" dateTime={entry.createdAt}>
        {timeOf(entry.createdAt)}
      </time>
      <div className="audit-body">
        <p className="audit-line">
          {entry.actorId ? (
            <button
              type="button"
              className="link audit-actor"
              title={`Show everything ${entry.actorName} changed`}
              onClick={() => onPerson(entry.actorId!)}
            >
              {entry.actorName}
            </button>
          ) : (
            <strong className="audit-actor">{entry.actorName}</strong>
          )}
          <span className="audit-action">{actionLabel(entry.action)}</span>
          <button
            type="button"
            className="link audit-target"
            title={`Show everything that happened to ${targetName}`}
            onClick={() => onTarget({ id: entry.targetId, name: targetName })}
          >
            {targetName}
          </button>
          {kind && <span className="badge audit-kind">{kind}</span>}
        </p>
        {entry.changes.length > 0 && (
          <ul className="audit-changes" aria-label="What changed">
            {entry.changes.map((item) => (
              <li key={item.field}>
                <span className="audit-field">{item.field}</span>
                <span className="audit-before">{item.before}</span>
                <span aria-hidden="true">→</span>
                <span className="visually-hidden">changed to</span>
                <span className="audit-after">{item.after}</span>
              </li>
            ))}
          </ul>
        )}
        {entry.details.length > 0 && (
          <p className="audit-details small">
            {entry.details.map((item, index) => (
              <span key={`${item.label}-${index}`}>
                {item.label}: <strong>{item.value}</strong>
              </span>
            ))}
          </p>
        )}
        {entry.targetType === 'ServiceRequest' && (
          <button type="button" className="link small" onClick={() => onRequest(entry.targetId)}>
            <History size={14} aria-hidden="true" /> Full request history
          </button>
        )}
      </div>
    </li>
  );
}
