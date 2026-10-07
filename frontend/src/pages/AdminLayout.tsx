import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  BedDouble,
  BellRing,
  ChartColumn,
  ChevronRight,
  ClipboardList,
  History,
  Hospital,
  LayoutDashboard,
  LogOut,
  MapPinned,
  Menu,
  ShieldCheck,
  Timer,
  UserRoundCheck,
  UserRoundCog,
  UsersRound,
  X,
} from 'lucide-react';
import { Navigate, NavLink, Outlet, useLocation, useOutletContext } from 'react-router';
import { ApiError, assetUrl, credentials, staffApi, type Me } from '../api';
import { ErrorNotice, LoadState } from '../components';

// `anyScope` pages filter their data by floor or ward on the server, so a
// permission held for only part of the hospital is enough to open them.
export const adminPages = [
  { path: 'overview', label: 'Overview', group: 'Work', permissions: [], icon: LayoutDashboard },
  {
    path: 'requests',
    label: 'Requests',
    group: 'Work',
    permissions: ['request.read'],
    anyScope: true,
    icon: ClipboardList,
  },
  {
    path: 'reports',
    label: 'Reports',
    group: 'Work',
    permissions: ['analytics.read'],
    anyScope: true,
    icon: ChartColumn,
  },
  {
    path: 'hospital',
    label: 'Profile & logo',
    group: 'Hospital',
    permissions: ['hospital.manage'],
    icon: Hospital,
  },
  {
    path: 'audit',
    label: 'Audit log',
    group: 'Hospital',
    permissions: ['audit.read'],
    icon: History,
  },
  {
    path: 'beds',
    label: 'Beds & QR',
    group: 'Care locations',
    permissions: ['bed.read'],
    anyScope: true,
    icon: BedDouble,
  },
  {
    path: 'locations',
    label: 'Location setup',
    group: 'Care locations',
    permissions: ['location.read', 'location.manage'],
    icon: MapPinned,
  },
  {
    path: 'departments',
    label: 'Departments',
    group: 'People',
    permissions: ['staff.read', 'staff.manage'],
    icon: UsersRound,
  },
  {
    path: 'staff',
    label: 'Staff & coverage',
    group: 'People',
    permissions: ['staff.read', 'staff.manage'],
    icon: UserRoundCog,
  },
  {
    path: 'roles',
    label: 'Roles & access',
    group: 'People',
    permissions: ['role.read'],
    icon: ShieldCheck,
  },
  {
    path: 'eligibility',
    label: 'Who can respond?',
    group: 'People',
    permissions: ['staff.read', 'bed.read', 'location.read'],
    icon: UserRoundCheck,
  },
  {
    path: 'services',
    label: 'Service catalog',
    group: 'Patient services',
    permissions: ['service.read'],
    icon: BellRing,
  },
  {
    path: 'sla',
    label: 'Response targets (SLA)',
    group: 'Patient services',
    permissions: ['service.read', 'sla.manage'],
    icon: Timer,
  },
] as const;

export interface AdminContext {
  token: string;
  me: Me;
  // Shows the error, or signs out when the session is no longer valid.
  reportError: (error: unknown) => void;
  reportSuccess: (message: string) => void;
  // Held hospital-wide.
  can: (permission: string) => boolean;
  // Held for at least one floor or ward (request work screens).
  canAnywhere: (permission: string) => boolean;
  // Reloads the signed-in profile, for example after the logo changes.
  refreshMe?: () => void;
}

type AdminPage = (typeof adminPages)[number];

function pageAllowed(page: AdminPage, context: Pick<AdminContext, 'can' | 'canAnywhere'>) {
  const check = 'anyScope' in page ? context.canAnywhere : context.can;
  return page.permissions.every((permission) => check(permission));
}

export function AdminIndex() {
  return <Navigate to="overview" replace />;
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const mainRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, [location.pathname]);

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
  const canAnywhere = (permission: string) =>
    (me?.scopedPermissions ?? me?.permissions ?? []).includes(permission);
  const context: AdminContext | null = me && {
    token,
    me,
    reportError,
    reportSuccess,
    can,
    canAnywhere,
    refreshMe: () => setVersion((value) => value + 1),
  };
  const available = adminPages.filter((page) => pageAllowed(page, { can, canAnywhere }));
  const current = adminPages.find((page) => location.pathname === `/admin/${page.path}`);
  const allowed = !current || pageAllowed(current, { can, canAnywhere });

  return (
    <div className="admin">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="topbar staff-topbar">
        <NavLink className="brand" to="/admin">
          <span className="brand-mark" aria-hidden="true">
            +
          </span>{' '}
          CARE QR
        </NavLink>
        <div className="topbar-current">
          <span>{current?.group ?? 'Work'}</span>
          <strong>{current?.label ?? 'Overview'}</strong>
        </div>
        <div className="topbar-user">
          {me && (
            <>
              {me.tenant.logoUrl ? (
                <img className="tenant-logo" src={assetUrl(me.tenant.logoUrl)} alt="" />
              ) : (
                <span className="tenant-avatar" aria-hidden="true">
                  {me.tenant.name.trim().charAt(0)}
                </span>
              )}
              <span className="topbar-identity">
                <strong>{me.tenant.name}</strong>
                <small>{me.user.displayName}</small>
              </span>
            </>
          )}
          <button type="button" className="secondary signout-button" onClick={() => logout(token)}>
            <LogOut size={16} aria-hidden="true" />
            <span>Sign out</span>
          </button>
        </div>
      </header>
      <div className="admin-body">
        <aside className="sidebar">
          <p className="eyebrow">Hospital workspace</p>
          <button
            type="button"
            className="mobile-nav-toggle secondary"
            aria-expanded={menuOpen}
            aria-controls="admin-navigation"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
            <span>{menuOpen ? 'Close menu' : `Menu · ${current?.label ?? 'Overview'}`}</span>
          </button>
          <nav
            id="admin-navigation"
            className={menuOpen ? 'is-open' : undefined}
            aria-label="Hospital administration"
          >
            {['Work', 'Hospital', 'Care locations', 'People', 'Patient services'].map((group) => {
              const pages = available.filter((page) => page.group === group);
              return (
                pages.length > 0 && (
                  <div className="nav-group" key={group}>
                    <h2 className="nav-label">{group}</h2>
                    {pages.map((page) => (
                      <NavLink
                        key={page.path}
                        to={`/admin/${page.path}`}
                        onClick={() => {
                          setMenuOpen(false);
                          setError(null);
                          setSuccess(null);
                          mainRef.current?.focus({ preventScroll: true });
                        }}
                      >
                        <page.icon size={17} strokeWidth={1.9} aria-hidden="true" />
                        <span>{page.label}</span>
                        <ChevronRight className="nav-chevron" size={14} aria-hidden="true" />
                      </NavLink>
                    ))}
                  </div>
                )
              );
            })}
          </nav>
          <div className="sidebar-note">
            <strong>{can('hospital.manage') ? 'Hospital setup' : 'Care workspace'}</strong>
            <p>
              {can('hospital.manage')
                ? 'Set up beds and print patient QR codes here.'
                : 'Use the sections available to your role. Patients use a bedside QR without signing in.'}
            </p>
          </div>
        </aside>
        <main ref={mainRef} id="main-content" className="admin-main" tabIndex={-1}>
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
