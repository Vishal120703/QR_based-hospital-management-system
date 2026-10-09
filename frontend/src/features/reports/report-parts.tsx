import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { assetUrl } from '../../api';
import { formatWhen, periodLabel } from './report-format';

// A small bar for a share (0–100), such as "completed on time".
export function Meter({ value, label }: { value: number | null; label?: string }) {
  if (value === null) return <span className="muted">—</span>;
  const width = Math.max(0, Math.min(100, value));
  return (
    <span className="meter-cell">
      <span className="meter" aria-hidden="true">
        <span
          className={width >= 80 ? 'good' : width >= 50 ? 'fair' : 'poor'}
          style={{ width: `${width}%` }}
        />
      </span>
      <span>{label ?? `${Math.round(value)}%`}</span>
    </span>
  );
}

// True while the browser prints (Print / PDF button or Ctrl+P), so a page can
// lay out its full printable version only then.
export function usePrinting(): boolean {
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    const before = () => flushSync(() => setPrinting(true));
    const after = () => setPrinting(false);
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, []);
  return printing;
}

// The top of a printed report: the hospital's logo and name, what the report
// is, the period, and when it was printed.
export function PrintHeader({
  title,
  subject,
  hospital,
  range,
}: {
  title: string;
  subject?: string;
  hospital: { name: string; logoUrl: string | null };
  range: { from: string; to: string };
}) {
  return (
    <header className="print-header">
      {hospital.logoUrl && <img src={assetUrl(hospital.logoUrl)} alt="" />}
      <div>
        <h1>{subject ? `${title}: ${subject}` : title}</h1>
        <p>
          {hospital.name} · {periodLabel(range)} · printed {formatWhen(new Date().toISOString())}
        </p>
      </div>
    </header>
  );
}
