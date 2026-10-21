import { BedDouble, Download, Search, Wrench } from 'lucide-react';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { staffApi, type Bed, type BedSession, type StaffRequest } from '../../api';
import { type ConfirmQuestion, LoadState, PageHeading, useConfirm } from '../../components';
import { isOverdue, useAutoRefresh, useNow } from '../../lib/request-status';
import { useLoad } from '../../lib/use-load';
import { downloadText, formatWhen, toCsv } from '../reports/report-format';
import { useAdmin } from '../workspace/AdminLayout';
import {
  bedState,
  bedStateLabels,
  loadPlaces,
  placeOfBed,
  type BedPlace,
  type BedState,
} from './bed-places';

// A stay longer than this is flagged, so long admissions are reviewed.
const longStayHours = 7 * 24;
// Open requests are counted from at most this many (most urgent first).
const requestPages = 5;

interface BoardBed extends BedPlace {
  bed: Bed;
  state: BedState;
  session: BedSession | undefined;
  openRequests: number;
  overdueRequests: number;
}

interface Board {
  beds: BoardBed[];
  // More open requests exist than were counted.
  requestsTruncated: boolean;
}

// Open requests per bed, overdue first. Only for people who may read requests.
async function openRequestsByBed(token: string) {
  const byBed = new Map<string, StaffRequest[]>();
  let truncated = false;
  for (let page = 1; page <= requestPages; page += 1) {
    const queue = await staffApi.requests(token, { view: 'open', page, pageSize: 100 });
    for (const request of queue.serviceRequests) {
      byBed.set(request.bedId, [...(byBed.get(request.bedId) ?? []), request]);
    }
    if (page * queue.pageSize >= queue.total) return { byBed, truncated };
    truncated = page === requestPages;
  }
  return { byBed, truncated };
}

async function loadBoard(
  token: string,
  canReadLocations: boolean,
  canReadRequests: boolean,
): Promise<Board> {
  const now = Date.now();
  const [beds, places, sessions, requests] = await Promise.all([
    staffApi.list<Bed>(token, 'beds'),
    loadPlaces(token, canReadLocations),
    staffApi.list<BedSession>(token, 'bed-sessions', '?status=ACTIVE'),
    canReadRequests
      ? openRequestsByBed(token)
      : Promise.resolve({ byBed: new Map<string, StaffRequest[]>(), truncated: false }),
  ]);
  return {
    beds: beds.map((bed) => {
      const open = requests.byBed.get(bed.id) ?? [];
      return {
        bed,
        ...placeOfBed(bed, places),
        state: bedState(bed),
        session: sessions.find((item) => item.bedId === bed.id),
        openRequests: open.length,
        overdueRequests: open.filter((request) => isOverdue(request, now)).length,
      };
    }),
    requestsTruncated: requests.truncated,
  };
}

// "45 min", "6 h 20 min", "3 d 4 h".
export function stayLength(milliseconds: number): string {
  const minutes = Math.max(0, Math.floor(milliseconds / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days} d ${hours % 24} h` : `${days} d`;
}

// Share of beds that can take patients (available or occupied) now in use.
export function occupancy(beds: readonly { state: BedState }[]) {
  const occupied = beds.filter((bed) => bed.state === 'OCCUPIED').length;
  const usable = beds.filter((bed) => bed.state === 'OCCUPIED' || bed.state === 'AVAILABLE').length;
  return { occupied, usable, percent: usable ? Math.round((occupied / usable) * 100) : null };
}

type Filter = 'ALL' | BedState | 'LONG_STAY' | 'NEEDS_ATTENTION';

// Runs one bed action at a time: a second click while one is running is
// ignored (the buttons are also disabled once the screen updates).
function useOneAtATime() {
  const running = useRef(false);
  return useCallback(async (task: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    try {
      await task();
    } finally {
      running.current = false;
    }
  }, []);
}

// Bed management is the hospital's choice: some hospitals use the bedside QR
// codes only and never admit or discharge patients.
export function BedManagementPage() {
  const { me } = useAdmin();
  return me.tenant.bedOccupancyEnabled ? <BedBoard /> : <BedManagementOff />;
}

function BedManagementOff() {
  const { can } = useAdmin();
  return (
    <>
      <PageHeading
        title="Bed management"
        description="Which beds are free, occupied, or out of use, with admissions and discharges."
      />
      <section className="card occupancy-off" aria-labelledby="occupancy-off-title">
        <h2 id="occupancy-off-title">Bed management is turned off</h2>
        <p>
          This hospital uses bedside QR codes without admitting patients: a QR works as soon as it
          is on the bed, and beds are not shown as occupied.
        </p>
        <p>
          {can('hospital.manage') ? (
            <>
              To admit and discharge patients and see occupancy, turn it on in{' '}
              <Link to="/admin/hospital">Profile &amp; settings</Link>.
            </>
          ) : (
            'A hospital manager can turn it on.'
          )}
        </p>
        <Link className="button secondary" to="/admin/beds">
          Go to QR codes
        </Link>
      </section>
    </>
  );
}

// Every bed's state at a glance: occupancy by floor and ward, and a board of
// beds to admit, discharge, or take out of use for maintenance. QR codes are
// on their own screen.
function BedBoard() {
  const { token, me, can, canAnywhere, reportError, reportSuccess } = useAdmin();
  const confirm = useConfirm();
  const now = useNow();
  const oneAtATime = useOneAtATime();
  const [busyBedId, setBusyBedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [floorId, setFloorId] = useState('');
  const [wardId, setWardId] = useState('');
  const [search, setSearch] = useState('');
  const canReadLocations = canAnywhere('location.read');
  const canReadRequests = canAnywhere('request.read');
  const canAdmit = canAnywhere('bedSession.manage');
  const canMaintain = can('bed.manage');
  const timeZone = me.tenant.timezone;

  const { data, loading, error, reload, refresh } = useLoad(
    useCallback(
      () => loadBoard(token, canReadLocations, canReadRequests),
      [token, canReadLocations, canReadRequests],
    ),
    { failure: 'Could not load beds.', onUnauthorized: reportError },
  );
  // Admissions and discharges happen elsewhere too: keep the board current.
  useAutoRefresh(
    useCallback(() => {
      if (busyBedId === null) void refresh();
    }, [busyBedId, refresh]),
    30_000,
  );

  const beds = useMemo(() => data?.beds ?? [], [data]);
  const isLongStay = useCallback(
    (item: BoardBed) =>
      item.session !== undefined &&
      now - Date.parse(item.session.startedAt) > longStayHours * 3_600_000,
    [now],
  );

  async function act(
    item: BoardBed,
    action: () => Promise<unknown>,
    done: string,
    question?: ConfirmQuestion,
  ) {
    await oneAtATime(async () => {
      if (question && !(await confirm(question))) return;
      setBusyBedId(item.bed.id);
      try {
        await action();
        reportSuccess(done);
        await refresh();
      } catch (cause) {
        reportError(cause);
      } finally {
        setBusyBedId(null);
      }
    });
  }

  // The list of stays shows at most the newest 100; look up any other one.
  async function activeSession(item: BoardBed): Promise<BedSession> {
    if (item.session) return item.session;
    const [found] = await staffApi.list<BedSession>(
      token,
      'bed-sessions',
      `?bedId=${item.bed.id}&status=ACTIVE`,
    );
    if (!found) throw new Error('This bed has no active stay. Refresh and try again.');
    return found;
  }

  if (!data) {
    return <LoadState loading={!error} error={error} label="Loading beds…" onRetry={reload} />;
  }

  const counts = {
    ALL: beds.length,
    AVAILABLE: beds.filter((item) => item.state === 'AVAILABLE').length,
    OCCUPIED: beds.filter((item) => item.state === 'OCCUPIED').length,
    MAINTENANCE: beds.filter((item) => item.state === 'MAINTENANCE').length,
    OUT_OF_SERVICE: beds.filter((item) => item.state === 'OUT_OF_SERVICE').length,
    LONG_STAY: beds.filter(isLongStay).length,
    NEEDS_ATTENTION: beds.filter((item) => item.overdueRequests > 0).length,
  };
  const overall = occupancy(beds);
  const floors = [...new Map(beds.map((item) => [item.floorId ?? '', item])).values()]
    .filter((item) => item.floorId)
    .sort(
      (left, right) =>
        (left.floorLevel ?? 0) - (right.floorLevel ?? 0) ||
        (left.floorName ?? '').localeCompare(right.floorName ?? ''),
    );
  const wardsOnFloor = [
    ...new Map(
      beds
        .filter((item) => !floorId || item.floorId === floorId)
        .map((item) => [item.wardId, item]),
    ).values(),
  ].sort((left, right) => (left.wardName ?? '').localeCompare(right.wardName ?? ''));
  const query = search.trim().toLowerCase();
  const visible = beds.filter(
    (item) =>
      (filter === 'ALL' ||
        (filter === 'LONG_STAY'
          ? isLongStay(item)
          : filter === 'NEEDS_ATTENTION'
            ? item.overdueRequests > 0
            : item.state === filter)) &&
      (!floorId || item.floorId === floorId) &&
      (!wardId || item.wardId === wardId) &&
      (!query ||
        `${item.bed.displayName} ${item.bed.code} ${item.location}`.toLowerCase().includes(query)),
  );
  // Group the visible beds by floor, then ward, for the board.
  const groups = new Map<string, { title: string; wards: Map<string, BoardBed[]> }>();
  for (const item of visible) {
    const floorKey = item.floorId ?? 'unknown';
    const floor = groups.get(floorKey) ?? {
      title: item.floorName ?? 'Other beds',
      wards: new Map<string, BoardBed[]>(),
    };
    floor.wards.set(item.wardId, [...(floor.wards.get(item.wardId) ?? []), item]);
    groups.set(floorKey, floor);
  }

  function downloadOccupancy() {
    const rows = [...visible].sort((left, right) => left.location.localeCompare(right.location));
    downloadText(
      `care-qr-beds-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv([
        [
          'Bed',
          'Code',
          'Location',
          'Status',
          'Admitted since',
          'Length of stay (hours)',
          'Open requests',
          'Overdue requests',
        ],
        ...rows.map((item) => [
          item.bed.displayName,
          item.bed.code,
          item.location,
          bedStateLabels[item.state],
          item.session ? formatWhen(item.session.startedAt, timeZone) : null,
          item.session
            ? Math.floor((Date.now() - Date.parse(item.session.startedAt)) / 3_600_000)
            : null,
          item.openRequests,
          item.overdueRequests,
        ]),
      ]),
    );
  }

  const filters: { id: Filter; label: string }[] = [
    { id: 'ALL', label: 'All beds' },
    { id: 'AVAILABLE', label: 'Available' },
    { id: 'OCCUPIED', label: 'Occupied' },
    { id: 'MAINTENANCE', label: 'Under maintenance' },
    { id: 'OUT_OF_SERVICE', label: 'Out of service' },
    { id: 'LONG_STAY', label: 'Long stays' },
    ...(canReadRequests ? [{ id: 'NEEDS_ATTENTION' as const, label: 'Overdue requests' }] : []),
  ];

  return (
    <>
      <PageHeading
        title="Bed management"
        description="Which beds are free, occupied, or out of use, across every floor and ward. Admit a patient to start their bedside QR access, and discharge them when they leave."
      >
        <div className="page-actions">
          <button
            type="button"
            className="secondary icon-button"
            disabled={visible.length === 0}
            onClick={downloadOccupancy}
            title="The beds shown below, in a spreadsheet"
          >
            <Download size={16} aria-hidden="true" />
            Download
          </button>
          <button type="button" className="secondary" disabled={loading} onClick={reload}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </PageHeading>
      <LoadState loading={false} error={error} onRetry={reload} />

      <div className="stat-grid bed-stats">
        <div className="card stat static">
          <span>Occupancy</span>
          <strong>{overall.percent === null ? '—' : `${overall.percent}%`}</strong>
          <small className="muted">
            {overall.occupied} of {overall.usable} usable beds
          </small>
        </div>
        {(['AVAILABLE', 'OCCUPIED', 'MAINTENANCE', 'OUT_OF_SERVICE'] as const).map((state) => (
          <button
            key={state}
            type="button"
            className={`card stat bed-stat bed-stat-${state.toLowerCase()}`}
            aria-pressed={filter === state}
            onClick={() => setFilter(filter === state ? 'ALL' : state)}
          >
            <span>{bedStateLabels[state]}</span>
            <strong>{counts[state]}</strong>
          </button>
        ))}
        <button
          type="button"
          className="card stat bed-stat"
          aria-pressed={filter === 'LONG_STAY'}
          onClick={() => setFilter(filter === 'LONG_STAY' ? 'ALL' : 'LONG_STAY')}
        >
          <span>Long stays</span>
          <strong>{counts.LONG_STAY}</strong>
          <small className="muted">over 7 days</small>
        </button>
      </div>

      {beds.length === 0 ? (
        <div className="card empty-state">
          <p>
            No beds yet.{' '}
            {can('location.manage') ? (
              <Link to="/admin/locations">Set up floors, wards, and beds</Link>
            ) : (
              'Ask your hospital manager to set up beds.'
            )}
          </p>
        </div>
      ) : (
        <>
          <OccupancyByArea beds={beds} />

          <section className="card bed-board" aria-labelledby="bed-board-title">
            <div className="section-heading">
              <h2 id="bed-board-title">Beds</h2>
              <span className="muted small" role="status">
                {visible.length} of {beds.length} beds
              </span>
            </div>
            <div className="filter-chips" role="group" aria-label="Show">
              {filters.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={filter === item.id ? 'tab active' : 'tab'}
                  aria-pressed={filter === item.id}
                  onClick={() => setFilter(item.id)}
                >
                  {item.label} <span className="count">{counts[item.id]}</span>
                </button>
              ))}
            </div>
            <div className="toolbar">
              <label className="search-field">
                <span>Find a bed</span>
                <span className="input-with-icon">
                  <Search size={16} aria-hidden="true" />
                  <input
                    type="search"
                    placeholder="Bed, room, ward, or floor…"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </span>
              </label>
              {floors.length > 1 && (
                <label>
                  <span>Floor</span>
                  <select
                    value={floorId}
                    onChange={(event) => {
                      setFloorId(event.target.value);
                      setWardId('');
                    }}
                  >
                    <option value="">All floors</option>
                    {floors.map((item) => (
                      <option key={item.floorId} value={item.floorId}>
                        {item.floorName}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {wardsOnFloor.length > 1 && (
                <label>
                  <span>Ward</span>
                  <select value={wardId} onChange={(event) => setWardId(event.target.value)}>
                    <option value="">All wards</option>
                    {wardsOnFloor.map((item) => (
                      <option key={item.wardId} value={item.wardId}>
                        {item.wardName ?? 'Ward'}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            {data.requestsTruncated && (
              <p className="notice notice-warning small">
                Open-request counts cover the 500 most urgent requests.
              </p>
            )}

            {visible.length === 0 ? (
              <p className="muted">No beds match. Choose another filter or clear the search.</p>
            ) : (
              [...groups.entries()].map(([floorKey, floor]) => (
                <section key={floorKey} className="bed-floor" aria-label={floor.title}>
                  <h3>{floor.title}</h3>
                  {[...floor.wards.entries()].map(([key, wardBeds]) => (
                    <div key={key} className="bed-ward">
                      <h4>
                        {wardBeds[0]?.wardName ?? 'Ward'}
                        <span className="muted small">
                          {' '}
                          · {occupancy(wardBeds).occupied} of {occupancy(wardBeds).usable} occupied
                        </span>
                      </h4>
                      <ul className="bed-tiles">
                        {wardBeds
                          .sort((left, right) =>
                            left.bed.displayName.localeCompare(right.bed.displayName, undefined, {
                              numeric: true,
                            }),
                          )
                          .map((item) => (
                            <BedTile
                              key={item.bed.id}
                              item={item}
                              now={now}
                              timeZone={timeZone}
                              longStay={isLongStay(item)}
                            >
                              {item.state === 'AVAILABLE' && canAdmit && (
                                <button
                                  type="button"
                                  disabled={busyBedId !== null}
                                  onClick={() =>
                                    void act(
                                      item,
                                      () => staffApi.startSession(token, item.bed.id),
                                      `Patient admitted to ${item.bed.displayName}.`,
                                      {
                                        title: `Admit a patient to ${item.bed.displayName}?`,
                                        message:
                                          'The bed becomes occupied and its bedside QR starts working for the patient.',
                                        confirmLabel: 'Admit',
                                      },
                                    )
                                  }
                                >
                                  Admit
                                </button>
                              )}
                              {item.state === 'OCCUPIED' && canAdmit && (
                                <button
                                  type="button"
                                  className="secondary"
                                  disabled={busyBedId !== null}
                                  onClick={() =>
                                    void act(
                                      item,
                                      async () =>
                                        staffApi.closeSession(
                                          token,
                                          (await activeSession(item)).id,
                                        ),
                                      `Patient discharged from ${item.bed.displayName}.`,
                                      {
                                        title: `Discharge the patient from ${item.bed.displayName}?`,
                                        message:
                                          'Anyone using this bed’s QR is signed out, and the bed becomes available.',
                                        confirmLabel: 'Discharge',
                                        danger: true,
                                      },
                                    )
                                  }
                                >
                                  Discharge
                                </button>
                              )}
                              {item.state === 'AVAILABLE' && canMaintain && (
                                <button
                                  type="button"
                                  className="secondary"
                                  disabled={busyBedId !== null}
                                  onClick={() =>
                                    void act(
                                      item,
                                      () =>
                                        staffApi.updateLocation(token, 'beds', item.bed.id, {
                                          status: 'MAINTENANCE',
                                        }),
                                      `${item.bed.displayName} is under maintenance.`,
                                      {
                                        title: `Take ${item.bed.displayName} out of use for maintenance?`,
                                        message:
                                          'No patient can be admitted to it until it is back in service.',
                                        confirmLabel: 'Mark under maintenance',
                                      },
                                    )
                                  }
                                >
                                  Maintenance
                                </button>
                              )}
                              {item.state === 'MAINTENANCE' && canMaintain && (
                                <button
                                  type="button"
                                  disabled={busyBedId !== null}
                                  onClick={() =>
                                    void act(
                                      item,
                                      () =>
                                        staffApi.updateLocation(token, 'beds', item.bed.id, {
                                          status: 'AVAILABLE',
                                        }),
                                      `${item.bed.displayName} is available again.`,
                                    )
                                  }
                                >
                                  Back in service
                                </button>
                              )}
                            </BedTile>
                          ))}
                      </ul>
                    </div>
                  ))}
                </section>
              ))
            )}
          </section>
        </>
      )}
    </>
  );
}

// Occupancy per floor and ward, busiest first within each floor.
function OccupancyByArea({ beds }: { beds: readonly BoardBed[] }) {
  const floors = new Map<
    string,
    { title: string; level: number; wards: Map<string, BoardBed[]> }
  >();
  for (const item of beds) {
    const key = item.floorId ?? 'unknown';
    const floor = floors.get(key) ?? {
      title: item.floorName ?? 'Other beds',
      level: item.floorLevel ?? 0,
      wards: new Map<string, BoardBed[]>(),
    };
    floor.wards.set(item.wardId, [...(floor.wards.get(item.wardId) ?? []), item]);
    floors.set(key, floor);
  }
  const ordered = [...floors.values()].sort(
    (left, right) => left.level - right.level || left.title.localeCompare(right.title),
  );
  return (
    <section className="card bed-areas" aria-labelledby="bed-areas-title">
      <h2 id="bed-areas-title">Occupancy by floor and ward</h2>
      <div className="table-wrap flat">
        <table className="report-table">
          <thead>
            <tr>
              <th>Floor / ward</th>
              <th>Occupied</th>
              <th>Available</th>
              <th>Out of use</th>
              <th>Occupancy</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((floor) => {
              const floorBeds = [...floor.wards.values()].flat();
              return [
                <AreaRow key={floor.title} title={floor.title} beds={floorBeds} strong />,
                ...[...floor.wards.entries()].map(([wardId, wardBeds]) => (
                  <AreaRow key={wardId} title={wardBeds[0]?.wardName ?? 'Ward'} beds={wardBeds} />
                )),
              ];
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AreaRow({
  title,
  beds,
  strong = false,
}: {
  title: string;
  beds: readonly BoardBed[];
  strong?: boolean;
}) {
  const share = occupancy(beds);
  const outOfUse = beds.filter(
    (item) => item.state === 'MAINTENANCE' || item.state === 'OUT_OF_SERVICE',
  ).length;
  return (
    <tr className={strong ? 'area-floor' : 'area-ward'}>
      <td>{strong ? <strong>{title}</strong> : <span className="area-ward-name">{title}</span>}</td>
      <td>{share.occupied}</td>
      <td>{beds.filter((item) => item.state === 'AVAILABLE').length}</td>
      <td>{outOfUse || <span className="muted">0</span>}</td>
      <td>
        <span className="meter-cell">
          <span className="meter" aria-hidden="true">
            <span className="occupancy" style={{ width: `${share.percent ?? 0}%` }} />
          </span>
          <span>{share.percent === null ? '—' : `${share.percent}%`}</span>
        </span>
      </td>
    </tr>
  );
}

function BedTile({
  item,
  now,
  timeZone,
  longStay,
  children,
}: {
  item: BoardBed;
  now: number;
  timeZone: string;
  longStay: boolean;
  // The buttons this person may use on this bed.
  children: ReactNode;
}) {
  const { bed, state, session } = item;
  return (
    <li className={`bed-tile bed-tile-${state.toLowerCase()}`} aria-label={bed.displayName}>
      <div className="bed-tile-head">
        <span className="bed-tile-icon" aria-hidden="true">
          {state === 'MAINTENANCE' ? <Wrench size={16} /> : <BedDouble size={16} />}
        </span>
        <div>
          <strong>{bed.displayName}</strong>
          <div className="muted small code">
            {bed.code}
            {item.roomName ? ` · ${item.roomName}` : ''}
          </div>
        </div>
      </div>
      <span className={`bed-state bed-state-${state.toLowerCase()}`}>{bedStateLabels[state]}</span>
      {session && (
        <p className="small bed-stay" title={`Admitted ${formatWhen(session.startedAt, timeZone)}`}>
          Admitted {stayLength(now - Date.parse(session.startedAt))} ago
          {longStay && <span className="badge badge-maintenance">Long stay</span>}
        </p>
      )}
      {item.openRequests > 0 && (
        <p className="small">
          <Link to="/admin/requests">
            {item.openRequests} open request{item.openRequests === 1 ? '' : 's'}
          </Link>
          {item.overdueRequests > 0 && (
            <span className="late-text"> · {item.overdueRequests} overdue</span>
          )}
        </p>
      )}
      <div className="bed-tile-actions">{children}</div>
    </li>
  );
}
