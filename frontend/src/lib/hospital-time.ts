// Calendar days in the hospital's own time zone (an IANA name such as
// "Asia/Kolkata", from the signed-in hospital). Report periods, day groupings,
// and times on reports follow it, whatever time zone the viewer's computer
// uses. Days are written 2026-10-12.

const dayPattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const dayMs = 86_400_000;

const toUtcDate = (day: string) => {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, date);
};

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

// The calendar day at that moment in the time zone.
export function dayIn(value: string | number | Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function addDays(day: string, count: number): string {
  return new Date(toUtcDate(day) + count * dayMs).toISOString().slice(0, 10);
}

// Whole days from one calendar day to another (0 for the same day).
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtcDate(to) - toUtcDate(from)) / dayMs);
}

// A calendar day in words, in the viewer's language: "12 Oct 2026".
export function dayLabel(
  day: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' },
): string {
  return new Date(toUtcDate(day)).toLocaleDateString(undefined, { ...options, timeZone: 'UTC' });
}
