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
  const [issued, setIssued] = useState<Issued | null>(null);
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
    setIssued({ issue, bedName: row.bed.displayName, location: row.location });
  };

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
        description="Start a session on admission, then generate and print the bedside QR. Close the session on discharge."
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
            No beds yet. <Link to="/admin/locations">Set up locations</Link> first.
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
                          {can('bedSession.manage') && (
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
                        can('bedSession.manage') && (
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
                            {can('qr.rotate') && (
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
                            {can('qr.revoke') && (
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
                          {can('qr.generate') && (
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

function QrDialog({ issued, onClose }: { issued: Issued; onClose: () => void }) {
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(issued.issue.url);
      setCopyMessage('Patient link copied. Keep it private.');
    } catch {
      setCopyMessage('Could not copy. Use Open patient view or print the QR instead.');
    }
  }
  return (
    <Modal title="Print your new bedside QR" onClose={onClose}>
      <p className="notice notice-warning no-print">
        This QR code is shown only once. Print it now; to get another, rotate the code.
      </p>
      <div className="print-area">
        <QRCodeSVG value={issued.issue.url} size={240} marginSize={2} />
        <h2>{issued.bedName}</h2>
        <p className="muted">{issued.location}</p>
        <p>Scan to view hospital services.</p>
        <p className="small">
          <strong>Not for emergencies.</strong> Use the nurse-call button.
        </p>
      </div>
      <div className="actions no-print">
        <button type="button" onClick={() => window.print()}>
          Print
        </button>
        <a className="button secondary" href={issued.issue.url} target="_blank" rel="noreferrer">
          Open patient view
        </a>
        <button type="button" className="secondary" onClick={() => void copy()}>
          Copy patient link
        </button>
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
