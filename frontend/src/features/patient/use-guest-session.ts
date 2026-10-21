import { useEffect } from 'react';
import { ApiError, guestApi } from '../../api';

// Ends the patient's session when it expires, and while the page is open
// rechecks that it has not been revoked (every 30 seconds, and whenever a
// mobile browser shows the page again).
export function useSessionExpiry(
  guestToken: string | null,
  expiresAt: string | null,
  endSession: () => void,
) {
  useEffect(() => {
    if (!guestToken || !expiresAt) return;
    let cancelled = false;
    const end = () => {
      if (!cancelled) endSession();
    };
    // End expired credentials locally, and recheck revocation while this
    // page is open (including when a mobile browser becomes visible again).
    const expiration = window.setTimeout(end, Math.max(0, Date.parse(expiresAt) - Date.now()));
    const validate = () => {
      if (document.visibilityState === 'hidden') return;
      void guestApi.session(guestToken).catch((cause: unknown) => {
        if (cause instanceof ApiError && cause.status === 401) end();
      });
    };
    const interval = window.setInterval(validate, 30_000);
    document.addEventListener('visibilitychange', validate);
    return () => {
      cancelled = true;
      window.clearTimeout(expiration);
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', validate);
    };
  }, [guestToken, expiresAt, endSession]);
}

// Refreshes request statuses every 30 seconds while the page is visible, and
// as soon as it becomes visible again.
export function useRefreshWhileOpen(
  ready: boolean,
  refreshRequests: (silent?: boolean) => Promise<void>,
) {
  useEffect(() => {
    if (!ready) return;
    const refreshWhenVisible = () => {
      if (document.visibilityState !== 'hidden') void refreshRequests(true);
    };
    const interval = window.setInterval(refreshWhenVisible, 30_000);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [ready, refreshRequests]);
}
