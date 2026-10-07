import { useEffect, useState } from 'react';
import { reportApi, type RequestTimeline } from '../api';
import { LoadState, Modal } from '../components';
import { eventLabels, formatMinutes, formatWhen, outcomeLabels } from '../report-format';
import { useAdmin } from './AdminLayout';

// Everything that happened to one request: who did each step, when, and why.
export function RequestTimelineDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { token } = useAdmin();
  const [timeline, setTimeline] = useState<RequestTimeline | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    reportApi.timeline(token, id).then(
      (loaded) => {
        if (current) setTimeline(loaded);
      },
      (cause: unknown) => {
        if (current) setError(cause instanceof Error ? cause.message : 'Could not load history.');
      },
    );
    return () => {
      current = false;
    };
  }, [token, id, attempt]);

  return (
    <Modal
      title={timeline ? `${timeline.serviceName} · ${timeline.publicId}` : 'Request history'}
      onClose={onClose}
      wide
    >
      {!timeline ? (
        <LoadState
          loading={!error}
          error={error}
          label="Loading history…"
          onRetry={() => {
            setError(null);
            setAttempt((value) => value + 1);
          }}
        />
      ) : (
        <>
          <dl className="timeline-facts">
            <div>
              <dt>Where</dt>
              <dd>{timeline.location}</dd>
            </div>
            <div>
              <dt>Department</dt>
              <dd>{timeline.departmentName}</dd>
            </div>
            <div>
              <dt>Result</dt>
              <dd>
                {outcomeLabels[timeline.outcome]}
                {timeline.overdueMinutes !== null &&
                  ` · overdue by ${formatMinutes(timeline.overdueMinutes)}`}
              </dd>
            </div>
            <div>
              <dt>Accepted</dt>
              <dd>
                {timeline.minutesToAccept === null
                  ? 'Not yet'
                  : `${formatMinutes(timeline.minutesToAccept)} after sending`}
                {timeline.acceptedOnTime === false && <span className="late-text"> · late</span>}
              </dd>
            </div>
            <div>
              <dt>Completed</dt>
              <dd>
                {timeline.minutesToComplete === null
                  ? 'Not yet'
                  : `${formatMinutes(timeline.minutesToComplete)} after sending`}
                {timeline.completedOnTime === false && <span className="late-text"> · late</span>}
              </dd>
            </div>
          </dl>
          <ol className="timeline">
            {timeline.events.map((event, index) => (
              <li key={index} className={`timeline-${event.type.toLowerCase()}`}>
                <div className="timeline-head">
                  <strong>{eventLabels[event.type] ?? event.type}</strong>
                  <time dateTime={event.at}>{formatWhen(event.at)}</time>
                </div>
                <p>
                  by <strong>{event.actor.name}</strong>
                  {event.type === 'ASSIGNED' && event.assigneeName && <> to {event.assigneeName}</>}
                  {event.type === 'TRANSFERRED' && (
                    <>
                      {' '}
                      from {event.previousAssigneeName ?? 'someone'} to{' '}
                      {event.assigneeName ?? 'someone'}
                    </>
                  )}
                </p>
                {event.reason && <p className="timeline-reason">Reason: {event.reason}</p>}
              </li>
            ))}
          </ol>
        </>
      )}
    </Modal>
  );
}
