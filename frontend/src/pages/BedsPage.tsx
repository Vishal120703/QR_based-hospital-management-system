import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  staffApi,
  type Bed,
  type BedSession,
  type Building,
  type Floor,
  type QrBatch,
  type QrBatchScope,
  type QrCode,
  type QrIssue,
  type Room,
  type Ward,
} from '../api';
import { useAdmin } from './AdminLayout';
import { LoadState, PageHeading } from '../components';
import { labelFromIssue, labelsFromBatch, QrLabelsDialog, type LabelItem } from './QrLabelsDialog';

interface BedRow {
  bed: Bed;
  location: string;
  buildingId: string | undefined;
  buildingName: string | undefined;
  floorId: string | undefined;
  floorName: string | undefined;
  wardId: string;
  wardName: string | undefined;
  roomId: string | null;
  roomName: string | undefined;
  qrCode: QrCode | undefined;
  session: BedSession | undefined;
}

interface Issued {
  items: LabelItem[];
  area: string;
  // A single bed also offers its patient link for testing.
  url?: string;
}

async function loadRows(token: string, canReadLocations: boolean): Promise<BedRow[]> {
  const [beds, wards, floors, rooms, buildings, qrCodes, sessions] = await Promise.all([
    staffApi.list<Bed>(token, 'beds'),
    canReadLocations ? staffApi.list<Ward>(token, 'wards') : Promise.resolve([]),
    canReadLocations ? staffApi.list<Floor>(token, 'floors') : Promise.resolve([]),
    canReadLocations ? staffApi.list<Room>(token, 'rooms') : Promise.resolve([]),
    canReadLocations ? staffApi.list<Building>(token, 'buildings') : Promise.resolve([]),
    staffApi.list<QrCode>(token, 'qr-codes'),
    staffApi.list<BedSession>(token, 'bed-sessions', '?status=ACTIVE'),
  ]);
  return beds.map((bed) => {
    const ward = wards.find((item) => item.id === bed.wardId);
    const floor = floors.find((item) => item.id === ward?.floorId);
    const room = rooms.find((item) => item.id === bed.roomId);
    // Floor names repeat across buildings ("Ground Floor"), so name both.
    const building = buildings.find((item) => item.id === floor?.buildingId);
    return {
      bed,
      location: [building?.name, floor?.name, ward?.name, room?.name].filter(Boolean).join(' · '),
      buildingId: building?.id,
      buildingName: building?.name,
      floorId: floor?.id,
      floorName: floor && [building?.name, floor.name].filter(Boolean).join(' · '),
      wardId: bed.wardId,
      wardName: ward?.name,
      roomId: bed.roomId,
      roomName: room?.name,
      qrCode: qrCodes.find((item) => item.bedId === bed.id),
      session: sessions.find((item) => item.bedId === bed.id),
    };
  });
}

export function BedsPage() {
  const { token, me, reportError, reportSuccess, canAnywhere } = useAdmin();
  const [rows, setRows] = useState<BedRow[] | null>(null);
  const [version, setVersion] = useState(0);
  const [busyBedId, setBusyBedId] = useState<string | null>(null);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('ALL');
  const pending = useRef(false);
  // Floor and ward managers hold these for their own area; the server returns
  // only the beds there.
  const canReadLocations = canAnywhere('location.read');

  useEffect(() => {
    let cancelled = false;
    loadRows(token, canReadLocations).then(
      (result) => {
        if (!cancelled) setRows(result);
      },
      (cause: unknown) => {
        if (!cancelled) {
          setLoadError(cause instanceof Error ? cause.message : 'Could not load beds.');
          reportError(cause);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [token, version, reportError, canReadLocations]);

  const can = (permission: string) => me.permissions.includes(permission);
  const canManageQr = can('hospital.manage');
  const canManageSessions = canAnywhere('bedSession.manage');

  async function act(row: BedRow, action: () => Promise<unknown>, confirmText?: string) {
    if (pending.current) return;
    if (confirmText && !window.confirm(confirmText)) return;
    pending.current = true;
    setBusyBedId(row.bed.id);
    try {
      await action();
      reportSuccess(`Updated ${row.bed.displayName}.`);
      try {
        setRows(await loadRows(token, canReadLocations));
      } catch (cause) {
        setRows(null);
        setLoadError(cause instanceof Error ? cause.message : 'Could not refresh beds.');
        reportError(cause);
      }
    } catch (cause) {
      reportError(cause);
    } finally {
      setBusyBedId(null);
      pending.current = false;
    }
  }

  // Generating or rotating returns the raw token once; show it for printing.
  const issueQr = (row: BedRow, request: () => Promise<QrIssue>) => async () => {
    const issue = await request();
    setIssued({
      items: [
        labelFromIssue(issue, {
          bedName: row.bed.displayName,
          bedCode: row.bed.code,
          location: row.location,
        }),
      ],
      area: row.bed.displayName,
      url: issue.url,
    });
  };

  async function generateBatch(scope: QrBatchScope, area: string, replaceExisting: boolean) {
    if (pending.current) return null;
    pending.current = true;
    setBusyBedId('batch');
    try {
      const result = await staffApi.generateQrBatch(token, scope, replaceExisting);
      if (result.issues.length > 0) setIssued({ items: labelsFromBatch(result), area });
      setRows(await loadRows(token, canReadLocations));
      return result;
    } catch (cause) {
      reportError(cause);
      return null;
    } finally {
      pending.current = false;
      setBusyBedId(null);
    }
  }

  if (!rows) {
    return (
      <LoadState
        loading={!loadError}
        error={loadError}
        label="Loading beds…"
        onRetry={() => {
          setLoadError(null);
          setVersion((value) => value + 1);
        }}
      />
    );
  }

  const visible = rows.filter(
    (row) =>
      `${row.bed.displayName} ${row.bed.code} ${row.location}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()) &&
      (filter === 'ALL' || (filter === 'ACTIVE' ? Boolean(row.session) : !row.session)),
  );
  return (
    <>
      <PageHeading
        title="Beds & QR codes"
        description="Patients and attendants use the bedside QR to request services; they do not need a staff login."
      >
        <button
          type="button"
          className="secondary"
          disabled={busyBedId !== null}
          onClick={() => {
            setRows(null);
            setLoadError(null);
            setVersion((value) => value + 1);
          }}
        >
          Refresh
        </button>
      </PageHeading>
      {(canManageQr || canManageSessions) && (
        <ol className="setup-steps" aria-label="Patient request setup">
          <li>
            <span>1</span>
            Start a bed session
            <small>Do this when a patient is admitted to an available bed.</small>
          </li>
          <li>
            <span>2</span>
            Print the bedside QR
            <small>
              Hospital managers can generate and print a QR for each bed. If its printable link was
              lost, Replace QR issues a new one and invalidates the old printout.
            </small>
          </li>
          <li>
            <span>3</span>
            Patient sends a request
            <small>Scan the QR, choose a service, and track the request on the patient page.</small>
          </li>
        </ol>
      )}
      <div className="summary-grid">
        <div className="card">
          <span>Total beds</span>
          <strong>{rows.length}</strong>
        </div>
        <div className="card">
          <span>Active admissions</span>
          <strong>{rows.filter((row) => row.session).length}</strong>
        </div>
        <div className="card">
          <span>Active QR codes</span>
          <strong>{rows.filter((row) => row.qrCode?.status === 'ACTIVE').length}</strong>
        </div>
      </div>
      {canManageQr && can('qr.generate') && canReadLocations && rows.length > 0 && (
        <PrintLabels
          rows={rows}
          canReplace={can('qr.rotate')}
          busy={busyBedId !== null}
          onGenerate={generateBatch}
        />
      )}
      <div className="toolbar">
        <label className="search-field">
          <span>Find a bed</span>
          <input
            type="search"
            placeholder="Search bed, ward, or floor…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label>
          <span>Sessions</span>
          <select value={filter} onChange={(event) => setFilter(event.target.value)}>
            <option value="ALL">All beds</option>
            <option value="ACTIVE">Active sessions</option>
            <option value="NONE">No active session</option>
          </select>
        </label>
        <span className="muted small" role="status">
          {visible.length} of {rows.length} beds
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="card">
          <p>
            No beds yet.{' '}
            {can('location.manage') ? (
              <Link to="/admin/locations">Set up locations</Link>
            ) : (
              'Ask your hospital manager to set up beds.'
            )}
          </p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="bed-table">
            <thead>
              <tr>
                <th>Bed</th>
                <th>Location</th>
                <th>Status</th>
                <th>Bed session</th>
                <th>QR code</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty-state">
                    No beds match your filters. Try another search or choose all beds.
                  </td>
                </tr>
              )}
              {visible.map((row) => {
                const { bed, qrCode, session } = row;
                const busy = busyBedId !== null;
                return (
                  <tr key={bed.id}>
                    <td data-label="Bed">
                      <strong>{bed.displayName}</strong>
                      <div className="muted code">{bed.code}</div>
                    </td>
                    <td data-label="Location">{row.location || 'Location details unavailable'}</td>
                    <td data-label="Status">
                      <span className={`badge badge-${bed.status.toLowerCase()}`}>
                        {bed.status.charAt(0) + bed.status.slice(1).toLowerCase()}
                      </span>
                      {!bed.active && <span className="badge badge-muted">inactive</span>}
                    </td>
                    <td data-label="Admission session">
                      {session ? (
                        <>
                          <div className="muted">
                            Since {new Date(session.startedAt).toLocaleString()}
                          </div>
                          {canManageSessions && (
                            <button
                              type="button"
                              className="secondary"
                              disabled={busy}
                              onClick={() =>
                                void act(
                                  row,
                                  () => staffApi.closeSession(token, session.id),
                                  `Close the session for ${bed.displayName}? Patients connected to this bed will be signed out.`,
                                )
                              }
                            >
                              Close session
                            </button>
                          )}
                        </>
                      ) : (
                        canManageSessions && (
                          <button
                            type="button"
                            disabled={busy || !bed.active || bed.status !== 'AVAILABLE'}
                            title={
                              bed.status === 'AVAILABLE'
                                ? undefined
                                : 'Only an active, available bed can start a session'
                            }
                            onClick={() =>
                              void act(row, () => staffApi.startSession(token, bed.id))
                            }
                          >
                            Start session
                          </button>
                        )
                      )}
                    </td>
                    <td data-label="QR code">
                      {qrCode?.status === 'ACTIVE' ? (
                        <>
                          <div className="muted">Active · version {qrCode.version}</div>
                          <div className="actions">
                            {canManageQr && can('qr.rotate') && (
                              <button
                                type="button"
                                className="secondary"
                                disabled={busy}
                                onClick={() =>
                                  void act(
                                    row,
                                    issueQr(row, () => staffApi.rotateQr(token, bed.id)),
                                    'Issue a new QR code? The printed code stops working and connected patients must scan the new one.',
                                  )
                                }
                              >
                                Replace QR
                              </button>
                            )}
                            {canManageQr && can('qr.revoke') && (
                              <button
                                type="button"
                                className="danger"
                                disabled={busy}
                                onClick={() =>
                                  void act(
                                    row,
                                    () => staffApi.revokeQr(token, bed.id),
                                    'Revoke this QR code? It stops working immediately.',
                                  )
                                }
                              >
                                Disable QR
                              </button>
                            )}
                          </div>
                        </>
                      ) : (
                        <>
                          {qrCode && <div className="muted">Revoked</div>}
                          {canManageQr && can('qr.generate') && (
                            <button
                              type="button"
                              disabled={busy || !bed.active}
                              onClick={() =>
                                void act(
                                  row,
                                  issueQr(row, () => staffApi.generateQr(token, bed.id)),
                                )
                              }
                            >
                              Generate QR
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {issued && (
        <QrLabelsDialog items={issued.items} area={issued.area} onClose={() => setIssued(null)}>
          {issued.url && <PatientLinkActions url={issued.url} />}
        </QrLabelsDialog>
      )}
    </>
  );
}

function PatientLinkActions({ url }: { url: string }) {
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopyMessage('Patient link copied. Keep it private.');
    } catch {
      setCopyMessage('Could not copy. Use Open patient view instead.');
    }
  }
  return (
    <>
      <a className="button secondary" href={url} target="_blank" rel="noreferrer">
        Open patient view
      </a>
      <button type="button" className="secondary" onClick={() => void copy()}>
        Copy patient link
      </button>
      {copyMessage && (
        <span className="small" role="status">
          {copyMessage}
        </span>
      )}
    </>
  );
}

const sortByName = (left: { name: string }, right: { name: string }) =>
  left.name.localeCompare(right.name, undefined, { numeric: true });

function uniqueOptions(
  rows: BedRow[],
  pick: (row: BedRow) => [string | null | undefined, string | undefined],
) {
  const options = new Map<string, string>();
  for (const row of rows) {
    const [id, name] = pick(row);
    if (id) options.set(id, name ?? '—');
  }
  return [...options].map(([id, name]) => ({ id, name })).sort(sortByName);
}

// Choose any part of the hospital and print QR labels for its beds.
function PrintLabels({
  rows,
  canReplace,
  busy,
  onGenerate,
}: {
  rows: BedRow[];
  canReplace: boolean;
  busy: boolean;
  onGenerate: (scope: QrBatchScope, area: string, replace: boolean) => Promise<QrBatch | null>;
}) {
  const [buildingId, setBuildingId] = useState('');
  const [floorId, setFloorId] = useState('');
  const [wardId, setWardId] = useState('');
  const [roomId, setRoomId] = useState('');
  const [replace, setReplace] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const buildings = uniqueOptions(rows, (row) => [row.buildingId, row.buildingName]);
  const inBuilding = rows.filter((row) => !buildingId || row.buildingId === buildingId);
  const floors = uniqueOptions(inBuilding, (row) => [row.floorId, row.floorName]);
  const onFloor = inBuilding.filter((row) => !floorId || row.floorId === floorId);
  const wards = floorId ? uniqueOptions(onFloor, (row) => [row.wardId, row.wardName]) : [];
  const inWard = onFloor.filter((row) => !wardId || row.wardId === wardId);
  const rooms = wardId ? uniqueOptions(inWard, (row) => [row.roomId, row.roomName]) : [];
  const selected = inWard.filter((row) => !roomId || row.roomId === roomId);

  const active = selected.filter((row) => row.bed.active);
  const withQr = active.filter((row) => row.qrCode?.status === 'ACTIVE').length;
  const count = replace ? active.length : active.length - withQr;
  const name = (list: { id: string; name: string }[], id: string) =>
    list.find((item) => item.id === id)?.name;
  const area =
    [
      name(buildings, buildingId),
      floorId ? name(floors, floorId)?.split(' · ').pop() : undefined,
      name(wards, wardId),
      name(rooms, roomId),
    ]
      .filter(Boolean)
      .join(' · ') || 'Whole hospital';
  const scope: QrBatchScope = roomId
    ? { kind: 'ROOM', id: roomId }
    : wardId
      ? { kind: 'WARD', id: wardId }
      : floorId
        ? { kind: 'FLOOR', id: floorId }
        : buildingId
          ? { kind: 'BUILDING', id: buildingId }
          : { kind: 'HOSPITAL' };

  function pick(level: 'building' | 'floor' | 'ward' | 'room', value: string) {
    setMessage(null);
    if (level === 'building') {
      setBuildingId(value);
      setFloorId('');
    }
    if (level === 'building' || level === 'floor') {
      if (level === 'floor') setFloorId(value);
      setWardId('');
    }
    if (level !== 'room') setRoomId('');
    if (level === 'ward') setWardId(value);
    if (level === 'room') setRoomId(value);
  }

  async function generate() {
    if (
      replace &&
      withQr > 0 &&
      !window.confirm(
        `Replace ${withQr} printed QR label${withQr === 1 ? '' : 's'} in ${area}? The old labels stop working at once and patients using them must scan the new ones.`,
      )
    ) {
      return;
    }
    const result = await onGenerate(scope, area, replace);
    if (result) {
      setMessage(
        [
          `${result.issues.length} labels created for ${area}.`,
          result.replaced > 0 ? `${result.replaced} old labels replaced.` : '',
          result.skippedActive > 0 ? `${result.skippedActive} beds already had labels.` : '',
          result.skippedInactive > 0 ? `${result.skippedInactive} inactive beds skipped.` : '',
        ]
          .filter(Boolean)
          .join(' '),
      );
      setReplace(false);
    }
  }

  return (
    <section className="card no-print print-labels" aria-labelledby="print-labels-title">
      <h2 id="print-labels-title">Print QR labels</h2>
      <p className="muted small">
        Choose an area, then download one PDF with a label for every bed in it, in location order.
        Beds that already have a printed QR are left alone unless you choose to replace them.
      </p>
      <div className="field-grid">
        {buildings.length > 0 && (
          <label>
            Building
            <select
              aria-label="Building for QR labels"
              value={buildingId}
              onChange={(event) => pick('building', event.target.value)}
            >
              <option value="">All buildings</option>
              {buildings.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Floor
          <select
            aria-label="Floor for QR labels"
            value={floorId}
            onChange={(event) => pick('floor', event.target.value)}
          >
            <option value="">All floors</option>
            {floors.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Unit / ward
          <select
            aria-label="Unit for QR labels"
            value={wardId}
            disabled={!floorId}
            onChange={(event) => pick('ward', event.target.value)}
          >
            <option value="">{floorId ? 'All units' : 'Choose a floor first'}</option>
            {wards.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        {rooms.length > 0 && (
          <label>
            Room
            <select
              aria-label="Room for QR labels"
              value={roomId}
              onChange={(event) => pick('room', event.target.value)}
            >
              <option value="">All rooms and open bays</option>
              {rooms.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <p className="small">
        <strong>{area}</strong>: {active.length} active beds · {withQr} already have a QR label ·{' '}
        {active.length - withQr} need one
      </p>
      {canReplace && withQr > 0 && (
        <label className="checkbox small">
          <input
            type="checkbox"
            checked={replace}
            onChange={(event) => setReplace(event.target.checked)}
          />
          Also reprint the {withQr} existing labels (the old ones stop working)
        </label>
      )}
      <div className="actions">
        <button type="button" disabled={busy || count === 0} onClick={() => void generate()}>
          {count === 0 ? 'No labels needed' : `Create ${count} QR label${count === 1 ? '' : 's'}`}
        </button>
      </div>
      {message && (
        <p role="status" className="small">
          {message}
        </p>
      )}
    </section>
  );
}
