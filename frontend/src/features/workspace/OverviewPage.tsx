import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  ApiError,
  staffApi,
  type Bed,
  type BedSession,
  type QrCode,
  type ServiceItem,
  type RequestQueue,
  type StaffMember,
} from '../../api';
import { LoadState, PageHeading } from '../../components';
import { useAutoRefresh, useNow } from '../../lib/request-status';
import { adminPages, pageInMenu, useAdmin } from './AdminLayout';

interface Snapshot {
  // Only the counts are used: one small page carries them.
  requests: RequestQueue | null;
  beds: Bed[] | null;
  sessions: BedSession[] | null;
  qrCodes: QrCode[] | null;
  staff: StaffMember[] | null;
  services: ServiceItem[] | null;
}

const pageHelp: Record<string, string> = {
  hospital: 'Your hospital name and logo, shown to staff and patients.',
  requests: 'Assign, track, and close patient requests.',
  'bed-management': 'See which beds are free or occupied; admit and discharge patients.',
  beds: 'Print, replace, and disable bedside QR codes.',
  roles: 'Decide who can do what, hospital-wide or for one floor, ward, or department.',
  locations: 'Add floors, wards, rooms, and beds.',
  departments: 'Teams that handle requests, like Nursing or Pantry.',
  staff: 'Add people, their departments, ward coverage, and duty.',
  eligibility: 'Check who could respond to a request at a bed.',
  services: 'Choose what patients can request from their bed.',
  sla: 'Set how quickly requests must be accepted and completed.',
};

function greeting(now: number): string {
  const hour = new Date(now).getHours();
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

export function OverviewPage() {
  const { token, me, can, canAnywhere, reportError } = useAdmin();
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = useNow();

  const canRequests = canAnywhere('request.read');
  // Floor and ward managers see the beds of their own area.
  const canBeds = canAnywhere('bed.read');
  const occupancy = me.tenant.bedOccupancyEnabled;
  const canStaff = can('staff.read');
  const canServices = can('service.read');

  const fetchSnapshot = useCallback(async (): Promise<Snapshot> => {
    const optional = <T,>(allowed: boolean, fetch: () => Promise<T>) =>
      allowed ? fetch() : Promise.resolve(null);
    const [requests, beds, sessions, qrCodes, staff, services] = await Promise.all([
      optional(canRequests, () => staffApi.requests(token, { pageSize: 1 })),
      optional(canBeds, () => staffApi.list<Bed>(token, 'beds')),
      optional(canBeds && occupancy, () =>
        staffApi.list<BedSession>(token, 'bed-sessions', '?status=ACTIVE'),
      ),
      optional(canBeds, () => staffApi.list<QrCode>(token, 'qr-codes')),
      optional(canStaff, () => staffApi.list<StaffMember>(token, 'staff')),
      optional(canServices, () => staffApi.list<ServiceItem>(token, 'services')),
    ]);
    return { requests, beds, sessions, qrCodes, staff, services };
  }, [token, canRequests, canBeds, occupancy, canStaff, canServices]);

  const showResult = useCallback(
    (result: Promise<Snapshot>, isCurrent: () => boolean = () => true) =>
      result.then(
        (snapshot) => {
          if (!isCurrent()) return;
          setData(snapshot);
          setError(null);
        },
        (cause: unknown) => {
          if (!isCurrent()) return;
          setError(cause instanceof Error ? cause.message : 'Could not load the overview.');
          if (cause instanceof ApiError && cause.status === 401) reportError(cause);
        },
      ),
    [reportError],
  );
  const load = useCallback(() => void showResult(fetchSnapshot()), [fetchSnapshot, showResult]);

  useEffect(() => {
    let current = true;
    void showResult(fetchSnapshot(), () => current);
    return () => {
      current = false;
    };
  }, [fetchSnapshot, showResult]);
  useAutoRefresh(load, 30_000);

  const shortcutOrder = [
    'requests',
    'bed-management',
    'beds',
    'locations',
    'staff',
    'services',
    'roles',
    'hospital',
  ];
  const shortcuts = adminPages
    .filter((page) => page.path !== 'overview' && pageInMenu(page, { can, canAnywhere, me }))
    .sort((left, right) => {
      const rank = (path: string) => {
        const position = shortcutOrder.indexOf(path);
        return position < 0 ? shortcutOrder.length : position;
      };
      return rank(left.path) - rank(right.path);
    })
    .slice(0, 4);

  return (
    <>
      <PageHeading
        title={`${greeting(now)}, ${me.user.displayName}`}
        description={`Here is what is happening at ${me.tenant.name} right now.`}
      />
      {!data ? (
        <LoadState loading={!error} error={error} label="Loading your overview…" onRetry={load} />
      ) : (
        <>
          <Stats data={data} manager={canAnywhere('request.assign')} occupancy={occupancy} />
          {can('hospital.manage') && (
            <SetupChecklist
              data={data}
              hasLogo={Boolean(me.tenant.logoUrl)}
              can={can}
              occupancy={occupancy}
            />
          )}
          {can('hospital.manage') && <HowItWorks occupancy={occupancy} />}
          <section aria-labelledby="shortcuts-title">
            <h2 id="shortcuts-title" className="section-title">
              Next places to go
            </h2>
            <div className="shortcut-grid">
              {shortcuts.map((page) => (
                <Link key={page.path} className="card shortcut" to={`/admin/${page.path}`}>
                  <strong>
                    <page.icon size={18} strokeWidth={1.9} aria-hidden="true" />
                    {page.label}
                  </strong>
                  <span className="muted small">{pageHelp[page.path]}</span>
                </Link>
              ))}
            </div>
          </section>
        </>
      )}
    </>
  );
}

function Stats({
  data,
  manager,
  occupancy,
}: {
  data: Snapshot;
  manager: boolean;
  occupancy: boolean;
}) {
  // Counted by the server: managers' counts cover their area, other staff
  // their own work, and "today" is the hospital's day.
  const counts = data.requests?.counts;
  const tiles: { label: string; value: number; hint: string; to: string; tone?: string }[] = [];
  if (counts) {
    if (manager) {
      tiles.push({
        label: 'Waiting for assignment',
        value: counts.waiting,
        hint: 'New patient requests',
        to: '/admin/requests',
        tone: 'warning',
      });
    }
    tiles.push(
      {
        label: manager ? 'Being handled' : 'Your open work',
        value: manager ? counts.open - counts.waiting : counts.open,
        hint: 'Assigned, accepted, or in progress',
        to: '/admin/requests',
      },
      {
        label: 'Overdue',
        value: counts.overdue,
        hint: 'Past the response-time target',
        to: '/admin/requests',
        tone: 'danger',
      },
      {
        label: 'Completed today',
        value: counts.completedToday,
        hint: 'Finished by staff',
        to: '/admin/requests',
        tone: 'success',
      },
    );
  }
  if (data.beds) {
    const active = data.beds.filter((bed) => bed.active);
    if (occupancy) {
      tiles.push({
        label: 'Occupied beds',
        value: data.sessions?.length ?? 0,
        hint: `of ${active.length} active beds`,
        to: '/admin/bed-management',
      });
    } else {
      // Without admissions, what matters is that every bed has a working QR.
      const activeIds = new Set(active.map((bed) => bed.id));
      tiles.push({
        label: 'Beds with a QR',
        value: (data.qrCodes ?? []).filter(
          (qr) => qr.status === 'ACTIVE' && activeIds.has(qr.bedId),
        ).length,
        hint: `of ${active.length} active beds`,
        to: '/admin/beds',
      });
    }
  }
  if (data.staff) {
    const working = data.staff.filter((member) => member.status === 'ACTIVE');
    tiles.push({
      label: 'Staff on duty',
      value: working.filter((member) => member.dutyStatus === 'ON_DUTY').length,
      hint: `of ${working.length} active staff`,
      to: '/admin/staff',
    });
  }
  if (tiles.length === 0) return null;
  return (
    <div className="stat-grid">
      {tiles.map((tile) => (
        <Link
          key={tile.label}
          to={tile.to}
          className={`card stat${tile.tone && tile.value > 0 ? ` stat-${tile.tone}` : ''}`}
        >
          <span>{tile.label}</span>
          <strong>{tile.value}</strong>
          <small className="muted">{tile.hint}</small>
        </Link>
      ))}
    </div>
  );
}

function SetupChecklist({
  data,
  hasLogo,
  can,
  occupancy,
}: {
  data: Snapshot;
  hasLogo: boolean;
  can: (permission: string) => boolean;
  occupancy: boolean;
}) {
  const occupiedBedIds = new Set((data.sessions ?? []).map((session) => session.bedId));
  const steps = [
    {
      done: hasLogo,
      available: can('hospital.manage'),
      title: 'Add your hospital logo',
      help: 'Shown to staff and patients, and printed on QR labels.',
      to: '/admin/hospital',
    },
    {
      done: (data.beds ?? []).length > 0,
      available: can('location.manage'),
      title: 'Add floors, wards, and beds',
      help: 'Describe your hospital layout.',
      to: '/admin/locations',
    },
    {
      done: (data.staff ?? []).some((member) => member.departmentIds.length > 0),
      available: can('staff.manage'),
      title: 'Add staff to departments',
      help: 'Give each person a department and the wards they cover.',
      to: '/admin/staff',
    },
    {
      done: (data.services ?? []).some((service) => service.active),
      available: can('service.manage'),
      title: 'Turn on patient services',
      help: 'Choose what patients can ask for.',
      to: '/admin/services',
    },
    occupancy
      ? {
          done: (data.qrCodes ?? []).some(
            (qr) => qr.status === 'ACTIVE' && occupiedBedIds.has(qr.bedId),
          ),
          available: can('bed.read') && can('bedSession.manage') && can('qr.generate'),
          title: 'Admit a patient and print the QR',
          help: 'Print the bed’s QR code, then admit the patient in Bed management.',
          to: '/admin/beds',
        }
      : {
          done: (data.qrCodes ?? []).some((qr) => qr.status === 'ACTIVE'),
          available: can('bed.read') && can('qr.generate'),
          title: 'Print the bedside QR codes',
          help: 'Patients can scan as soon as a label is on the bed.',
          to: '/admin/beds',
        },
    {
      // Any request that got past "waiting for assignment".
      done: data.requests
        ? data.requests.counts.open -
            data.requests.counts.waiting +
            data.requests.counts.completed +
            data.requests.counts.history >
          0
        : false,
      available: can('request.assign'),
      title: 'Handle the first request',
      help: 'Assign a patient request to staff.',
      to: '/admin/requests',
    },
  ].filter((step) => step.available);
  const remaining = steps.filter((step) => !step.done).length;
  if (remaining === 0) return null;
  const next = steps.find((step) => !step.done)!;
  return (
    <section className="card checklist" aria-labelledby="checklist-title">
      <h2 id="checklist-title">
        Finish setting up ({steps.length - remaining} of {steps.length} done)
      </h2>
      <p className="small">
        Next: <Link to={next.to}>{next.title}</Link>. {next.help}
      </p>
      <details>
        <summary>View all setup steps</summary>
        <ol>
          {steps.map((step) => (
            <li key={step.title} className={step.done ? 'done' : ''}>
              <span aria-hidden="true">{step.done ? '✓' : ''}</span>
              <div>
                <Link to={step.to}>{step.title}</Link>
                <small className="muted">{step.done ? 'Done' : step.help}</small>
              </div>
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}

function HowItWorks({ occupancy }: { occupancy: boolean }) {
  return (
    <details className="card" aria-label="How CARE QR works">
      <summary>How CARE QR works</summary>
      <ol className="setup-steps flow-steps">
        <li>
          <span>1</span>
          Patient scans the bed QR
          <small>
            No app or login.{' '}
            {occupancy
              ? 'The QR works only while a patient is admitted to the bed.'
              : 'The QR works as soon as it is on the bed.'}
          </small>
        </li>
        <li>
          <span>2</span>
          Patient asks for a service
          <small>Water, nurse help, cleaning… the request appears on the Requests screen.</small>
        </li>
        <li>
          <span>3</span>
          Manager assigns it
          <small>
            Only on-duty staff from the right department who cover that ward are offered.
          </small>
        </li>
        <li>
          <span>4</span>
          Staff do the work
          <small>Accept, start, and complete. The patient sees each step on their phone.</small>
        </li>
      </ol>
    </details>
  );
}
