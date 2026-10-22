import { Download, Printer } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { reportApi, type ActivityKind, type PersonReport } from '../../api';
import { LoadState, PageHeading } from '../../components';
import { useLoad } from '../../lib/use-load';
import { RequestTimelineDialog } from '../requests/RequestTimelineDialog';
import { useAdmin } from '../workspace/AdminLayout';
import { downloadText, formatMinutes, formatPercent, reportFileName } from './report-format';
import { activityLabels, personBreakdown, personCsv } from './person-report-format';
import { ActivityTable, PrintablePersonReport } from './person-report-details';
import { Meter, usePrinting } from './report-parts';
import { PeriodPicker, useReportPeriod } from './report-period';

// One person's work: their figures beside the hospital's, day by day, by
// service, and every action they took or that was given to them.
export function PersonReportPage() {
  const { membershipId = '' } = useParams();
  const { token, me, reportError } = useAdmin();
  const navigate = useNavigate();
  const timeZone = me.tenant.timezone;
  const period = useReportPeriod(timeZone);
  const printing = usePrinting();
  const [kind, setKind] = useState<ActivityKind | ''>('');
  const [showAll, setShowAll] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const {
    data: report,
    error,
    reload,
  } = useLoad(
    useCallback(
      () => reportApi.person(token, membershipId, period.range),
      [token, membershipId, period.range],
    ),
    { failure: 'Could not load this report.', onUnauthorized: reportError },
  );

  const name = report?.person.name ?? 'Staff work';
  const hospital = { name: me.tenant.name, logoUrl: me.tenant.logoUrl, timezone: timeZone };
  return (
    <>
      <div className="no-print">
        <p className="breadcrumbs small">
          <Link to={`/admin/reports${period.query}`}>Reports</Link> › {name}
        </p>
        <PageHeading
          title={name}
          description="Work in the chosen period: requests given to them, how quickly they were accepted and completed, what was turned down or handed over, and every action taken."
        >
          <div className="page-actions">
            <button
              type="button"
              className="secondary icon-button"
              disabled={!report}
              onClick={() =>
                report &&
                downloadText(
                  reportFileName(
                    `work-${report.person.name.toLowerCase().replace(/\W+/g, '-')}`,
                    period.range,
                  ),
                  personCsv(report, hospital),
                )
              }
            >
              <Download size={16} aria-hidden="true" />
              Download
            </button>
            <button
              type="button"
              className="secondary icon-button"
              disabled={!report}
              onClick={() => window.print()}
            >
              <Printer size={16} aria-hidden="true" />
              Print / PDF
            </button>
          </div>
        </PageHeading>

        <div className="person-toolbar">
          <PeriodPicker state={period} />
          {report && report.people.length > 1 && (
            <label className="person-switch">
              Person
              <select
                value={membershipId}
                onChange={(event) =>
                  void navigate(`/admin/reports/people/${event.target.value}${period.query}`)
                }
              >
                {!report.people.some((item) => item.membershipId === membershipId) && (
                  <option value={membershipId}>{name}</option>
                )}
                {report.people.map((item) => (
                  <option key={item.membershipId} value={item.membershipId}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {!report ? (
          <LoadState loading={!error} error={error} label="Building the report…" onRetry={reload} />
        ) : (
          <>
            <LoadState loading={false} error={error} onRetry={reload} />
            {report.truncated && (
              <p className="notice notice-warning">
                This period has a very large number of requests; the report covers the most recent
                20,000. Choose a shorter period for exact totals.
              </p>
            )}
            <PersonTiles report={report} />
            <Comparison report={report} />
            <Breakdown report={report} timeZone={timeZone} />
            <section className="card" aria-labelledby="activity-title">
              <div className="section-heading">
                <h2 id="activity-title">Every action ({report.activity.length})</h2>
                <label>
                  Show
                  <select
                    value={kind}
                    onChange={(event) => setKind(event.target.value as ActivityKind | '')}
                  >
                    <option value="">Everything</option>
                    {(Object.keys(activityLabels) as ActivityKind[])
                      .filter((item) => report.activity.some((action) => action.kind === item))
                      .map((item) => (
                        <option key={item} value={item}>
                          {activityLabels[item]}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              <ActivityTable
                report={report}
                timeZone={timeZone}
                kind={kind}
                showAll={showAll}
                onShowAll={() => setShowAll(true)}
                onOpen={setRequestId}
              />
            </section>
          </>
        )}
      </div>
      {printing && report && <PrintablePersonReport report={report} hospital={hospital} />}
      {requestId && <RequestTimelineDialog id={requestId} onClose={() => setRequestId(null)} />}
    </>
  );
}

function PersonTiles({ report }: { report: PersonReport }) {
  const { work } = report;
  const tiles = [
    { label: 'Assigned to them', value: work.assigned, hint: `${work.openNow} still open` },
    {
      label: 'Completed',
      value: work.completed,
      hint: `${formatPercent(work.completedOnTimePercent)} on time`,
      tone: 'success',
    },
    {
      label: 'Accepted',
      value: work.accepted,
      hint: `avg ${formatMinutes(work.averageMinutesToAccept)} to accept`,
    },
    {
      label: 'Turned down',
      value: work.rejected,
      hint: work.rejectReasons[0] ? `“${work.rejectReasons[0]}”` : undefined,
      title: work.rejectReasons.join('; ') || undefined,
      tone: 'warning',
    },
    { label: 'Handed over', value: work.transferredAway, hint: 'given to someone else' },
    ...(work.assignmentsMade || work.closed
      ? [
          { label: 'Assigned to others', value: work.assignmentsMade, hint: 'as a manager' },
          { label: 'Closed', value: work.closed, hint: 'after the work was done' },
        ]
      : []),
  ];
  return (
    <div className="stat-grid report-tiles person-tiles">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className={`card stat static${tile.tone && tile.value > 0 ? ` stat-${tile.tone}` : ''}`}
        >
          <span>{tile.label}</span>
          <strong>{tile.value}</strong>
          {tile.hint && (
            <small className="muted clamp" title={'title' in tile ? tile.title : undefined}>
              {tile.hint}
            </small>
          )}
        </div>
      ))}
    </div>
  );
}

// This person beside the whole hospital, for the three measures that matter.
function Comparison({ report }: { report: PersonReport }) {
  const { work, hospital } = report;
  const speed = (label: string, mine: number | null, all: number | null) => {
    const longest = Math.max(mine ?? 0, all ?? 0) || 1;
    return (
      <div className="compare-row" key={label}>
        <span className="compare-label">{label}</span>
        <span className="compare-bars">
          <span className="compare-bar">
            <span className="compare-who">{report.person.name}</span>
            <span className="meter" aria-hidden="true">
              <span className="person" style={{ width: `${((mine ?? 0) / longest) * 100}%` }} />
            </span>
            <span>{formatMinutes(mine)}</span>
          </span>
          <span className="compare-bar">
            <span className="compare-who">Whole hospital</span>
            <span className="meter" aria-hidden="true">
              <span className="hospital" style={{ width: `${((all ?? 0) / longest) * 100}%` }} />
            </span>
            <span>{formatMinutes(all)}</span>
          </span>
        </span>
      </div>
    );
  };
  return (
    <section className="card compare" aria-labelledby="compare-title">
      <h2 id="compare-title">Compared with the whole hospital</h2>
      <div className="compare-row">
        <span className="compare-label">Completed on time</span>
        <span className="compare-bars">
          <span className="compare-bar">
            <span className="compare-who">{report.person.name}</span>
            <Meter value={work.completedOnTimePercent} />
          </span>
          <span className="compare-bar">
            <span className="compare-who">Whole hospital</span>
            <Meter value={hospital.completedOnTimePercent} />
          </span>
        </span>
      </div>
      {speed(
        'Time to accept (shorter is better)',
        work.averageMinutesToAccept,
        hospital.averageMinutesToAccept,
      )}
      {speed(
        'Work time (accept → complete)',
        work.averageMinutesOfWork,
        hospital.averageMinutesOfWork,
      )}
    </section>
  );
}

function Breakdown({ report, timeZone }: { report: PersonReport; timeZone: string }) {
  const { byService, byDay } = personBreakdown(report.activity, timeZone);
  const busiest = Math.max(1, ...byDay.map((day) => day.completed));
  if (byService.length === 0) {
    return (
      <div className="card empty-state">
        <p>{report.person.name} did not accept or complete any requests in this period.</p>
      </div>
    );
  }
  return (
    <div className="person-breakdown">
      <section className="card" aria-labelledby="by-service-title">
        <h2 id="by-service-title">By service</h2>
        <div className="table-wrap flat">
          <table className="report-table">
            <thead>
              <tr>
                <th>Service</th>
                <th>Completed</th>
                <th>On time</th>
                <th>Avg work</th>
                <th>Turned down</th>
              </tr>
            </thead>
            <tbody>
              {byService.map((service) => (
                <tr key={service.name}>
                  <td>{service.name}</td>
                  <td>{service.completed}</td>
                  <td>
                    <Meter
                      value={service.completed ? (service.onTime / service.completed) * 100 : null}
                    />
                  </td>
                  <td>{formatMinutes(service.averageWorkMinutes)}</td>
                  <td className={service.rejected ? 'late-text' : ''}>{service.rejected}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card" aria-labelledby="by-day-title">
        <h2 id="by-day-title">Day by day</h2>
        <div className="table-wrap flat">
          <table className="report-table">
            <thead>
              <tr>
                <th>Day</th>
                <th>Completed</th>
                <th>Accepted</th>
                <th>Turned down</th>
              </tr>
            </thead>
            <tbody>
              {byDay.map((day) => (
                <tr key={day.date}>
                  <td>{day.label}</td>
                  <td>
                    <span className="meter-cell">
                      <span className="meter" aria-hidden="true">
                        <span
                          className="person"
                          style={{ width: `${(day.completed / busiest) * 100}%` }}
                        />
                      </span>
                      <span>{day.completed}</span>
                    </span>
                  </td>
                  <td>{day.accepted}</td>
                  <td className={day.rejected ? 'late-text' : ''}>{day.rejected}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
