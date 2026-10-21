import { describe, expect, it } from 'vitest';
import { personActivity } from '../../src/modules/reports/person-activity.js';
import { type RequestFacts, type TimelineEvent } from '../../src/modules/reports/report-facts.js';
import {
  groupFacts,
  notCompleted,
  requestSummary,
  staffPerformance,
} from '../../src/modules/reports/report-metrics.js';

const at = (minute: number) => new Date(Date.UTC(2026, 9, 1, 9, minute));
const staff = (membershipId: string, name: string) =>
  ({ type: 'STAFF', membershipId, name }) as const;
const manager = staff('m-meera', 'Meera');
const anjali = staff('m-anjali', 'Anjali');
const rahul = staff('m-rahul', 'Rahul');

function event(type: string, minute: number, changes: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    type,
    at: at(minute),
    actor: manager,
    reason: null,
    assigneeId: null,
    assigneeName: null,
    previousAssigneeId: null,
    previousAssigneeName: null,
    ...changes,
  };
}

function fact(id: string, changes: Partial<RequestFacts>): RequestFacts {
  return {
    id,
    publicId: `CR-${id}`,
    serviceName: 'Water',
    departmentId: 'pantry',
    departmentName: 'Pantry',
    priority: 'NORMAL',
    location: 'First Floor · Bed A 01',
    bedName: 'Bed A 01',
    status: 'CLOSED',
    outcome: 'completed',
    submittedAt: at(0),
    acceptDueAt: at(10),
    completeDueAt: at(30),
    assigneeId: null,
    assigneeName: null,
    assignedBy: null,
    acceptedBy: null,
    acceptedAt: null,
    completedBy: null,
    completedAt: null,
    closedBy: null,
    closedAt: null,
    endedBy: null,
    endedByType: null,
    endedAt: null,
    endReason: null,
    acceptedOnTime: null,
    completedOnTime: null,
    overdueMinutes: null,
    minutesToAccept: null,
    minutesToComplete: null,
    involved: [],
    events: [],
    ...changes,
  };
}

// Assigned to Anjali, accepted after 4 minutes, done on time, closed.
const done = fact('done', {
  acceptedOnTime: true,
  completedOnTime: true,
  minutesToAccept: 5,
  minutesToComplete: 20,
  events: [
    event('ASSIGNED', 1, { assigneeId: 'm-anjali', assigneeName: 'Anjali' }),
    event('ACCEPTED', 5, { actor: anjali }),
    event('STARTED', 6, { actor: anjali }),
    event('COMPLETED', 20, { actor: anjali }),
    event('CLOSED', 25),
  ],
});
// Assigned to Rahul, handed to Anjali, who turned it down.
const turnedDown = fact('turned-down', {
  serviceName: 'Linen',
  departmentId: 'housekeeping',
  departmentName: 'Housekeeping',
  status: 'REJECTED',
  outcome: 'rejected',
  endReason: 'Patient asleep',
  events: [
    event('ASSIGNED', 2, { assigneeId: 'm-rahul', assigneeName: 'Rahul' }),
    event('ACCEPTED', 3, { actor: rahul }),
    event('TRANSFERRED', 8, {
      assigneeId: 'm-anjali',
      assigneeName: 'Anjali',
      previousAssigneeId: 'm-rahul',
      previousAssigneeName: 'Rahul',
      reason: 'Shift ended',
    }),
    event('REJECTED', 9, { actor: anjali, reason: 'Patient asleep' }),
  ],
});
// Still open and 15 minutes past its accept deadline, assigned to Rahul.
const overdue = fact('overdue', {
  status: 'ASSIGNED',
  outcome: 'open',
  assigneeId: 'm-rahul',
  assigneeName: 'Rahul',
  overdueMinutes: 15,
  events: [event('ASSIGNED', 3, { assigneeId: 'm-rahul', assigneeName: 'Rahul' })],
});
const facts = [done, turnedDown, overdue];

describe('report metrics', () => {
  it('summarizes outcomes, on-time rates, and averages', () => {
    expect(requestSummary(facts)).toEqual({
      total: 3,
      open: 1,
      completed: 1,
      cancelled: 0,
      cancelledByPatient: 0,
      rejected: 1,
      overdueOpen: 1,
      acceptedOnTimePercent: 100,
      completedOnTimePercent: 100,
      averageMinutesToAccept: 5,
      averageMinutesToComplete: 20,
    });
  });

  it('groups by department, largest group first', () => {
    const groups = groupFacts(
      facts,
      (item) => item.departmentId,
      (item) => item.departmentName,
    );
    expect(groups.map((group) => [group.name, group.total, group.overdue])).toEqual([
      ['Pantry', 2, 1],
      ['Housekeeping', 1, 0],
    ]);
  });

  it('lists turned-down and overdue requests as not completed', () => {
    expect(notCompleted(facts).map((item) => [item.id, item.outcome, item.reason])).toEqual([
      ['turned-down', 'rejected', 'Patient asleep'],
      ['overdue', 'overdue', null],
    ]);
  });

  it('credits work to the person who did it, including after a handover', () => {
    const { rows, overall } = staffPerformance(facts);
    const byName = Object.fromEntries(rows.map((row) => [row.name, row]));
    expect(byName.Anjali).toMatchObject({
      assigned: 2,
      accepted: 1,
      completed: 1,
      completedOnTime: 1,
      rejected: 1,
      averageMinutesToAccept: 4,
      averageMinutesOfWork: 15,
      rejectReasons: ['Patient asleep'],
    });
    expect(byName.Rahul).toMatchObject({ assigned: 2, transferredAway: 1, openNow: 1 });
    expect(byName.Meera).toMatchObject({ assignmentsMade: 4, closed: 1 });
    expect(overall).toEqual({
      averageMinutesToAccept: 2.5,
      averageMinutesOfWork: 15,
      completedOnTimePercent: 100,
    });
  });

  it('lists one person’s activity, newest first', () => {
    expect(personActivity(facts, 'm-anjali').map((item) => [item.kind, item.otherName])).toEqual([
      ['completed', null],
      ['rejected', null],
      ['assignedToThem', 'Meera'],
      ['started', null],
      ['accepted', null],
      ['assignedToThem', 'Meera'],
    ]);
    expect(personActivity(facts, 'm-rahul').map((item) => item.kind)).toEqual([
      'handedOver',
      'accepted',
      'assignedToThem',
      'assignedToThem',
    ]);
  });
});
