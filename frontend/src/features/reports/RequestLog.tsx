import { useCallback, useState } from 'react';
import { reportApi, type ReportOutcome, type RequestLogRow, type RequestReport } from '../../api';
import { LoadState } from '../../components';
import { useLoad } from '../../lib/use-load';
import {
  downloadText,
  formatMinutes,
  formatWhen,
  outcomeLabels,
  reportFileName,
  requestLogCsv,
} from './report-format';
import { type Range } from './report-period';
import { useAdmin } from '../workspace/AdminLayout';

export interface LogFilter {
  outcome?: ReportOutcome | undefined;
  departmentId?: string | undefined;
  membershipId?: string | undefined;
  search?: string | undefined;
}

export function RequestLog({
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
  const { token, me, reportError } = useAdmin();
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
                  <td className="small">{formatWhen(row.submittedAt, me.tenant.timezone)}</td>
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
