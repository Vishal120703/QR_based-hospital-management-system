import { Download, Printer } from 'lucide-react';
import { useCallback, useState } from 'react';
import { reportApi } from '../../api';
import { LoadState, PageHeading } from '../../components';
import { useLoad } from '../../lib/use-load';
import {
  downloadText,
  formatMinutes,
  formatPercent,
  reportCsv,
  reportFileName,
} from './report-format';
import { usePrinting } from './report-parts';
import { PeriodPicker, useReportPeriod } from './report-period';
import { useAdmin } from '../workspace/AdminLayout';
import { RequestTimelineDialog } from '../requests/RequestTimelineDialog';
import { PrintableReport } from './PrintableReport';
import { RequestLog, type LogFilter } from './RequestLog';
import { GroupTable, NotCompleted, StaffTable } from './ReportTables';

type Tab = 'staff' | 'why' | 'groups' | 'log';

export function ReportsPage() {
  const { token, me, reportError } = useAdmin();
  const timeZone = me.tenant.timezone;
  const period = useReportPeriod(timeZone);
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
                downloadText(
                  reportFileName('report', range),
                  reportCsv(report, { name: me.tenant.name, timezone: timeZone }),
                )
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
            {tab === 'why' && (
              <NotCompleted report={report} timeZone={timeZone} onOpen={setTimelineId} />
            )}
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
          hospital={{ name: me.tenant.name, logoUrl: me.tenant.logoUrl, timezone: timeZone }}
        />
      )}
      {timelineId && <RequestTimelineDialog id={timelineId} onClose={() => setTimelineId(null)} />}
    </>
  );
}
