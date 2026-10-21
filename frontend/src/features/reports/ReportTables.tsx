import { Link } from 'react-router';
import { type RequestReport } from '../../api';
import { formatMinutes, formatWhen, outcomeLabels } from './report-format';
import { Meter } from './report-parts';

// The report's tables: work per person, requests not completed, and totals per
// department or service.

// Everyone who handled or assigned requests. A name opens that person's own
// report for the same period.
export function StaffTable({
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

export function NotCompleted({
  report,
  timeZone,
  onOpen,
}: {
  report: RequestReport;
  timeZone: string;
  onOpen: (id: string) => void;
}) {
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
            {item.location} · {item.publicId} · sent {formatWhen(item.submittedAt, timeZone)}
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
                <strong>{item.endedBy ?? 'unknown'}</strong> {formatWhen(item.endedAt, timeZone)}
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

export function GroupTable({ title, rows }: { title: string; rows: RequestReport['byService'] }) {
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
