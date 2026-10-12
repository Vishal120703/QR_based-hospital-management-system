// Calendar days in a hospital's own time zone (an IANA name such as
// "Asia/Kolkata"). Report periods and "today" counts use these, so everyone
// sees the hospital's days whatever time zone their own computer is in. The
// runtime's time-zone data (Intl) handles daylight-saving changes.

const formatters = new Map<string, Intl.DateTimeFormat>();
const hourMs = 3_600_000;

interface WallClock {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

// The date and time a wall clock in the time zone shows at that instant.
function wallClock(instant: number, timeZone: string): WallClock {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(formatter.formatToParts(instant).find((part) => part.type === type)?.value);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  };
}

const pad = (value: number) => String(value).padStart(2, '0');
const dayPattern = /^(\d{4})-(\d{2})-(\d{2})$/;

// True for a real calendar day written as 2026-10-12.
export function isCalendarDay(value: string): boolean {
  const match = dayPattern.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

// The calendar day (2026-10-12) at that instant in the time zone.
export function dayIn(instant: Date | number, timeZone: string): string {
  const clock = wallClock(new Date(instant).getTime(), timeZone);
  return `${clock.year}-${pad(clock.month)}-${pad(clock.day)}`;
}

// The calendar day `count` days after (or before) another.
export function addDays(day: string, count: number): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, date + count)).toISOString().slice(0, 10);
}

// One end of a requested period. A calendar day is read in the hospital's
// time zone: as a start it means the start of that day, and as an end the
// whole day is included. An exact time is used as given.
export function periodStart(value: string, timeZone: string): Date {
  return isCalendarDay(value) ? startOfDay(value, timeZone) : new Date(value);
}
export function periodEnd(value: string, timeZone: string): Date {
  return isCalendarDay(value) ? startOfDay(addDays(value, 1), timeZone) : new Date(value);
}

// The first moment of a calendar day in the time zone: local midnight, or the
// moment the clocks jumped to if that day skipped midnight.
export function startOfDay(day: string, timeZone: string): Date {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  const utcMidnight = Date.UTC(year, month - 1, date);
  // Local midnight is UTC midnight minus the zone's offset. The offset can
  // differ on either side of a daylight-saving change, so try the offsets in
  // force around that day and keep a candidate that really is 00:00 there.
  const offsetAt = (instant: number) => {
    const clock = wallClock(instant, timeZone);
    const asUtc = Date.UTC(
      clock.year,
      clock.month - 1,
      clock.day,
      clock.hour,
      clock.minute,
      clock.second,
    );
    return asUtc - Math.floor(instant / 1000) * 1000;
  };
  const exact = [-14, 0, 12]
    .map((hours) => utcMidnight - offsetAt(utcMidnight + hours * hourMs))
    .filter((candidate) => {
      const clock = wallClock(candidate, timeZone);
      return dayIn(candidate, timeZone) === day && clock.hour === 0 && clock.minute === 0;
    });
  if (exact.length > 0) return new Date(Math.min(...exact));

  // Midnight did not exist that day: find the first second that is on it.
  let low = utcMidnight - 15 * hourMs;
  let high = utcMidnight + 15 * hourMs;
  while (high - low > 1000) {
    const middle = low + Math.floor((high - low) / 2000) * 1000;
    if (dayIn(middle, timeZone) >= day) high = middle;
    else low = middle;
  }
  return new Date(high);
}
