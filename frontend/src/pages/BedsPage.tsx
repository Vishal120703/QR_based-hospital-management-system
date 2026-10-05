import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState } from 'react';
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

async function loadRows(token: string): Promise<BedRow[]> {
  const [beds, wards, floors, rooms, qrCodes, sessions] = await Promise.all([
    staffApi.list<Bed>(token, 'beds'),
    staffApi.list<Ward>(token, 'wards'),
    staffApi.list<Floor>(token, 'floors'),
    staffApi.list<Room>(token, 'rooms'),
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
  const { token, me, reportError } = useAdmin();
  const [rows, setRows] = useState<BedRow[] | null>(null);
  const [version, setVersion] = useState(0);
  const [busyBedId, setBusyBedId] = useState<string | null>(null);
  const [issued, setIssued] = useState<Issued | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadRows(token).then(
      (result) => {
        if (!cancelled) setRows(result);
      },
      (cause: unknown) => {
        if (!cancelled) reportError(cause);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [token, version, reportError]);

  const can = (permission: string) => me.permissions.includes(permission);

  async function act(row: BedRow, action: () => Promise<unknown>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusyBedId(row.bed.id);
    try {
      await action();
      setVersion((value) => value + 1);
    } catch (cause) {
      reportError(cause);
    } finally {
      setBusyBedId(null);
    }
  }

  // Generating or rotating returns the raw token once; show it for printing.
  const issueQr = (row: BedRow, request: () => Promise<QrIssue>) => async () => {
    const issue = await request();
    setIssued({ issue, bedName: row.bed.displayName, location: row.location });
  };

  if (!rows) {
    return <p className="muted">Loading beds…</p>;
  }

  return (
    <>
      <h1>Beds &amp; QR codes</h1>
      <p className="muted">
        Start a bed session when a patient is admitted. A QR code works only while its bed has an
        active session.
      </p>

      {rows.length === 0 ? (
        <div className="card">
          <p>
            No beds yet. <Link to="/admin/locations">Set up locations</Link> first.
          </p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
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
              {rows.map((row) => {
                const { bed, qrCode, session } = row;
                const busy = busyBedId === bed.id;
                return (
                  <tr key={bed.id}>
                    <td>
                      <strong>{bed.displayName}</strong>
                      <div className="muted code">{bed.code}</div>
                    </td>
                    <td>{row.location}</td>
                    <td>
                      <span className={`badge badge-${bed.status.toLowerCase()}`}>
                        {bed.status}
                      </span>
                      {!bed.active && <span className="badge badge-muted">inactive</span>}
                    </td>
                    <td>
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
                    <td>
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
                                Rotate
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
                                Revoke
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
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="New QR code">
      <div className="card dialog">
        <p className="notice notice-warning no-print">
          This QR code is shown only once. Print it now; to get another, rotate the code.
        </p>
        <div className="print-area">
          <QRCodeSVG value={issued.issue.url} size={240} marginSize={2} />
          <h2>{issued.bedName}</h2>
          <p className="muted">{issued.location}</p>
          <p>Scan to request help from hospital staff.</p>
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
          <button type="button" className="secondary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
