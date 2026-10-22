import type { ReactNode } from 'react';

export function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

export function Chips({
  items,
  empty,
  disabled,
  onRemove,
}: {
  items: { id: string; label: string }[];
  empty: string;
  disabled: boolean;
  onRemove: (id: string) => void;
}) {
  if (items.length === 0) {
    return <p className="muted small">{empty}</p>;
  }
  return (
    <div className="chips">
      {items.map((item) => (
        <span key={item.id} className="chip">
          {item.label}
          <button
            type="button"
            className="chip-remove"
            disabled={disabled}
            aria-label={`Remove ${item.label}`}
            onClick={() => onRemove(item.id)}
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}
