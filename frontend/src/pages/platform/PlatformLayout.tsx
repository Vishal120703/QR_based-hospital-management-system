import { useCallback, useEffect, useState } from 'react';
import { Navigate, NavLink, Outlet, useOutletContext } from 'react-router';
import { ApiError, credentials, platformApi } from '../../api';
import { ErrorNotice, LoadState } from '../../components';

export interface PlatformContext {
  token: string;
  user: { id: string; email: string; displayName: string };
  reportError: (error: unknown) => void;
  reportSuccess: (message: string) => void;
}

export function usePlatform(): PlatformContext {
  return useOutletContext<PlatformContext>();
}

export function PlatformLayout() {
  const [token, setToken] = useState(() => credentials.platform());
  const [user, setUser] = useState<PlatformContext['user'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const signOut = useCallback(() => {
    credentials.setPlatform(null);
    setToken(null);
  }, []);
  const reportError = useCallback(
    (cause: unknown) => {
      if (cause instanceof ApiError && cause.status === 401) {
        signOut();
        return;
      }
      setSuccess(null);
      setError(cause instanceof Error ? cause.message : 'Something went wrong.');
    },
    [signOut],
  );
  const reportSuccess = useCallback((message: string) => {
    setError(null);
    setSuccess(message);
  }, []);

  useEffect(() => {
    if (!token) return;
    let current = true;
    platformApi.me(token).then(
      (result) => {
        if (current) setUser(result.user);
      },
      (cause: unknown) => {
        if (current) reportError(cause);
      },
    );
    return () => {
      current = false;
    };
  }, [token, version, reportError]);

  if (!token) return <Navigate to="/platform/login" replace />;

  return (
    <div className="admin platform">
      <header className="topbar">
        <NavLink className="brand" to="/platform">
          <span className="brand-mark" aria-hidden="true">
            +
          </span>{' '}
          CARE QR Platform
        </NavLink>
        <span className="topbar-user">
          {user && (
            <span>
              <strong>{user.displayName}</strong>
              <small>Platform administrator</small>
            </span>
          )}
          <button
            type="button"
            className="link"
            onClick={() => {
              signOut();
              void platformApi.logout(token).catch(() => null);
            }}
          >
            Sign out
          </button>
        </span>
      </header>
      <main id="main-content" className="admin-main platform-main" tabIndex={-1}>
        {error && <ErrorNotice message={error} onDismiss={() => setError(null)} />}
        {success && (
          <div className="notice notice-success" role="status">
            <span>{success}</span>
            <button type="button" className="link" onClick={() => setSuccess(null)}>
              Dismiss
            </button>
          </div>
        )}
        {user ? (
          <Outlet context={{ token, user, reportError, reportSuccess } satisfies PlatformContext} />
        ) : (
          <LoadState
            loading={!error}
            error={error}
            label="Checking your platform session…"
            onRetry={() => {
              setError(null);
              setVersion((value) => value + 1);
            }}
          />
        )}
      </main>
    </div>
  );
}
