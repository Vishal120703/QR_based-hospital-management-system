import { useCallback, useEffect, useState } from 'react';
import { Navigate, NavLink, Outlet, useLocation, useOutletContext } from 'react-router';
import { ApiError, credentials, staffApi, type Me } from '../api';
import { ErrorNotice, LoadState } from '../components';

export const adminPages = [
  { path: 'beds', label: 'Beds & QR', group: 'Care locations', permissions: ['bed.read'] },
  {
    path: 'locations',
    label: 'Location setup',
    group: 'Care locations',
    permissions: ['location.read'],
  },
  { path: 'departments', label: 'Departments', group: 'People', permissions: ['staff.read'] },
  { path: 'staff', label: 'Staff & coverage', group: 'People', permissions: ['staff.read'] },
  {
    path: 'eligibility',
    label: 'Who can respond?',
    group: 'People',
    permissions: ['staff.read', 'bed.read', 'location.read'],
  },
  {
    path: 'services',
    label: 'Service catalog',
    group: 'Patient services',
    permissions: ['service.read'],
  },
  {
    path: 'sla',
    label: 'Response targets (SLA)',
    group: 'Patient services',
    permissions: ['service.read'],
  },
] as const;

export interface AdminContext {
  token: string;
  me: Me;
  // Shows the error, or signs out when the session is no longer valid.
  reportError: (error: unknown) => void;
  reportSuccess: (message: string) => void;
  can: (permission: string) => boolean;
}

export function AdminIndex() {
  const { me } = useAdmin();
  const first = adminPages.find((page) =>
    page.permissions.every((permission) => me.permissions.includes(permission)),
  );
  return first ? (
    <Navigate to={first.path} replace />
  ) : (
    <p>
      Your account has no access to the setup screens. Ask your hospital administrator to assign the
      required permissions.
    </p>
  );
}

export function useAdmin(): AdminContext {
  return useOutletContext<AdminContext>();
}

export function AdminLayout() {
  const location = useLocation();
  const [token, setToken] = useState(() => credentials.staff());
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const signOut = useCallback(() => {
    credentials.setStaff(null);
    setToken(null);
  }, []);

  const reportError = useCallback(
    (cause: unknown) => {
      if (cause instanceof ApiError && cause.status === 401) {
        signOut();
        return;
      }
      setError(cause instanceof Error ? cause.message : 'Something went wrong.');
      setSuccess(null);
    },
    [signOut],
  );

  const reportSuccess = useCallback((message: string) => {
    setError(null);
    setSuccess(message);
  }, []);

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
  }, [token, version, reportError]);

  useEffect(() => {
    const syncSession = (event: StorageEvent) => {
      if (event.key !== 'careqr.staffToken' && event.key !== null) return;
      const nextToken = credentials.staff();
      if (nextToken === token) return;
      setMe(null);
      setError(null);
      setToken(nextToken);
    };
    window.addEventListener('storage', syncSession);
    return () => window.removeEventListener('storage', syncSession);
  }, [token]);

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  function logout(staffToken: string) {
    // Local access ends immediately, even if the server is unavailable.
    signOut();
    void staffApi.logout(staffToken).catch(() => null);
  }

  const can = (permission: string) => me?.permissions.includes(permission) ?? false;
  const context: AdminContext | null = me && { token, me, reportError, reportSuccess, can };
  const available = adminPages.filter((page) => page.permissions.every(can));
  const current = adminPages.find((page) => location.pathname === `/admin/${page.path}`);
  const allowed = !current || current.permissions.every(can);

  return (
    <div className="admin">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="topbar">
        <NavLink className="brand" to="/admin">
          <span className="brand-mark" aria-hidden="true">
            +
          </span>{' '}
          CARE QR
        </NavLink>
        <span className="topbar-user">
          {me && (
            <>
              <span>
                <strong>{me.tenant.name}</strong>
                <small>{me.user.displayName}</small>
              </span>
            </>
          )}
          <button type="button" className="link" onClick={() => logout(token)}>
            Sign out
          </button>
        </span>
      </header>
      <div className="admin-body">
        <aside className="sidebar">
          <p className="eyebrow">Hospital workspace</p>
          <nav aria-label="Hospital administration">
            {['Care locations', 'People', 'Patient services'].map((group) => {
              const pages = available.filter((page) => page.group === group);
              return (
                pages.length > 0 && (
                  <div className="nav-group" key={group}>
                    <span className="nav-label">{group}</span>
                    {pages.map((page) => (
                      <NavLink
                        key={page.path}
                        to={`/admin/${page.path}`}
                        onClick={() => {
                          setError(null);
                          setSuccess(null);
                        }}
                      >
                        {page.label}
                      </NavLink>
                    ))}
                  </div>
                )
              );
            })}
          </nav>
          <div className="sidebar-note">
            <strong>Setup & patient requests</strong>
            <p>
              Patients can submit and track requests. Staff routing and task screens come later.
            </p>
          </div>
        </aside>
        <main id="main-content" className="admin-main" tabIndex={-1}>
          {context && error && <ErrorNotice message={error} onDismiss={() => setError(null)} />}
          {success && (
            <div className="notice notice-success" role="status">
              <span>{success}</span>
              <button type="button" className="link" onClick={() => setSuccess(null)}>
                Dismiss
              </button>
            </div>
          )}
          {!context ? (
            <LoadState
              loading={!error}
              error={error}
              label="Checking your staff session…"
              onRetry={() => {
                setError(null);
                setVersion((value) => value + 1);
              }}
            />
          ) : allowed ? (
            <Outlet key={token} context={context} />
          ) : (
            <section className="card">
              <h1>Access restricted</h1>
              <p>
                Your role does not allow this screen. Choose an available section from the
                navigation, or contact your hospital administrator.
              </p>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
