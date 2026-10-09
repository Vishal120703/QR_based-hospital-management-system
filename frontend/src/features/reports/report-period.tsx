import { useState } from 'react';
import { useSearchParams } from 'react-router';

export type Period = 'today' | '7d' | '30d' | 'month' | 'custom';
export interface Range {
  from: string;
  to: string;
}
// Chosen dates as the date inputs hold them (YYYY-MM-DD).
interface Dates {
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

const day = (offset = 0, base = new Date()) => {
  const date = new Date(base);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return date;
};
const dateInput = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const isDate = (value: string | null): value is string =>
  value !== null && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));

export function rangeFor(period: Period, custom: Dates): Range {
  const now = new Date();
  if (period === 'custom') {
    const from = new Date(`${custom.from}T00:00:00`);
    const to = day(1, new Date(`${custom.to}T00:00:00`));
    return { from: from.toISOString(), to: to.toISOString() };
  }
  const from =
    period === 'today'
      ? day()
      : period === '7d'
        ? day(-6)
        : period === '30d'
          ? day(-29)
          : new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: from.toISOString(), to: now.toISOString() };
}

// The report period, kept in the address (?period=30d, or ?period=custom&
// from=…&to=…), so it stays the same when moving between the hospital report
// and one person's report, and a copied link shows the same period.
export function useReportPeriod() {
  const [params, setParams] = useSearchParams();
  const [initial] = useState(() => {
    const asked = periods.find((item) => item.id === params.get('period'))?.id ?? '7d';
    const from = params.get('from');
    const to = params.get('to');
    const dates = isDate(from) && isDate(to) && from <= to ? { from, to } : null;
    // Chosen dates need a valid start and end; otherwise show the last 7 days.
    const period: Period = asked === 'custom' && !dates ? '7d' : asked;
    return { period, custom: dates ?? { from: dateInput(day(-6)), to: dateInput(day()) } };
  });
  const [period, setPeriod] = useState<Period>(initial.period);
  const [custom, setCustom] = useState<Dates>(initial.custom);
  const [range, setRange] = useState<Range>(() => rangeFor(initial.period, initial.custom));

  const remember = (next: Period, dates: Dates) =>
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
    setCustom,
    choose(next: Period) {
      setPeriod(next);
      setRange(rangeFor(next, custom));
      remember(next, custom);
    },
    applyCustom() {
      setRange(rangeFor('custom', custom));
      remember('custom', custom);
    },
    // The same period, for a link to another report page.
    query:
      period === 'custom'
        ? `?period=custom&from=${custom.from}&to=${custom.to}`
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
              max={state.custom.to}
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
              min={state.custom.from}
              onChange={(event) =>
                state.setCustom((value) => ({ ...value, to: event.target.value }))
              }
            />
          </label>
          <button type="submit" className="secondary">
            Show
          </button>
        </form>
      )}
    </div>
  );
}
