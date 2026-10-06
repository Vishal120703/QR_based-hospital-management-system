import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  staffApi,
  type Bed,
  type BedSession,
  type Floor,
  type QrCode,
  type QrIssue,
  type Room,
  type Ward,
} from '../api';
import { useAdmin } from './AdminLayout';
import { LoadState, Modal, PageHeading } from '../components';

interface BedRow {
  bed: Bed;
  location: string;
  floorId: string | undefined;
  floorName: string | undefined;
  wardId: string;
  wardName: string | undefined;
  qrCode: QrCode | undefined;
  session: BedSession | undefined;
}

interface Issued {
  issue: QrIssue;
  bedName: string;
  location: string;
}

async function loadRows(token: string, canReadLocations: boolean): Promise<BedRow[]> {
  const [beds, wards, floors, rooms, qrCodes, sessions] = await Promise.all([
    staffApi.list<Bed>(token, 'beds'),
    canReadLocations ? staffApi.list<Ward>(token, 'wards') : Promise.resolve([]),
    canReadLocations ? staffApi.list<Floor>(token, 'floors') : Promise.resolve([]),
    canReadLocations ? staffApi.list<Room>(token, 'rooms') : Promise.resolve([]),
    staffApi.list<QrCode>(token, 'qr-codes'),
    staffApi.list<BedSession>(token, 'bed-sessions', '?status=ACTIVE'),
  ]);
  return beds.map((bed) => {
    const ward = wards.find((item) => item.id === bed.wardId);
    const floor = floors.find((item) => item.id === ward?.floorId);
    const room = rooms.find((item) => item.id === bed.roomId);
    return {
      bed,
      location: [floor?.name, ward?.name, room?.name].filter(Boolean).join(' · '),
      floorId: floor?.id,
      floorName: floor?.name,
      wardId: bed.wardId,
      wardName: ward?.name,
      qrCode: qrCodes.find((item) => item.bedId === bed.id),
      session: sessions.find((item) => item.bedId === bed.id),
    };
  });
}

export function BedsPage() {
  const { token, me, reportError, reportSuccess } = useAdmin();
  const [rows, setRows] = useState<BedRow[] | null>(null);
  const [version, setVersion] = useState(0);
  const [busyBedId, setBusyBedId] = useState<string | null>(null);
  const [issued, setIssued] = useState<Issued[] | null>(null);
  const [floorId, setFloorId] = useState('');
  const [wardId, setWardId] = useState('');
  const [batchMessage, setBatchMessage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('ALL');
  const pending = useRef(false);
  const canReadLocations = me.permissions.includes('location.read');

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
  const canManageSessions = can('bedSession.manage');

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
    setIssued([{ issue, bedName: row.bed.displayName, location: row.location }]);
  };

  async function generateWard() {
    if (!floorId || !wardId || pending.current) return;
    pending.current = true;
    setBusyBedId('batch');
    setBatchMessage(null);
    try {
      const result = await staffApi.generateWardQrs(token, floorId, wardId);
      setBatchMessage(
        `${result.issues.length} new QR codes created. ${result.skippedActive} beds already had active QR codes; ${result.skippedInactive} inactive beds were skipped.`,
      );
      if (result.issues.length > 0) {
        setIssued(
          result.issues.map(({ bedName, location, ...issue }) => ({ issue, bedName, location })),
        );
      }
      setRows(await loadRows(token, canReadLocations));
    } catch (cause) {
      reportError(cause);
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
  const floors = [
    ...new Map(
      rows
        .filter((row) => row.floorId)
        .map((row) => [row.floorId, { id: row.floorId!, name: row.floorName ?? 'Floor' }]),
    ).values(),
  ];
  const wards = [
    ...new Map(
      rows
        .filter((row) => row.floorId === floorId)
        .map((row) => [row.wardId, { id: row.wardId, name: row.wardName ?? 'Ward' }]),
    ).values(),
  ];
  const selected = rows.filter((row) => row.floorId === floorId && row.wardId === wardId);
  const newCount = selected.filter(
    (row) => row.bed.active && row.qrCode?.status !== 'ACTIVE',
  ).length;

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
        <section className="card no-print" aria-label="Generate ward QR codes">
          <h2>Print QR codes for a ward</h2>
          <p className="muted small">
            Choose a floor and ward. Each active bed without an active QR gets its own code.
            Existing QR codes are left unchanged.
          </p>
          <div className="inline-form">
            <label>
              Floor
              <select
                aria-label="Floor for QR codes"
                value={floorId}
                onChange={(event) => {
                  setFloorId(event.target.value);
                  setWardId('');
                  setBatchMessage(null);
                }}
              >
                <option value="">Choose floor…</option>
                {floors.map((floor) => (
                  <option key={floor.id} value={floor.id}>
                    {floor.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Ward
              <select
                aria-label="Ward for QR codes"
                value={wardId}
                disabled={!floorId}
                onChange={(event) => {
                  setWardId(event.target.value);
                  setBatchMessage(null);
                }}
              >
                <option value="">Choose ward…</option>
                {wards.map((ward) => (
                  <option key={ward.id} value={ward.id}>
                    {ward.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={!wardId || newCount === 0 || busyBedId !== null}
              onClick={() => void generateWard()}
            >
              Generate {newCount} QR {newCount === 1 ? 'code' : 'codes'}
            </button>
          </div>
          {wardId && (
            <p className="small muted">
              {selected.length} beds in this ward · {newCount} new codes to print
            </p>
          )}
          {batchMessage && (
            <p role="status" className="small">
              {batchMessage}
            </p>
          )}
        </section>
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

      {issued && <QrDialog issued={issued} onClose={() => setIssued(null)} />}
    </>
  );
}

function QrDialog({ issued, onClose }: { issued: Issued[]; onClose: () => void }) {
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(issued[0]!.issue.url);
      setCopyMessage('Patient link copied. Keep it private.');
    } catch {
      setCopyMessage('Could not copy. Use Open patient view or print the QR instead.');
    }
  }
  return (
    <Modal
      title={
        issued.length === 1
          ? 'Print your new bedside QR'
          : `Print ${issued.length} bedside QR codes`
      }
      onClose={onClose}
      wide={issued.length > 1}
    >
      <p className="notice notice-warning no-print">
        This QR code is shown only once. Print it now; to get another, rotate the code.
      </p>
      <div className="print-area print-sheet">
        {issued.map((item) => (
          <div className="print-label" key={item.issue.qrCode.id}>
            <QRCodeSVG value={item.issue.url} size={240} marginSize={2} />
            <h2>{item.bedName}</h2>
            <p className="muted">{item.location}</p>
            <p>Scan to request hospital services and track your request.</p>
            <p className="small">
              <strong>Not for emergencies.</strong> Use the nurse-call button.
            </p>
          </div>
        ))}
      </div>
      <div className="actions no-print">
        <button type="button" onClick={() => window.print()}>
          Print
        </button>
        {issued.length === 1 && (
          <a
            className="button secondary"
            href={issued[0]!.issue.url}
            target="_blank"
            rel="noreferrer"
          >
            Open patient view
          </a>
        )}
        {issued.length === 1 && (
          <button type="button" className="secondary" onClick={() => void copy()}>
            Copy patient link
          </button>
        )}
        <button type="button" className="secondary" onClick={onClose}>
          Done
        </button>
      </div>
      {copyMessage && (
        <p className="small no-print" role="status">
          {copyMessage}
        </p>
      )}
    </Modal>
  );
}
