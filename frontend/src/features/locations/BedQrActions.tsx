import { useState } from 'react';
import { type QrBatch, type QrBatchScope } from '../../api';
import { useConfirm } from '../../components';
import { type BedRow } from './BedsPage';

export function PatientLinkActions({ url }: { url: string }) {
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
export function PrintLabels({
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
  const confirm = useConfirm();
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
  const selected = floorId ? inWard.filter((row) => !roomId || row.roomId === roomId) : [];

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
      .join(' · ') || 'Choose a floor';
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
      !(await confirm(
        `Replace ${withQr} printed QR label${withQr === 1 ? '' : 's'} in ${area}? The old labels stop working at once and patients using them must scan the new ones.`,
      ))
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
        Choose a floor, then optionally a unit or room. Download one PDF with a separate label for
        each bed. Beds with an active QR are left alone unless you choose to replace them.
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
            <option value="">Choose a floor…</option>
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
        <strong>{area}</strong>: {active.length} active beds · {withQr} already have an active QR ·{' '}
        {active.length - withQr} need one
      </p>
      {canReplace && withQr > 0 && (
        <label className="checkbox small">
          <input
            type="checkbox"
            checked={replace}
            onChange={(event) => setReplace(event.target.checked)}
          />
          Replace the {withQr} existing QR codes with new labels (old labels stop working)
        </label>
      )}
      <div className="actions">
        <button
          type="button"
          disabled={busy || !floorId || count === 0 || count > 300}
          onClick={() => void generate()}
        >
          {!floorId
            ? 'Choose a floor'
            : count > 300
              ? 'Choose a smaller area'
              : count === 0
                ? 'No labels needed'
                : `Create ${count} QR label${count === 1 ? '' : 's'}`}
        </button>
      </div>
      {count > 300 && (
        <p className="small muted">
          Choose one unit or room to print no more than 300 labels at a time.
        </p>
      )}
      {message && (
        <p role="status" className="small">
          {message}
        </p>
      )}
    </section>
  );
}
