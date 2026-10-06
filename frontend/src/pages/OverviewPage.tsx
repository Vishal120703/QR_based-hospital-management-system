import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  ApiError,
  staffApi,
  type Bed,
  type BedSession,
  type QrCode,
  type ServiceItem,
  type StaffMember,
  type StaffRequest,
} from '../api';
import { LoadState, PageHeading } from '../components';
import { isOverdue, isToday, openStatuses, useAutoRefresh, useNow } from '../request-status';
import { adminPages, useAdmin } from './AdminLayout';

interface Snapshot {
  requests: StaffRequest[] | null;
  beds: Bed[] | null;
  sessions: BedSession[] | null;
  qrCodes: QrCode[] | null;
  staff: StaffMember[] | null;
  services: ServiceItem[] | null;
}

const pageHelp: Record<string, string> = {
  requests: 'Assign, track, and close patient requests.',
  beds: 'Admit a patient to a bed and print its QR code.',
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
  const canBeds = can('bed.read');
  const canStaff = can('staff.read');
  const canServices = can('service.read');

  const fetchSnapshot = useCallback(async (): Promise<Snapshot> => {
    const optional = <T,>(allowed: boolean, fetch: () => Promise<T>) =>
      allowed ? fetch() : Promise.resolve(null);
    const [requests, beds, sessions, qrCodes, staff, services] = await Promise.all([
      optional(canRequests, () => staffApi.requests(token)),
      optional(canBeds, () => staffApi.list<Bed>(token, 'beds')),
      optional(canBeds, () => staffApi.list<BedSession>(token, 'bed-sessions', '?status=ACTIVE')),
      optional(canBeds, () => staffApi.list<QrCode>(token, 'qr-codes')),
      optional(canStaff, () => staffApi.list<StaffMember>(token, 'staff')),
      optional(canServices, () => staffApi.list<ServiceItem>(token, 'services')),
    ]);
    return { requests, beds, sessions, qrCodes, staff, services };
  }, [token, canRequests, canBeds, canStaff, canServices]);

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

  const shortcuts = adminPages.filter(
    (page) =>
      page.path !== 'overview' &&
      page.permissions.every((permission) =>
        'anyScope' in page ? canAnywhere(permission) : can(permission),
      ),
  );

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
          <Stats
            data={data}
            now={now}
            manager={canAnywhere('request.assign')}
            me={me.membershipId}
          />
          {can('hospital.manage') && <SetupChecklist data={data} />}
          <HowItWorks />
          <section aria-labelledby="shortcuts-title">
            <h2 id="shortcuts-title" className="section-title">
              Go to
            </h2>
            <div className="shortcut-grid">
              {shortcuts.map((page) => (
                <Link key={page.path} className="card shortcut" to={`/admin/${page.path}`}>
                  <strong>{page.label}</strong>
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
  now,
  manager,
  me,
}: {
  data: Snapshot;
  now: number;
  manager: boolean;
  me: string;
}) {
  const requests = (data.requests ?? []).filter((request) => manager || request.assigneeId === me);
  const open = requests.filter((request) => openStatuses.includes(request.status));
  const tiles: { label: string; value: number; hint: string; to: string; tone?: string }[] = [];
  if (data.requests) {
    if (manager) {
      tiles.push({
        label: 'Waiting for assignment',
        value: open.filter((request) => request.status === 'SUBMITTED').length,
        hint: 'New patient requests',
        to: '/admin/requests',
        tone: 'warning',
      });
    }
    tiles.push(
      {
        label: manager ? 'Being handled' : 'Your open work',
        value: open.filter((request) => (manager ? request.status !== 'SUBMITTED' : true)).length,
        hint: 'Assigned, accepted, or in progress',
        to: '/admin/requests',
      },
      {
        label: 'Overdue',
        value: open.filter((request) => isOverdue(request, now)).length,
        hint: 'Past the response-time target',
        to: '/admin/requests',
        tone: 'danger',
      },
      {
        label: 'Completed today',
        value: requests.filter((request) => isToday(request.completedAt, now)).length,
        hint: 'Finished by staff',
        to: '/admin/requests',
        tone: 'success',
      },
    );
  }
  if (data.beds) {
    const active = data.beds.filter((bed) => bed.active);
    tiles.push({
      label: 'Occupied beds',
      value: data.sessions?.length ?? 0,
      hint: `of ${active.length} active beds`,
      to: '/admin/beds',
    });
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

function SetupChecklist({ data }: { data: Snapshot }) {
  const occupiedBedIds = new Set((data.sessions ?? []).map((session) => session.bedId));
  const steps = [
    {
      done: (data.beds ?? []).length > 0,
      title: 'Add floors, wards, and beds',
      help: 'Describe your hospital layout.',
      to: '/admin/locations',
    },
    {
      done: (data.staff ?? []).some((member) => member.departmentIds.length > 0),
      title: 'Add staff to departments',
      help: 'Give each person a department and the wards they cover.',
      to: '/admin/staff',
    },
    {
      done: (data.services ?? []).some((service) => service.active),
      title: 'Turn on patient services',
      help: 'Choose what patients can ask for.',
      to: '/admin/services',
    },
    {
      done: (data.qrCodes ?? []).some(
        (qr) => qr.status === 'ACTIVE' && occupiedBedIds.has(qr.bedId),
      ),
      title: 'Admit a patient and print the QR',
      help: 'Start a bed session, then generate its QR code.',
      to: '/admin/beds',
    },
    {
      done: (data.requests ?? []).some((request) => request.status !== 'SUBMITTED'),
      title: 'Handle the first request',
      help: 'Assign a patient request to staff.',
      to: '/admin/requests',
    },
  ];
  const remaining = steps.filter((step) => !step.done).length;
  if (remaining === 0) return null;
  return (
    <section className="card checklist" aria-labelledby="checklist-title">
      <h2 id="checklist-title">
        Finish setting up ({steps.length - remaining} of {steps.length} done)
      </h2>
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
    </section>
  );
}

function HowItWorks() {
  return (
    <section className="card" aria-labelledby="how-title">
      <h2 id="how-title">How CARE QR works</h2>
      <ol className="setup-steps flow-steps">
        <li>
          <span>1</span>
          Patient scans the bed QR
          <small>No app or login. The QR only works while the bed has an active session.</small>
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
    </section>
  );
}
