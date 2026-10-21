import { minutes, type RequestFacts } from './report-facts.js';

export type ActivityKind =
  | 'assignedToThem'
  | 'accepted'
  | 'started'
  | 'completed'
  | 'rejected'
  | 'handedOver'
  | 'assignedOthers'
  | 'closed'
  | 'cancelled';

// Everything one person did, or that was given to them, newest first: what,
// when, on which request, with whom, how long it took, and whether on time.
// Pure: no database access.
export function personActivity(facts: readonly RequestFacts[], membershipId: string) {
  const items: {
    kind: ActivityKind;
    at: Date;
    requestId: string;
    publicId: string;
    serviceName: string;
    location: string;
    // The other person: who assigned it to them, or whom they gave it to.
    otherName: string | null;
    // Minutes from being assigned to accepting, or from accepting to completing.
    minutes: number | null;
    onTime: boolean | null;
    reason: string | null;
  }[] = [];

  for (const fact of facts) {
    let assignedAt: Date | null = null;
    let acceptedAt: Date | null = null;
    const add = (
      kind: ActivityKind,
      at: Date,
      extra: Partial<Pick<(typeof items)[number], 'otherName' | 'minutes' | 'onTime' | 'reason'>>,
    ) =>
      items.push({
        kind,
        at,
        requestId: fact.id,
        publicId: fact.publicId,
        serviceName: fact.serviceName,
        location: fact.location,
        otherName: extra.otherName ?? null,
        minutes: extra.minutes ?? null,
        onTime: extra.onTime ?? null,
        reason: extra.reason ?? null,
      });

    for (const event of fact.events) {
      const byThem = event.actor.membershipId === membershipId;
      switch (event.type) {
        case 'ASSIGNED':
        case 'TRANSFERRED':
          assignedAt = event.at;
          acceptedAt = null;
          if (event.assigneeId === membershipId) {
            add('assignedToThem', event.at, { otherName: event.actor.name, reason: event.reason });
          }
          if (event.type === 'TRANSFERRED' && event.previousAssigneeId === membershipId) {
            add('handedOver', event.at, { otherName: event.assigneeName, reason: event.reason });
          }
          if (byThem) {
            add('assignedOthers', event.at, {
              otherName: event.assigneeName,
              reason: event.reason,
            });
          }
          break;
        case 'ACCEPTED':
          acceptedAt = event.at;
          if (byThem) {
            add('accepted', event.at, {
              minutes: assignedAt ? minutes(assignedAt, event.at) : null,
              onTime: event.at <= fact.acceptDueAt,
            });
          }
          break;
        case 'STARTED':
          if (byThem) add('started', event.at, {});
          break;
        case 'COMPLETED':
          if (byThem) {
            add('completed', event.at, {
              minutes: acceptedAt ? minutes(acceptedAt, event.at) : null,
              onTime: event.at <= fact.completeDueAt,
            });
          }
          break;
        case 'REJECTED':
          if (byThem) add('rejected', event.at, { reason: event.reason });
          break;
        case 'CLOSED':
          if (byThem) add('closed', event.at, {});
          break;
        case 'CANCELLED':
          if (byThem) add('cancelled', event.at, { reason: event.reason });
          break;
      }
    }
  }
  return items.sort((left, right) => right.at.getTime() - left.at.getTime());
}
