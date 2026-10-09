import { Download, Printer } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Link } from 'react-router';
import { reportApi, type ReportOutcome, type RequestLogRow, type RequestReport } from '../../api';
import { LoadState, PageHeading } from '../../components';
import { useLoad } from '../../lib/use-load';
import {
  downloadText,
  formatMinutes,
  formatPercent,
  formatWhen,
  outcomeLabels,
  reportCsv,
  reportFileName,
  requestLogCsv,
} from './report-format';
import { Meter, PrintHeader, usePrinting } from './report-parts';
import { PeriodPicker, useReportPeriod, type Range } from './report-period';
import { useAdmin } from '../workspace/AdminLayout';
import { RequestTimelineDialog } from '../requests/RequestTimelineDialog';

type Tab = 'staff' | 'why' | 'groups' | 'log';
interface LogFilter {
  outcome?: ReportOutcome | undefined;
  departmentId?: string | undefined;
  membershipId?: string | undefined;
  search?: string | undefined;
}

export function ReportsPage() {
  const { token, me, reportError } = useAdmin();
  const period = useReportPeriod();
  const range = period.range;
  // The full report is laid out only while printing (Print / PDF or Ctrl+P),
  // so the screen keeps one copy of every figure.
  const printing = usePrinting();
  const {
    data: report,
    loading,
    error,
    reload,
  } = useLoad(
    useCallback(() => reportApi.requests(token, range), [token, range]),
    { failure: 'Could not load the report.', onUnauthorized: reportError },
  );
  const [tab, setTab] = useState<Tab>('staff');
  const [timelineId, setTimelineId] = useState<string | null>(null);
  const [filter, setFilter] = useState<LogFilter>({});

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
      {/* The screen view; printing shows PrintableReport (every section) instead. */}
      <div className="no-print">
        <PageHeading
          title="Reports"
          description="How many requests came in, who handled them, how fast, and why any were not completed. Built from each request's recorded history. Click a person to see their own report."
        >
          <div className="page-actions">
            <button
              type="button"
              className="secondary icon-button"
              disabled={!report}
              title="Every section of this report in one spreadsheet (opens in Excel)"
              onClick={() =>
                report &&
                downloadText(reportFileName('report', range), reportCsv(report, me.tenant.name))
              }
            >
              <Download size={16} aria-hidden="true" />
              Download report
            </button>
            <button
              type="button"
              className="secondary icon-button"
              disabled={!report}
              title="Print the whole report, or choose Save as PDF"
              onClick={() => window.print()}
            >
              <Printer size={16} aria-hidden="true" />
              Print / PDF
            </button>
          </div>
        </PageHeading>
        <PeriodPicker state={period} />

        {!report ? (
          <LoadState loading={!error} error={error} label="Building the report…" onRetry={reload} />
        ) : (
          <>
            <LoadState loading={false} error={error} onRetry={reload} />
            {loading && (
              <p className="muted small" role="status">
                Updating…
              </p>
            )}
            {report.truncated && (
              <p className="notice notice-warning">
                This period has a very large number of requests; the report covers the most recent
                20,000. Choose a shorter period for exact totals.
              </p>
            )}
            <div className={`stat-grid report-tiles${loading ? ' updating' : ''}`}>
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
                personLink={(id) => `/admin/reports/people/${id}${period.query}`}
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
      </div>
      {printing && report && (
        <PrintableReport
          report={report}
          hospital={{ name: me.tenant.name, logoUrl: me.tenant.logoUrl }}
        />
      )}
      {timelineId && <RequestTimelineDialog id={timelineId} onClose={() => setTimelineId(null)} />}
    </>
  );
}

// Everyone who handled or assigned requests. A name opens that person's own
// report for the same period.
function StaffTable({
  report,
  personLink,
}: {
  report: RequestReport;
  personLink: (membershipId: string) => string;
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
      <table className="report-table staff-work">
        <thead>
          <tr>
            <th>Person</th>
            <th>Completed</th>
            <th>On time</th>
            <th>Avg to accept</th>
            <th>Avg work time</th>
            <th>Turned down</th>
            <th>Handed over</th>
            <th>Open now</th>
            <th>As a manager</th>
          </tr>
        </thead>
        <tbody>
          {report.byStaff.map((person) => (
            <tr key={person.membershipId}>
              <td>
                <Link to={personLink(person.membershipId)} title={`Open ${person.name}’s report`}>
                  {person.name}
                </Link>
                {person.rejectReasons.length > 0 && (
                  <div className="muted small">Turned down: {person.rejectReasons.join('; ')}</div>
                )}
              </td>
              <td>
                {person.assigned || person.completed ? (
                  <>
                    <strong>{person.completed}</strong>
                    <span className="muted"> of {person.assigned}</span>
                  </>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
              <td>
                <Meter value={person.completedOnTimePercent} />
              </td>
              <td>{formatMinutes(person.averageMinutesToAccept)}</td>
              <td>{formatMinutes(person.averageMinutesOfWork)}</td>
              <td className={person.rejected ? 'late-text' : ''}>{person.rejected}</td>
              <td>{person.transferredAway}</td>
              <td>{person.openNow}</td>
              <td className="small">
                {person.assignmentsMade || person.closed ? (
                  `${person.assignmentsMade} assigned · ${person.closed} closed`
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// The whole report on paper (or as a PDF): every section at once.
function PrintableReport({
  report,
  hospital,
}: {
  report: RequestReport;
  hospital: { name: string; logoUrl: string | null };
}) {
  const { summary } = report;
  const totals: [string, string | number][] = [
    ['Requests', summary.total],
    ['Completed', summary.completed],
    ['Still open', summary.open],
    ['Overdue now', summary.overdueOpen],
    ['Cancelled', `${summary.cancelled} (${summary.cancelledByPatient} by the patient)`],
    ['Turned down', summary.rejected],
    [
      'Accepted on time',
      `${formatPercent(summary.acceptedOnTimePercent)} · avg ${formatMinutes(summary.averageMinutesToAccept)}`,
    ],
    [
      'Completed on time',
      `${formatPercent(summary.completedOnTimePercent)} · avg ${formatMinutes(summary.averageMinutesToComplete)}`,
    ],
  ];
  return (
    <article className="print-only report-print">
      <PrintHeader title="Request report" hospital={hospital} range={report.range} />
      <section>
        <h2>Summary</h2>
        <dl className="print-totals">
          {totals.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section>
        <h2>Staff work</h2>
        {report.byStaff.length === 0 ? (
          <p>No staff handled requests in this period.</p>
        ) : (
          <table>
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
                <th>Avg work</th>
              </tr>
            </thead>
            <tbody>
              {report.byStaff.map((person) => (
                <tr key={person.membershipId}>
                  <td>{person.name}</td>
                  <td>{person.assigned}</td>
                  <td>{person.accepted}</td>
                  <td>{person.completed}</td>
                  <td>{formatPercent(person.completedOnTimePercent)}</td>
                  <td>{person.rejected}</td>
                  <td>{person.transferredAway}</td>
                  <td>{person.openNow}</td>
                  <td>{formatMinutes(person.averageMinutesToAccept)}</td>
                  <td>{formatMinutes(person.averageMinutesOfWork)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {(
        [
          ['By department', report.byDepartment],
          ['By service', report.byService],
        ] as const
      ).map(([title, rows]) => (
        <section key={title}>
          <h2>{title}</h2>
          {rows.length === 0 ? (
            <p>No requests.</p>
          ) : (
            <table>
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
          )}
        </section>
      ))}
      <section>
        <h2>Not completed</h2>
        {report.notCompleted.length === 0 ? (
          <p>Every request in this period was completed or is on track.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Request</th>
                <th>Where</th>
                <th>Result</th>
                <th>Who</th>
                <th>Reason / overdue</th>
              </tr>
            </thead>
            <tbody>
              {report.notCompleted.map((item) => (
                <tr key={item.id}>
                  <td>
                    {item.serviceName} ({item.publicId})
                  </td>
                  <td>{item.location}</td>
                  <td>{outcomeLabels[item.outcome]}</td>
                  <td>{item.endedBy ?? item.assigneeName ?? 'not assigned'}</td>
                  <td>
                    {item.outcome === 'overdue'
                      ? `overdue by ${formatMinutes(item.overdueMinutes)}`
                      : (item.reason ?? 'not given')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </article>
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
                <th>Completed</th>
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
                  <td>
                    <Meter
                      value={row.total ? (row.completed / row.total) * 100 : null}
                      label={`${row.completed} (${row.total ? Math.round((row.completed / row.total) * 100) : 0}%)`}
                    />
                  </td>
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
  const [search, setSearch] = useState(filter.search ?? '');
  const log = useLoad(
    useCallback(() => reportApi.log(token, { ...range, ...filter }), [token, range, filter]),
    { failure: 'Could not load the request log.', onUnauthorized: reportError },
  );
  const rows: RequestLogRow[] | null = log.data?.requests ?? null;
  const truncated = log.data?.truncated ?? false;

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
            rows && downloadText(reportFileName('requests', range), requestLogCsv(rows))
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
        <LoadState
          loading={!log.error}
          error={log.error}
          label="Loading requests…"
          onRetry={log.reload}
        />
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
