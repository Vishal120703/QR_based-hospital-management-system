import { type RequestReport } from '../../api';
import { formatMinutes, formatPercent, outcomeLabels } from './report-format';
import { PrintHeader } from './report-parts';

// The whole report on paper (or as a PDF): every section at once.
export function PrintableReport({
  report,
  hospital,
}: {
  report: RequestReport;
  hospital: { name: string; logoUrl: string | null; timezone: string };
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
