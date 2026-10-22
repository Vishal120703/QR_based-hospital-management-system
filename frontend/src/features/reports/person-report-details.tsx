import type { ActivityKind, PersonReport } from '../../api';
import { formatMinutes, formatPercent, formatWhen } from './report-format';
import { activityDetail, activityLabels, personBreakdown } from './person-report-format';
import { PrintHeader } from './report-parts';

const shownAtFirst = 60;

export function ActivityTable({
  report,
  timeZone,
  kind,
  showAll,
  onShowAll,
  onOpen,
}: {
  report: PersonReport;
  timeZone: string;
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
                <td className="small">{formatWhen(item.at, timeZone)}</td>
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

export function PrintablePersonReport({
  report,
  hospital,
}: {
  report: PersonReport;
  hospital: { name: string; logoUrl: string | null; timezone: string };
}) {
  const { work } = report;
  const { byService, byDay } = personBreakdown(report.activity, hospital.timezone);
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
                <td>{formatWhen(item.at, hospital.timezone)}</td>
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
