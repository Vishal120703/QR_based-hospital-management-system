import { useCallback, useRef, useState } from 'react';
import { Link } from 'react-router';
import { staffApi, type Bed, type QrBatchScope, type QrCode, type QrIssue } from '../../api';
import { type ConfirmQuestion, LoadState, PageHeading, useConfirm } from '../../components';
import { useLoad } from '../../lib/use-load';
import { useAdmin } from '../workspace/AdminLayout';
import { PatientLinkActions, PrintLabels } from './BedQrActions';
import { loadPlaces, placeOfBed, type BedPlace } from './bed-places';
import { labelFromIssue, labelsFromBatch, QrLabelsDialog, type LabelItem } from './QrLabelsDialog';

export interface BedRow extends BedPlace {
  bed: Bed;
  qrCode: QrCode | undefined;
}

interface Issued {
  items: LabelItem[];
  area: string;
  // A single bed also offers its patient link for testing.
  url?: string;
}

async function loadRows(token: string, canReadLocations: boolean): Promise<BedRow[]> {
  const [beds, places, qrCodes] = await Promise.all([
    staffApi.list<Bed>(token, 'beds'),
    loadPlaces(token, canReadLocations),
    staffApi.list<QrCode>(token, 'qr-codes'),
  ]);
  return beds.map((bed) => ({
    bed,
    ...placeOfBed(bed, places),
    qrCode: qrCodes.find((item) => item.bedId === bed.id),
  }));
}

// Bedside QR codes: issue, print, replace, and disable them. Admitting and
// discharging patients is on the Bed management screen.
export function BedsPage() {
  const { token, me, reportError, reportSuccess, canAnywhere } = useAdmin();
  const confirm = useConfirm();
  const [busyBedId, setBusyBedId] = useState<string | null>(null);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('ALL');
  const pending = useRef(false);
  // Floor and ward managers hold these for their own area; the server returns
  // only the beds there.
  const canReadLocations = canAnywhere('location.read');
  const occupancy = me.tenant.bedOccupancyEnabled;

  const {
    data: rows,
    loading,
    error: loadError,
    reload,
    refresh,
  } = useLoad(
    useCallback(() => loadRows(token, canReadLocations), [token, canReadLocations]),
    { failure: 'Could not load beds.', onUnauthorized: reportError },
  );

  const can = (permission: string) => me.permissions.includes(permission);
  const canManageQr = can('hospital.manage');

  async function act(row: BedRow, action: () => Promise<unknown>, question?: ConfirmQuestion) {
    if (pending.current) return;
    if (question && !(await confirm(question))) return;
    pending.current = true;
    setBusyBedId(row.bed.id);
    try {
      await action();
      reportSuccess(`Updated ${row.bed.displayName}.`);
      await refresh();
    } catch (cause) {
      reportError(cause);
    } finally {
      setBusyBedId(null);
      pending.current = false;
    }
  }

  function showIssue(row: BedRow, issue: QrIssue) {
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
  }

  // Generating or rotating returns the raw token and stores an encrypted copy
  // so this same label can be opened again later.
  const issueQr = (row: BedRow, request: () => Promise<QrIssue>) => async () => {
    const issue = await request();
    showIssue(row, issue);
  };

  async function printExisting(row: BedRow) {
    if (pending.current) return;
    pending.current = true;
    setBusyBedId(row.bed.id);
    try {
      showIssue(row, await staffApi.printQr(token, row.bed.id));
    } catch (cause) {
      reportError(cause);
    } finally {
      setBusyBedId(null);
      pending.current = false;
    }
  }

  async function generateBatch(scope: QrBatchScope, area: string, replaceExisting: boolean) {
    if (pending.current) return null;
    pending.current = true;
    setBusyBedId('batch');
    try {
      const result = await staffApi.generateQrBatch(token, scope, replaceExisting);
      if (result.issues.length > 0) setIssued({ items: labelsFromBatch(result), area });
      await refresh();
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
      <LoadState loading={!loadError} error={loadError} label="Loading beds…" onRetry={reload} />
    );
  }

  const visible = rows.filter(
    (row) =>
      `${row.bed.displayName} ${row.bed.code} ${row.location}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()) &&
      (filter === 'ALL' ||
        (filter === 'ACTIVE'
          ? row.qrCode?.status === 'ACTIVE'
          : filter === 'NONE'
            ? !row.qrCode
            : row.qrCode?.status === 'REVOKED')),
  );
  return (
    <>
      <PageHeading
        title="QR codes"
        description={`Patients and attendants use the bedside QR to request services; they do not need a staff login. ${
          occupancy
            ? 'Admit and discharge patients in Bed management.'
            : 'Patients are not admitted here, so a QR works as soon as it is on the bed.'
        }`}
      >
        <button
          type="button"
          className="secondary"
          disabled={busyBedId !== null || loading}
          onClick={reload}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </PageHeading>
      <LoadState loading={false} error={loadError} onRetry={reload} />
      {(canManageQr || (occupancy && canAnywhere('bedSession.manage'))) && (
        <ol className="setup-steps" aria-label="Patient request setup">
          {occupancy && (
            <li>
              <span>1</span>
              Admit the patient
              <small>
                In <Link to="/admin/bed-management">Bed management</Link>, admit the patient to an
                available bed.
              </small>
            </li>
          )}
          <li>
            <span>{occupancy ? 2 : 1}</span>
            Print the bedside QR
            <small>
              Hospital managers can generate a QR for each bed, then use View / print QR whenever
              another copy of the same active label is needed.
            </small>
          </li>
          <li>
            <span>{occupancy ? 3 : 2}</span>
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
          <span>Active QR codes</span>
          <strong>{rows.filter((row) => row.qrCode?.status === 'ACTIVE').length}</strong>
        </div>
        <div className="card">
          <span>Beds without a working QR</span>
          <strong>
            {rows.filter((row) => row.bed.active && row.qrCode?.status !== 'ACTIVE').length}
          </strong>
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
          <span>QR code</span>
          <select value={filter} onChange={(event) => setFilter(event.target.value)}>
            <option value="ALL">All beds</option>
            <option value="ACTIVE">Active QR</option>
            <option value="NONE">No QR yet</option>
            <option value="REVOKED">Disabled QR</option>
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
                <th>QR code</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td colSpan={3} className="empty-state">
                    No beds match your filters. Try another search or choose all beds.
                  </td>
                </tr>
              )}
              {visible.map((row) => {
                const { bed, qrCode } = row;
                const busy = busyBedId !== null;
                return (
                  <tr key={bed.id}>
                    <td data-label="Bed">
                      <strong>{bed.displayName}</strong>
                      <div className="muted code">{bed.code}</div>
                    </td>
                    <td data-label="Location">
                      {row.location || 'Location details unavailable'}
                      {!bed.active && <div className="muted small">Out of service</div>}
                    </td>
                    <td data-label="QR code">
                      {qrCode?.status === 'ACTIVE' ? (
                        <>
                          <div className="muted">Active · version {qrCode.version}</div>
                          {!qrCode.printable && (
                            <div className="muted small">
                              Replace this legacy QR once to enable reprinting.
                            </div>
                          )}
                          <div className="actions">
                            {canManageQr && can('qr.generate') && qrCode.printable && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void printExisting(row)}
                              >
                                View / print QR
                              </button>
                            )}
                            {canManageQr && can('qr.rotate') && (
                              <button
                                type="button"
                                className="secondary"
                                disabled={busy}
                                onClick={() =>
                                  void act(
                                    row,
                                    issueQr(row, () => staffApi.rotateQr(token, bed.id)),
                                    {
                                      title: 'Issue a new QR code?',
                                      message:
                                        'The printed code stops working and connected patients must scan the new one.',
                                      confirmLabel: 'Issue new code',
                                      danger: true,
                                    },
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
