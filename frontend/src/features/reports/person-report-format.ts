import type { ActivityKind, PersonActivity, PersonReport } from '../../api';
import { dayIn, dayLabel } from '../../lib/hospital-time';
import { formatMinutes, formatWhen, periodLabel, toCsv, type HospitalInfo } from './report-format';

export const activityLabels: Record<ActivityKind, string> = {
  assignedToThem: 'Assigned to them',
  accepted: 'Accepted',
  started: 'Started work',
  completed: 'Completed',
  rejected: 'Turned down',
  handedOver: 'Handed over',
  assignedOthers: 'Assigned to someone',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

export function activityDetail(item: PersonActivity): string {
  const parts: string[] = [];
  if (item.kind === 'assignedToThem' && item.otherName) parts.push(`by ${item.otherName}`);
  if ((item.kind === 'handedOver' || item.kind === 'assignedOthers') && item.otherName) {
    parts.push(`to ${item.otherName}`);
  }
  if (item.minutes !== null) {
    parts.push(
      item.kind === 'accepted'
        ? `${formatMinutes(item.minutes)} after being assigned`
        : `work took ${formatMinutes(item.minutes)}`,
    );
  }
  if (item.onTime !== null) parts.push(item.onTime ? 'on time' : 'late');
  if (item.reason) parts.push(`reason: ${item.reason}`);
  return parts.join(' · ');
}

export interface ServiceWork {
  name: string;
  accepted: number;
  completed: number;
  onTime: number;
  rejected: number;
  averageWorkMinutes: number | null;
}

export interface DayWork {
  date: string;
  label: string;
  accepted: number;
  completed: number;
  rejected: number;
}

export function personBreakdown(
  activity: readonly PersonActivity[],
  timeZone: string,
): {
  byService: ServiceWork[];
  byDay: DayWork[];
} {
  const services = new Map<string, ServiceWork & { minutes: number[] }>();
  const days = new Map<string, DayWork>();
  for (const item of activity) {
    if (item.kind !== 'accepted' && item.kind !== 'completed' && item.kind !== 'rejected') continue;
    const service = services.get(item.serviceName) ?? {
      name: item.serviceName,
      accepted: 0,
      completed: 0,
      onTime: 0,
      rejected: 0,
      averageWorkMinutes: null,
      minutes: [],
    };
    const date = dayIn(item.at, timeZone);
    const day = days.get(date) ?? {
      date,
      label: dayLabel(date, { weekday: 'short', day: 'numeric', month: 'short' }),
      accepted: 0,
      completed: 0,
      rejected: 0,
    };
    if (item.kind === 'accepted') {
      service.accepted += 1;
      day.accepted += 1;
    } else if (item.kind === 'completed') {
      service.completed += 1;
      day.completed += 1;
      if (item.onTime) service.onTime += 1;
      if (item.minutes !== null) service.minutes.push(item.minutes);
    } else {
      service.rejected += 1;
      day.rejected += 1;
    }
    services.set(item.serviceName, service);
    days.set(date, day);
  }
  return {
    byService: [...services.values()]
      .map(({ minutes, ...service }) => ({
        ...service,
        averageWorkMinutes: minutes.length
          ? Math.round((minutes.reduce((sum, value) => sum + value, 0) / minutes.length) * 10) / 10
          : null,
      }))
      .sort(
        (left, right) => right.completed - left.completed || left.name.localeCompare(right.name),
      ),
    byDay: [...days.values()].sort((left, right) => right.date.localeCompare(left.date)),
  };
}

export function personCsv(report: PersonReport, hospitalInfo: HospitalInfo): string {
  const minutesCell = (value: number | null) => (value === null ? null : Math.round(value));
  const { work, hospital } = report;
  const { byService, byDay } = personBreakdown(report.activity, hospitalInfo.timezone);
  return toCsv([
    ['CARE QR staff work report'],
    ['Person', report.person.name],
    ['Hospital', hospitalInfo.name],
    ['Period', periodLabel(report.range, hospitalInfo.timezone)],
    ['Downloaded', formatWhen(new Date().toISOString(), hospitalInfo.timezone)],
    [],
    ['Summary', 'This person', 'Whole hospital'],
    ['Assigned to them', work.assigned, null],
    ['Accepted', work.accepted, null],
    ['Completed', work.completed, null],
    ['Completed on time (%)', work.completedOnTimePercent, hospital.completedOnTimePercent],
    [
      'Average time to accept (minutes)',
      minutesCell(work.averageMinutesToAccept),
      minutesCell(hospital.averageMinutesToAccept),
    ],
    [
      'Average work time (minutes)',
      minutesCell(work.averageMinutesOfWork),
      minutesCell(hospital.averageMinutesOfWork),
    ],
    ['Turned down', work.rejected, null],
    ['Handed over to others', work.transferredAway, null],
    ['Open now', work.openNow, null],
    ['Assigned to others (as a manager)', work.assignmentsMade, null],
    ['Closed (as a manager)', work.closed, null],
    [],
    ['By service'],
    [
      'Service',
      'Accepted',
      'Completed',
      'Completed on time',
      'Turned down',
      'Average work time (minutes)',
    ],
    ...byService.map((item) => [
      item.name,
      item.accepted,
      item.completed,
      item.onTime,
      item.rejected,
      minutesCell(item.averageWorkMinutes),
    ]),
    [],
    ['Day by day'],
    ['Date', 'Accepted', 'Completed', 'Turned down'],
    ...byDay.map((item) => [item.date, item.accepted, item.completed, item.rejected]),
    [],
    ['Every action'],
    ['When', 'What', 'Request', 'Service', 'Where', 'With', 'Minutes', 'On time', 'Reason'],
    ...report.activity.map((item) => [
      formatWhen(item.at, hospitalInfo.timezone),
      activityLabels[item.kind],
      item.publicId,
      item.serviceName,
      item.location,
      item.otherName,
      item.minutes,
      item.onTime === null ? null : item.onTime ? 'yes' : 'no',
      item.reason,
    ]),
  ]);
}
