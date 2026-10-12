import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { addDays, dayIn, daysBetween, isCalendarDay } from '../../lib/hospital-time';

export type Period = 'today' | '7d' | '30d' | 'month' | 'custom';
// A report period as whole hospital days (2026-10-12), both ends included.
// The server reads them in the hospital's time zone.
export interface Range {
  from: string;
  to: string;
}

export const periods: { id: Period; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: 'month', label: 'This month' },
  { id: 'custom', label: 'Choose dates' },
];

// The days of a ready-made period, counted back from the hospital's today.
export function rangeFor(period: Exclude<Period, 'custom'>, today: string): Range {
  switch (period) {
    case 'today':
      return { from: today, to: today };
    case '7d':
      return { from: addDays(today, -6), to: today };
    case '30d':
      return { from: addDays(today, -29), to: today };
    case 'month':
      return { from: `${today.slice(0, 8)}01`, to: today };
  }
}

// Why chosen dates cannot be shown, or null when they can. Checked before
// anything is sent, so a cleared or half-typed date never breaks the page.
export function datesProblem(dates: Range): string | null {
  if (!dates.from || !dates.to) return 'Choose both a start and an end date.';
  if (!isCalendarDay(dates.from) || !isCalendarDay(dates.to)) return 'Enter real dates.';
  if (dates.from > dates.to) return 'The start date must be on or before the end date.';
  if (daysBetween(dates.from, dates.to) > 365) return 'Choose a period of at most one year.';
  return null;
}

// The report period, kept in the address (?period=30d, or ?period=custom&
// from=…&to=…), so it stays the same when moving between the hospital report
// and one person's report, and a copied link shows the same period. "Today"
// is the hospital's today, in its own time zone.
export function useReportPeriod(timeZone: string) {
  const [params, setParams] = useSearchParams();
  const [initial] = useState(() => {
    const today = dayIn(Date.now(), timeZone);
    const asked = periods.find((item) => item.id === params.get('period'))?.id ?? '7d';
    const fromUrl = { from: params.get('from') ?? '', to: params.get('to') ?? '' };
    const usable = datesProblem(fromUrl) === null;
    // Chosen dates need a valid start and end; otherwise show the last 7 days.
    const period: Period = asked === 'custom' && !usable ? '7d' : asked;
    const custom = usable ? fromUrl : rangeFor('7d', today);
    return { period, custom, range: period === 'custom' ? custom : rangeFor(period, today) };
  });
  const [period, setPeriod] = useState<Period>(initial.period);
  const [custom, setCustom] = useState<Range>(initial.custom);
  const [range, setRange] = useState<Range>(initial.range);
  const problem = datesProblem(custom);

  const remember = (next: Period, dates: Range) =>
    setParams(
      (current) => {
        const updated = new URLSearchParams(current);
        updated.set('period', next);
        if (next === 'custom') {
          updated.set('from', dates.from);
          updated.set('to', dates.to);
        } else {
          updated.delete('from');
          updated.delete('to');
        }
        return updated;
      },
      { replace: true },
    );

  return {
    period,
    custom,
    range,
    // Why the chosen dates cannot be shown yet (null when they can).
    problem,
    setCustom,
    choose(next: Period) {
      setPeriod(next);
      if (next !== 'custom') {
        setRange(rangeFor(next, dayIn(Date.now(), timeZone)));
        remember(next, custom);
      } else if (!problem) {
        setRange(custom);
        remember('custom', custom);
      }
    },
    applyCustom() {
      if (problem) return;
      setRange(custom);
      remember('custom', custom);
    },
    // The same period, for a link to another report page.
    query:
      period === 'custom'
        ? `?period=custom&from=${range.from}&to=${range.to}`
        : `?period=${period}`,
  };
}

export type ReportPeriod = ReturnType<typeof useReportPeriod>;

export function PeriodPicker({ state }: { state: ReportPeriod }) {
  return (
    <div className="report-periods" role="group" aria-label="Period">
      {periods.map((item) => (
        <button
          key={item.id}
          type="button"
          className={state.period === item.id ? 'tab active' : 'tab'}
          aria-pressed={state.period === item.id}
          onClick={() => state.choose(item.id)}
        >
          {item.label}
        </button>
      ))}
      {state.period === 'custom' && (
        <form
          className="report-dates"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            state.applyCustom();
          }}
        >
          <label>
            From
            <input
              type="date"
              value={state.custom.from}
              max={state.custom.to || undefined}
              aria-invalid={state.problem !== null}
              onChange={(event) =>
                state.setCustom((value) => ({ ...value, from: event.target.value }))
              }
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={state.custom.to}
              min={state.custom.from || undefined}
              aria-invalid={state.problem !== null}
              onChange={(event) =>
                state.setCustom((value) => ({ ...value, to: event.target.value }))
              }
            />
          </label>
          <button type="submit" className="secondary" disabled={state.problem !== null}>
            Show
          </button>
          {state.problem && (
            <p className="late-text small" role="alert">
              {state.problem}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
