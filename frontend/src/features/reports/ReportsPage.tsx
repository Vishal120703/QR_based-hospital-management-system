import { useEffect, useState } from 'react';
import {
  ApiError,
  reportApi,
  type ReportOutcome,
  type RequestLogRow,
  type RequestReport,
} from '../../api';
import { LoadState, PageHeading } from '../../components';
import {
  downloadText,
  formatMinutes,
  formatPercent,
  formatWhen,
  outcomeLabels,
  requestLogCsv,
} from './report-format';
import { useAdmin } from '../workspace/AdminLayout';
import { RequestTimelineDialog } from '../requests/RequestTimelineDialog';

type Period = 'today' | '7d' | '30d' | 'month' | 'custom';
type Tab = 'staff' | 'why' | 'groups' | 'log';
interface Range {
  from: string;
  to: string;
}
interface LogFilter {
  outcome?: ReportOutcome | undefined;
  departmentId?: string | undefined;
  membershipId?: string | undefined;
  search?: string | undefined;
}

const periods: { id: Period; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: 'month', label: 'This month' },
  { id: 'custom', label: 'Choose dates' },
];

const day = (offset = 0, base = new Date()) => {
  const date = new Date(base);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return date;
};
const dateInput = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export function rangeFor(period: Period, custom: Range): Range {
  const now = new Date();
  if (period === 'custom') {
    const from = new Date(`${custom.from}T00:00:00`);
    const to = day(1, new Date(`${custom.to}T00:00:00`));
    return { from: from.toISOString(), to: to.toISOString() };
  }
  const from =
    period === 'today'
      ? day()
      : period === '7d'
        ? day(-6)
        : period === '30d'
          ? day(-29)
          : new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: from.toISOString(), to: now.toISOString() };
}

export function ReportsPage() {
  const { token, reportError } = useAdmin();
  const [period, setPeriod] = useState<Period>('7d');
  const [custom, setCustom] = useState<Range>({
    from: dateInput(day(-6)),
    to: dateInput(day()),
  });
  const [range, setRange] = useState<Range>(() => rangeFor('7d', custom));
  const [report, setReport] = useState<RequestReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [tab, setTab] = useState<Tab>('staff');
  const [timelineId, setTimelineId] = useState<string | null>(null);
  const [filter, setFilter] = useState<LogFilter>({});

  useEffect(() => {
    let current = true;
    reportApi.requests(token, range).then(
      (loaded) => {
        if (!current) return;
        setReport(loaded);
        setError(null);
      },
      (cause: unknown) => {
        if (!current) return;
        setError(cause instanceof Error ? cause.message : 'Could not load the report.');
        // The page shows the error with Try again; only an expired session signs out.
        if (cause instanceof ApiError && cause.status === 401) reportError(cause);
      },
    );
    return () => {
      current = false;
    };
  }, [token, range, attempt, reportError]);

  function choosePeriod(next: Period) {
    setPeriod(next);
    setReport(null);
    setRange(rangeFor(next, custom));
  }

  const summary = report?.summary;
  const tiles = summary
    ? [
        { label: 'Requests', value: summary.total, hint: 'sent by patients' },
        { label: 'Completed', value: summary.completed, tone: 'success' },
        { label: 'Still open', value: summary.open },
        { label: 'Overdue now', value: summary.overdueOpen, tone: 'danger' },
        {
          label: 'Cancelled',
          value: summary.cancelled,
          hint: `${summary.cancelledByPatient} by the patient`,
        },
        { label: 'Turned down', value: summary.rejected, tone: summary.rejected ? 'warning' : '' },
        {
          label: 'Accepted on time',
          value: formatPercent(summary.acceptedOnTimePercent),
          hint: `avg ${formatMinutes(summary.averageMinutesToAccept)}`,
        },
        {
          label: 'Completed on time',
          value: formatPercent(summary.completedOnTimePercent),
          hint: `avg ${formatMinutes(summary.averageMinutesToComplete)}`,
        },
      ]
    : [];

  return (
    <>
      <PageHeading
        title="Reports"
        description="How many requests came in, who handled them, how fast, and why any were not completed. Built from each request's recorded history."
      />
      <div className="report-periods" role="group" aria-label="Period">
        {periods.map((item) => (
          <button
            key={item.id}
            type="button"
            className={period === item.id ? 'tab active' : 'tab'}
            aria-pressed={period === item.id}
            onClick={() => choosePeriod(item.id)}
          >
            {item.label}
          </button>
        ))}
        {period === 'custom' && (
          <form
            className="report-dates"
            onSubmit={(event) => {
              event.preventDefault();
              setReport(null);
              setRange(rangeFor('custom', custom));
            }}
          >
            <label>
              From
              <input
                type="date"
                value={custom.from}
                max={custom.to}
                onChange={(event) => setCustom((value) => ({ ...value, from: event.target.value }))}
              />
            </label>
            <label>
              To
              <input
                type="date"
                value={custom.to}
                min={custom.from}
                onChange={(event) => setCustom((value) => ({ ...value, to: event.target.value }))}
              />
            </label>
            <button type="submit" className="secondary">
              Show
            </button>
          </form>
        )}
      </div>

      {!report ? (
        <LoadState
          loading={!error}
          error={error}
          label="Building the report…"
          onRetry={() => {
            setError(null);
            setAttempt((value) => value + 1);
          }}
        />
      ) : (
        <>
          {report.truncated && (
            <p className="notice notice-warning">
              This period has a very large number of requests; the report covers the most recent
              20,000. Choose a shorter period for exact totals.
            </p>
          )}
          <div className="stat-grid report-tiles">
            {tiles.map((tile) => (
              <div
                key={tile.label}
                className={`card stat static${tile.tone && Number(tile.value) > 0 ? ` stat-${tile.tone}` : ''}`}
              >
                <span>{tile.label}</span>
                <strong>{tile.value}</strong>
                {tile.hint && <small className="muted">{tile.hint}</small>}
              </div>
            ))}
          </div>

          <div className="tabs" role="group" aria-label="Report section">
            {(
              [
                ['staff', `Staff work (${report.byStaff.length})`],
                ['why', `Not completed (${report.notCompleted.length})`],
                ['groups', 'Departments & services'],
                ['log', 'Request log'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={tab === id ? 'tab active' : 'tab'}
                aria-pressed={tab === id}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'staff' && (
            <StaffTable
              report={report}
              onPick={(membershipId) => {
                setFilter({ membershipId });
                setTab('log');
              }}
            />
          )}
          {tab === 'why' && <NotCompleted report={report} onOpen={setTimelineId} />}
          {tab === 'groups' && (
            <div className="profile-grid">
              <GroupTable title="By department" rows={report.byDepartment} />
              <GroupTable title="By service" rows={report.byService} />
            </div>
          )}
          {tab === 'log' && (
            <RequestLog
              range={range}
              report={report}
              filter={filter}
              onFilter={setFilter}
              onOpen={setTimelineId}
            />
          )}
        </>
      )}
      {timelineId && <RequestTimelineDialog id={timelineId} onClose={() => setTimelineId(null)} />}
    </>
  );
}

function StaffTable({
  report,
  onPick,
}: {
  report: RequestReport;
  onPick: (membershipId: string) => void;
}) {
  if (report.byStaff.length === 0) {
    return (
      <div className="card empty-state">
        <p>No staff handled requests in this period.</p>
      </div>
    );
  }
  return (
    <div className="table-wrap">
      <table className="report-table">
        <thead>
          <tr>
            <th>Person</th>
            <th>Assigned</th>
            <th>Accepted</th>
            <th>Completed</th>
            <th>On time</th>
            <th>Turned down</th>
            <th>Handed over</th>
            <th>Open now</th>
            <th>Avg to accept</th>
            <th>Avg work time</th>
            <th>Assigned others</th>
            <th>Closed</th>
          </tr>
        </thead>
        <tbody>
          {report.byStaff.map((person) => (
            <tr key={person.membershipId}>
              <td>
                <button
                  type="button"
                  className="link"
                  title="Show this person's requests"
                  onClick={() => onPick(person.membershipId)}
                >
                  {person.name}
                </button>
                {person.rejectReasons.length > 0 && (
                  <div className="muted small">Turned down: {person.rejectReasons.join('; ')}</div>
                )}
              </td>
              <td>{person.assigned}</td>
              <td>{person.accepted}</td>
              <td>{person.completed}</td>
              <td>{formatPercent(person.completedOnTimePercent)}</td>
              <td className={person.rejected ? 'late-text' : ''}>{person.rejected}</td>
              <td>{person.transferredAway}</td>
              <td>{person.openNow}</td>
              <td>{formatMinutes(person.averageMinutesToAccept)}</td>
              <td>{formatMinutes(person.averageMinutesOfWork)}</td>
              <td>{person.assignmentsMade}</td>
              <td>{person.closed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NotCompleted({ report, onOpen }: { report: RequestReport; onOpen: (id: string) => void }) {
  if (report.notCompleted.length === 0) {
    return (
      <div className="card empty-state">
        <p>Every request in this period was completed or is on track.</p>
      </div>
    );
  }
  return (
    <ul className="why-list">
      {report.notCompleted.map((item) => (
        <li key={item.id} className={`card why-${item.outcome}`}>
          <div className="why-head">
            <strong>{item.serviceName}</strong>
            <span
              className={`badge ${item.outcome === 'overdue' || item.outcome === 'rejected' ? 'badge-danger' : ''}`}
            >
              {outcomeLabels[item.outcome]}
            </span>
          </div>
          <p className="muted small">
            {item.location} · {item.publicId} · sent {formatWhen(item.submittedAt)}
          </p>
          <p className="why-reason">
            {item.outcome === 'overdue' ? (
              <>
                Overdue by <strong>{formatMinutes(item.overdueMinutes)}</strong>
                {item.assigneeName ? ` · with ${item.assigneeName}` : ' · not assigned yet'}
              </>
            ) : (
              <>
                {item.outcome === 'cancelled' ? 'Cancelled' : 'Turned down'} by{' '}
                <strong>{item.endedBy ?? 'unknown'}</strong> {formatWhen(item.endedAt)}
                {' · '}
                Reason: <strong>{item.reason ?? 'not given'}</strong>
              </>
            )}
          </p>
          <button type="button" className="link" onClick={() => onOpen(item.id)}>
            Full history
          </button>
        </li>
      ))}
    </ul>
  );
}

function GroupTable({ title, rows }: { title: string; rows: RequestReport['byService'] }) {
  return (
    <section className="card" aria-label={title}>
      <h2>{title}</h2>
      {rows.length === 0 ? (
        <p className="muted">No requests.</p>
      ) : (
        <div className="table-wrap flat">
          <table className="report-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Total</th>
                <th>Done</th>
                <th>Open</th>
                <th>Cancelled</th>
                <th>Turned down</th>
                <th>Avg time</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td>{row.total}</td>
                  <td>{row.completed}</td>
                  <td>{row.open}</td>
                  <td>{row.cancelled}</td>
                  <td>{row.rejected}</td>
                  <td>{formatMinutes(row.averageMinutesToComplete)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function RequestLog({
  range,
  report,
  filter,
  onFilter,
  onOpen,
}: {
  range: Range;
  report: RequestReport;
  filter: LogFilter;
  onFilter: (next: LogFilter) => void;
  onOpen: (id: string) => void;
}) {
  const { token, reportError } = useAdmin();
  const [rows, setRows] = useState<RequestLogRow[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [search, setSearch] = useState(filter.search ?? '');

  useEffect(() => {
    let current = true;
    reportApi.log(token, { ...range, ...filter }).then(
      (loaded) => {
        if (!current) return;
        setRows(loaded.requests);
        setTruncated(loaded.truncated);
      },
      (cause: unknown) => {
        if (current) reportError(cause);
      },
    );
    return () => {
      current = false;
    };
  }, [token, range, filter, reportError]);

  const person = report.byStaff.find((item) => item.membershipId === filter.membershipId);
  return (
    <section aria-label="Request log">
      <form
        className="toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          onFilter({ ...filter, search: search.trim() || undefined });
        }}
      >
        <label>
          Result
          <select
            value={filter.outcome ?? ''}
            onChange={(event) =>
              onFilter({ ...filter, outcome: (event.target.value || undefined) as ReportOutcome })
            }
          >
            <option value="">All</option>
            {(Object.keys(outcomeLabels) as ReportOutcome[]).map((outcome) => (
              <option key={outcome} value={outcome}>
                {outcomeLabels[outcome]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Department
          <select
            value={filter.departmentId ?? ''}
            onChange={(event) =>
              onFilter({ ...filter, departmentId: event.target.value || undefined })
            }
          >
            <option value="">All</option>
            {report.byDepartment.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Person
          <select
            value={filter.membershipId ?? ''}
            onChange={(event) =>
              onFilter({ ...filter, membershipId: event.target.value || undefined })
            }
          >
            <option value="">Anyone</option>
            {report.byStaff.map((item) => (
              <option key={item.membershipId} value={item.membershipId}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="search-field">
          Search
          <input
            type="search"
            value={search}
            placeholder="Reference, service, or bed"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <button type="submit" className="secondary">
          Search
        </button>
        <button
          type="button"
          className="secondary"
          disabled={!rows || rows.length === 0}
          onClick={() =>
            rows &&
            downloadText(
              `care-qr-requests-${range.from.slice(0, 10)}-to-${range.to.slice(0, 10)}.csv`,
              requestLogCsv(rows),
            )
          }
        >
          Download CSV
        </button>
      </form>
      {person && <p className="small">Showing requests {person.name} was involved in.</p>}
      {truncated && (
        <p className="notice notice-warning small">
          Showing the first 2,000 matching requests. Narrow the filters to see the rest.
        </p>
      )}
      {!rows ? (
        <p className="muted" role="status">
          Loading requests…
        </p>
      ) : rows.length === 0 ? (
        <div className="card empty-state">
          <p>No requests match.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="report-table">
            <thead>
              <tr>
                <th>Request</th>
                <th>Where</th>
                <th>Result</th>
                <th>Sent</th>
                <th>Assigned to</th>
                <th>Accepted by</th>
                <th>Completed by</th>
                <th>Time taken</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <button type="button" className="link" onClick={() => onOpen(row.id)}>
                      {row.serviceName}
                    </button>
                    <div className="muted small code">{row.publicId}</div>
                  </td>
                  <td className="small">{row.location}</td>
                  <td>
                    {outcomeLabels[row.outcome]}
                    {row.overdueMinutes !== null && (
                      <div className="late-text small">
                        overdue {formatMinutes(row.overdueMinutes)}
                      </div>
                    )}
                    {row.endReason && <div className="muted small">{row.endReason}</div>}
                  </td>
                  <td className="small">{formatWhen(row.submittedAt)}</td>
                  <td>{row.assigneeName ?? '—'}</td>
                  <td>
                    {row.acceptedBy ?? '—'}
                    {row.acceptedOnTime === false && <div className="late-text small">late</div>}
                  </td>
                  <td>
                    {row.completedBy ?? (row.endedBy ? `— (${row.endedBy})` : '—')}
                    {row.completedOnTime === false && <div className="late-text small">late</div>}
                  </td>
                  <td>{formatMinutes(row.minutesToComplete)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
