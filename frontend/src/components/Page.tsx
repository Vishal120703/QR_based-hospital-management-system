import { type ReactNode } from 'react';
import { ErrorNotice } from './Feedback';

// The parts every screen uses: its heading and its loading or error state.

export function PageHeading({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p className="muted">{description}</p>
      </div>
      {children}
    </div>
  );
}

export function LoadState({
  loading,
  error,
  onRetry,
  label = 'Loading…',
}: {
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  label?: string;
}) {
  if (error) {
    return (
      <section className="card load-state">
        <ErrorNotice message={error} />
        <button type="button" className="secondary" onClick={onRetry}>
          Try again
        </button>
      </section>
    );
  }
  return loading ? (
    <p className="muted" role="status">
      {label}
    </p>
  ) : null;
}

// Shown while a screen's code downloads (screens load on demand).
export function RouteLoading() {
  return (
    <p className="route-loading muted" role="status">
      Loading…
    </p>
  );
}
