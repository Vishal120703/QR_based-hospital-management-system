import { useCallback, useEffect, useState } from 'react';
import { Navigate, NavLink, Outlet, useNavigate, useOutletContext } from 'react-router';
import { ApiError, credentials, staffApi, type Me } from '../api';
import { ErrorNotice } from '../components';

export interface AdminContext {
  token: string;
  me: Me;
  // Shows the error, or signs out when the session is no longer valid.
  reportError: (error: unknown) => void;
}

export function useAdmin(): AdminContext {
  return useOutletContext<AdminContext>();
}

export function AdminLayout() {
  const navigate = useNavigate();
  const [token] = useState(() => credentials.staff());
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  const signOut = useCallback(() => {
    credentials.setStaff(null);
    void navigate('/login', { replace: true });
  }, [navigate]);

  const reportError = useCallback(
    (cause: unknown) => {
      if (cause instanceof ApiError && cause.status === 401) {
        signOut();
        return;
      }
      setError(cause instanceof Error ? cause.message : 'Something went wrong.');
    },
    [signOut],
  );

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    staffApi.me(token).then(
      (result) => {
        if (!cancelled) setMe(result);
      },
      (cause: unknown) => {
        if (!cancelled) reportError(cause);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [token, reportError]);

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  function logout(staffToken: string) {
    // Sign out locally even if the server call fails; the session expires anyway.
    void staffApi
      .logout(staffToken)
      .catch(() => null)
      .then(signOut);
  }

  const context: AdminContext | null = me && { token, me, reportError };

  return (
    <div className="admin">
      <header className="topbar">
        <strong>CARE QR</strong>
        <nav>
          <NavLink to="/admin/beds">Beds &amp; QR</NavLink>
          <NavLink to="/admin/locations">Locations</NavLink>
        </nav>
        <span className="topbar-user">
          {me && (
            <>
              {me.tenant.name} · {me.user.displayName}
            </>
          )}
          <button type="button" className="link" onClick={() => logout(token)}>
            Sign out
          </button>
        </span>
      </header>
      <main className="admin-main">
        {error && <ErrorNotice message={error} onDismiss={() => setError(null)} />}
        {context ? <Outlet context={context} /> : <p className="muted">Loading…</p>}
      </main>
    </div>
  );
}
