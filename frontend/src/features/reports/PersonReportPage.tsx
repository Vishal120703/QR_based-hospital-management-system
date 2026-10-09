import { Download, Printer } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { reportApi, type ActivityKind, type PersonReport } from '../../api';
import { LoadState, PageHeading } from '../../components';
import { useLoad } from '../../lib/use-load';
import { RequestTimelineDialog } from '../requests/RequestTimelineDialog';
import { useAdmin } from '../workspace/AdminLayout';
import {
  activityDetail,
  activityLabels,
  downloadText,
  formatMinutes,
  formatPercent,
  formatWhen,
  personBreakdown,
  personCsv,
  reportFileName,
} from './report-format';
import { Meter, PrintHeader, usePrinting } from './report-parts';
import { PeriodPicker, useReportPeriod } from './report-period';

const shownAtFirst = 60;

// One person's work: their figures beside the hospital's, day by day, by
// service, and every action they took or that was given to them.
export function PersonReportPage() {
  const { membershipId = '' } = useParams();
  const { token, me, reportError } = useAdmin();
  const navigate = useNavigate();
  const period = useReportPeriod();
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
  const hospital = { name: me.tenant.name, logoUrl: me.tenant.logoUrl };
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
                    report.range,
                  ),
                  personCsv(report, me.tenant.name),
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
            <Breakdown report={report} />
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

function Breakdown({ report }: { report: PersonReport }) {
  const { byService, byDay } = personBreakdown(report.activity);
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

function ActivityTable({
  report,
  kind,
  showAll,
  onShowAll,
  onOpen,
}: {
  report: PersonReport;
  kind: ActivityKind | '';
  showAll: boolean;
  onShowAll: () => void;
  onOpen: (requestId: string) => void;
}) {
  const matching = report.activity.filter((item) => !kind || item.kind === kind);
  const shown = showAll ? matching : matching.slice(0, shownAtFirst);
  if (matching.length === 0) return <p className="muted">Nothing in this period.</p>;
  return (
    <>
      <div className="table-wrap flat">
        <table className="report-table activity-table">
          <thead>
            <tr>
              <th>When</th>
              <th>What</th>
              <th>Request</th>
              <th>Where</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((item, index) => (
              <tr key={`${item.requestId}-${item.kind}-${index}`}>
                <td className="small">{formatWhen(item.at)}</td>
                <td>
                  <span className={`badge activity-${item.kind}`}>{activityLabels[item.kind]}</span>
                </td>
                <td>
                  <button type="button" className="link" onClick={() => onOpen(item.requestId)}>
                    {item.serviceName}
                  </button>
                  <div className="muted small code">{item.publicId}</div>
                </td>
                <td className="small">{item.location}</td>
                <td className={`small${item.onTime === false ? ' late-text' : ''}`}>
                  {activityDetail(item)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length < matching.length && (
        <button type="button" className="secondary" onClick={onShowAll}>
          Show all {matching.length}
        </button>
      )}
    </>
  );
}

// The person's report on paper (or as a PDF): every section at once.
function PrintablePersonReport({
  report,
  hospital,
}: {
  report: PersonReport;
  hospital: { name: string; logoUrl: string | null };
}) {
  const { work } = report;
  const { byService, byDay } = personBreakdown(report.activity);
  const rows: [string, string | number, string | number][] = [
    ['Assigned to them', work.assigned, ''],
    ['Accepted', work.accepted, ''],
    ['Completed', work.completed, ''],
    [
      'Completed on time',
      formatPercent(work.completedOnTimePercent),
      formatPercent(report.hospital.completedOnTimePercent),
    ],
    [
      'Average time to accept',
      formatMinutes(work.averageMinutesToAccept),
      formatMinutes(report.hospital.averageMinutesToAccept),
    ],
    [
      'Average work time',
      formatMinutes(work.averageMinutesOfWork),
      formatMinutes(report.hospital.averageMinutesOfWork),
    ],
    ['Turned down', work.rejected, ''],
    ['Handed over', work.transferredAway, ''],
    ['Open now', work.openNow, ''],
  ];
  return (
    <article className="print-only report-print">
      <PrintHeader
        title="Staff work report"
        subject={report.person.name}
        hospital={hospital}
        range={report.range}
      />
      <section>
        <h2>Summary</h2>
        <table>
          <thead>
            <tr>
              <th>Measure</th>
              <th>{report.person.name}</th>
              <th>Whole hospital</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, mine, all]) => (
              <tr key={label}>
                <td>{label}</td>
                <td>{mine}</td>
                <td>{all}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {work.rejectReasons.length > 0 && (
          <p>Reasons for turning down: {work.rejectReasons.join('; ')}</p>
        )}
      </section>
      {byService.length > 0 && (
        <section>
          <h2>By service</h2>
          <table>
            <thead>
              <tr>
                <th>Service</th>
                <th>Accepted</th>
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
                  <td>{service.accepted}</td>
                  <td>{service.completed}</td>
                  <td>{service.onTime}</td>
                  <td>{formatMinutes(service.averageWorkMinutes)}</td>
                  <td>{service.rejected}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {byDay.length > 0 && (
        <section>
          <h2>Day by day</h2>
          <table>
            <thead>
              <tr>
                <th>Day</th>
                <th>Accepted</th>
                <th>Completed</th>
                <th>Turned down</th>
              </tr>
            </thead>
            <tbody>
              {byDay.map((day) => (
                <tr key={day.date}>
                  <td>{day.label}</td>
                  <td>{day.accepted}</td>
                  <td>{day.completed}</td>
                  <td>{day.rejected}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <section>
        <h2>Every action</h2>
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>What</th>
              <th>Request</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {report.activity.map((item, index) => (
              <tr key={`${item.requestId}-${item.kind}-${index}`}>
                <td>{formatWhen(item.at)}</td>
                <td>{activityLabels[item.kind]}</td>
                <td>
                  {item.serviceName} ({item.publicId})
                </td>
                <td>{activityDetail(item)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </article>
  );
}
