import { type EditField } from './location-shared';

// Small pieces the layout tree and the location panels share.

// "1 floor", "3 floors".
export const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

export function StatRow({ items }: { items: { label: string; value: number | string }[] }) {
  return (
    <dl className="stat-row">
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ChildCard({
  title,
  subtitle,
  active,
  onOpen,
}: {
  title: string;
  subtitle: string;
  active: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className={`card child-card${active ? '' : ' inactive'}`}
      onClick={onOpen}
    >
      <strong>{title}</strong>
      <span className="muted small">{subtitle}</span>
      {!active && <span className="badge">inactive</span>}
    </button>
  );
}

export const levelField: EditField = {
  name: 'level',
  label: 'Level',
  type: 'number',
  optional: true,
  help: '-1 basement, 0 ground, 1 first floor… Floors are listed in this order.',
};

export function levelPatch(changes: Record<string, string>): object {
  const { level, ...rest } = changes;
  if (level === undefined) return rest;
  return { ...rest, level: level.trim() === '' ? null : Number(level) };
}
