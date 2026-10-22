import { BedDouble, Wrench } from 'lucide-react';
import { type ReactNode } from 'react';
import { Link } from 'react-router';
import { PageHeading } from '../../components';
import { formatWhen } from '../reports/report-format';
import { useAdmin } from '../workspace/AdminLayout';
import { bedStateLabels, type BedState } from './bed-places';
import { type BoardBed } from './bed-management-data';

export function BedManagementOff() {
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
              <Link to="/admin/settings">Settings</Link>.
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

// Occupancy per floor and ward, busiest first within each floor.
export function OccupancyByArea({ beds }: { beds: readonly BoardBed[] }) {
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

export function BedTile({
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
