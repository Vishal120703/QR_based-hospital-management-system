import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ApiError } from '../api';

interface LoadOptions<T> {
  // Shown when the request fails without a message of its own.
  failure: string;
  // Receives an expired-session error (401) so the layout can sign out.
  onUnauthorized: (cause: unknown) => void;
  // Runs with fresh data, for example to fill a form with the saved values.
  onLoaded?: (data: T) => void;
}

export interface Loaded<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  // Loads again in the background, for buttons such as Retry or Refresh.
  reload: () => void;
  // Loads again and resolves once the new data (or the error) is on screen,
  // so an action can stay busy until the screen is up to date.
  refresh: () => Promise<void>;
}

interface LoadState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

// Loads what a screen shows. `load` must be stable (wrap it in useCallback):
// it runs again when it changes. Data stays on screen while it reloads, and an
// answer that arrives after a newer request (or after leaving the screen) is
// ignored. Load errors are shown by the screen itself with Retry, never as a
// second banner; only an expired session goes to onUnauthorized.
export function useLoad<T>(load: () => Promise<T>, options: LoadOptions<T>): Loaded<T> {
  const [state, setState] = useState<LoadState<T>>({ data: null, loading: true, error: null });
  const latest = useRef(0);
  const settings = useRef(options);
  useLayoutEffect(() => {
    settings.current = options;
  });

  const run = useCallback(() => {
    const request = ++latest.current;
    return load().then(
      (data) => {
        if (request !== latest.current) return;
        settings.current.onLoaded?.(data);
        setState({ data, loading: false, error: null });
      },
      (cause: unknown) => {
        if (request !== latest.current) return;
        const message = cause instanceof Error ? cause.message : settings.current.failure;
        setState((current) => ({ ...current, loading: false, error: message }));
        if (cause instanceof ApiError && cause.status === 401)
          settings.current.onUnauthorized(cause);
      },
    );
  }, [load]);

  useEffect(() => {
    void run();
    return () => {
      latest.current += 1;
    };
  }, [run]);

  const refresh = useCallback(() => {
    setState((current) => ({ ...current, loading: true, error: null }));
    return run();
  }, [run]);
  const reload = useCallback(() => void refresh(), [refresh]);

  return { ...state, reload, refresh };
}
