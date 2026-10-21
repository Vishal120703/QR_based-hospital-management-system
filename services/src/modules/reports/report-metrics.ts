import { minutes, type RequestFacts } from './report-facts.js';

// The figures in the hospital and person reports, computed from request
// facts. Pure: no database access.

export const average = (values: number[]) =>
  values.length === 0
    ? null
    : Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
export const percent = (part: number, whole: number) =>
  whole === 0 ? null : Math.round((part / whole) * 1000) / 10;

// Totals for the period: outcomes, on-time rates, and average times.
export function requestSummary(facts: readonly RequestFacts[]) {
  const count = (predicate: (fact: RequestFacts) => boolean) => facts.filter(predicate).length;
  const accepted = facts.filter((fact) => fact.acceptedOnTime !== null);
  const completed = facts.filter((fact) => fact.completedOnTime !== null);
  return {
    total: facts.length,
    open: count((fact) => fact.outcome === 'open'),
    completed: count((fact) => fact.outcome === 'completed'),
    cancelled: count((fact) => fact.outcome === 'cancelled'),
    cancelledByPatient: count(
      (fact) => fact.outcome === 'cancelled' && fact.endedByType === 'GUEST',
    ),
    rejected: count((fact) => fact.outcome === 'rejected'),
    overdueOpen: count((fact) => fact.overdueMinutes !== null),
    acceptedOnTimePercent: percent(
      accepted.filter((fact) => fact.acceptedOnTime).length,
      accepted.length,
    ),
    completedOnTimePercent: percent(
      completed.filter((fact) => fact.completedOnTime).length,
      completed.length,
    ),
    averageMinutesToAccept: average(
      facts.flatMap((fact) => (fact.minutesToAccept === null ? [] : [fact.minutesToAccept])),
    ),
    averageMinutesToComplete: average(
      facts.flatMap((fact) => (fact.minutesToComplete === null ? [] : [fact.minutesToComplete])),
    ),
  };
}

// The same counts per group (department or service), largest group first.
export function groupFacts(
  facts: readonly RequestFacts[],
  key: (fact: RequestFacts) => string,
  label: (fact: RequestFacts) => string,
) {
  const groups = new Map<string, RequestFacts[]>();
  for (const fact of facts) groups.set(key(fact), [...(groups.get(key(fact)) ?? []), fact]);
  return [...groups.values()]
    .map((items) => ({
      id: key(items[0]!),
      name: label(items[0]!),
      total: items.length,
      completed: items.filter((fact) => fact.outcome === 'completed').length,
      open: items.filter((fact) => fact.outcome === 'open').length,
      cancelled: items.filter((fact) => fact.outcome === 'cancelled').length,
      rejected: items.filter((fact) => fact.outcome === 'rejected').length,
      overdue: items.filter((fact) => fact.overdueMinutes !== null).length,
      averageMinutesToComplete: average(
        items.flatMap((fact) => (fact.minutesToComplete === null ? [] : [fact.minutesToComplete])),
      ),
    }))
    .sort((left, right) => right.total - left.total);
}

// Requests that were cancelled, turned down, or are overdue now (at most 200),
// with who ended them and why.
export function notCompleted(facts: readonly RequestFacts[]) {
  return facts
    .filter(
      (fact) =>
        fact.outcome === 'cancelled' || fact.outcome === 'rejected' || fact.overdueMinutes !== null,
    )
    .slice(0, 200)
    .map((fact) => ({
      id: fact.id,
      publicId: fact.publicId,
      serviceName: fact.serviceName,
      location: fact.location,
      status: fact.status,
      outcome: fact.overdueMinutes !== null ? 'overdue' : fact.outcome,
      submittedAt: fact.submittedAt,
      endedAt: fact.endedAt,
      endedBy: fact.endedBy,
      reason: fact.endReason,
      assigneeName: fact.assigneeName,
      overdueMinutes: fact.overdueMinutes,
    }));
}

// Per person: work assigned to them and what they did with it, plus the
// assignments and closures they made as a manager. Counted by staff ID.
// `overall` is the same measures across everyone, for comparison.
export function staffPerformance(facts: readonly RequestFacts[]) {
  interface Row {
    membershipId: string;
    name: string;
    assigned: number;
    accepted: number;
    completed: number;
    completedOnTime: number;
    rejected: number;
    transferredAway: number;
    openNow: number;
    assignmentsMade: number;
    closed: number;
    cancelled: number;
    acceptMinutes: number[];
    workMinutes: number[];
    rejectReasons: string[];
  }
  const rows = new Map<string, Row>();
  const row = (membershipId: string, name: string | null): Row => {
    let found = rows.get(membershipId);
    if (!found) {
      found = {
        membershipId,
        name: name ?? 'Former staff',
        assigned: 0,
        accepted: 0,
        completed: 0,
        completedOnTime: 0,
        rejected: 0,
        transferredAway: 0,
        openNow: 0,
        assignmentsMade: 0,
        closed: 0,
        cancelled: 0,
        acceptMinutes: [],
        workMinutes: [],
        rejectReasons: [],
      };
      rows.set(membershipId, found);
    }
    return found;
  };

  for (const fact of facts) {
    let assignedAt: Date | null = null;
    let acceptedAt: Date | null = null;
    for (const event of fact.events) {
      const actor = event.actor.membershipId
        ? row(event.actor.membershipId, event.actor.name)
        : null;
      switch (event.type) {
        case 'ASSIGNED':
        case 'TRANSFERRED':
          assignedAt = event.at;
          acceptedAt = null;
          if (actor) actor.assignmentsMade += 1;
          if (event.assigneeId) row(event.assigneeId, event.assigneeName).assigned += 1;
          if (event.type === 'TRANSFERRED' && event.previousAssigneeId) {
            row(event.previousAssigneeId, event.previousAssigneeName).transferredAway += 1;
          }
          break;
        case 'ACCEPTED':
          acceptedAt = event.at;
          if (actor) {
            actor.accepted += 1;
            if (assignedAt) actor.acceptMinutes.push(minutes(assignedAt, event.at));
          }
          break;
        case 'COMPLETED':
          if (actor) {
            actor.completed += 1;
            if (event.at <= fact.completeDueAt) actor.completedOnTime += 1;
            if (acceptedAt) actor.workMinutes.push(minutes(acceptedAt, event.at));
          }
          break;
        case 'REJECTED':
          if (actor) {
            actor.rejected += 1;
            if (event.reason) actor.rejectReasons.push(event.reason);
          }
          break;
        case 'CLOSED':
          if (actor) actor.closed += 1;
          break;
        case 'CANCELLED':
          if (actor) actor.cancelled += 1;
          break;
      }
    }
    if (fact.outcome === 'open' && fact.assigneeId) {
      row(fact.assigneeId, fact.assigneeName).openNow += 1;
    }
  }
  const everyone = [...rows.values()];
  const completedAll = everyone.reduce((sum, item) => sum + item.completed, 0);
  const overall = {
    averageMinutesToAccept: average(everyone.flatMap((item) => item.acceptMinutes)),
    averageMinutesOfWork: average(everyone.flatMap((item) => item.workMinutes)),
    completedOnTimePercent: percent(
      everyone.reduce((sum, item) => sum + item.completedOnTime, 0),
      completedAll,
    ),
  };
  return {
    overall,
    rows: everyone
      .map(({ acceptMinutes, workMinutes, rejectReasons, ...item }) => ({
        ...item,
        averageMinutesToAccept: average(acceptMinutes),
        averageMinutesOfWork: average(workMinutes),
        completedOnTimePercent: percent(item.completedOnTime, item.completed),
        rejectReasons: [...new Set(rejectReasons)].slice(0, 5),
      }))
      .sort(
        (left, right) =>
          right.assigned + right.assignmentsMade - (left.assigned + left.assignmentsMade) ||
          left.name.localeCompare(right.name),
      ),
  };
}

export type StaffWork = ReturnType<typeof staffPerformance>['rows'][number];

// The row for someone with no work in the period.
export function emptyWork(membershipId: string, name: string): StaffWork {
  return {
    membershipId,
    name,
    assigned: 0,
    accepted: 0,
    completed: 0,
    completedOnTime: 0,
    rejected: 0,
    transferredAway: 0,
    openNow: 0,
    assignmentsMade: 0,
    closed: 0,
    cancelled: 0,
    averageMinutesToAccept: null,
    averageMinutesOfWork: null,
    completedOnTimePercent: null,
    rejectReasons: [],
  };
}
