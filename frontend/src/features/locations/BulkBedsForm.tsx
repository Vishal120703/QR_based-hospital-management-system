import { useState, type FormEvent } from 'react';
import {
  staffApi,
  type Bed,
  type BedType,
  type BulkBedsInput,
  type Room,
  type RoomType,
  type WardType,
} from '../../api';
import {
  bedTypeLabels,
  planBulkBeds,
  previewList,
  roomTypeLabels,
  unitPresets,
  bedTypes,
  roomTypes,
} from './location-types';
import { useAdmin } from '../workspace/AdminLayout';
import { type PanelTools } from './location-shared';
import { prefixInput } from '../../lib/field-rules';
import { RoomSelect } from './WardForms';

// Adds many beds to a ward at once: numbered beds, or numbered rooms with beds in each.

const prefixPattern = /^([A-Za-z0-9][A-Za-z0-9._-]*)?$/;

function bedNoun(type: BedType): string {
  if (type === 'DAY_CARE_CHAIR' || type === 'DIALYSIS_CHAIR') return 'Chair';
  if (type === 'EMERGENCY_TROLLEY') return 'Bay';
  if (type === 'PEDIATRIC_COT') return 'Cot';
  return 'Bed';
}

function nextNumber(codes: string[], prefix: string): number {
  const upper = prefix.toUpperCase();
  const numbers = codes
    .filter((code) => code.toUpperCase().startsWith(upper))
    .map((code) => Number(code.slice(upper.length)))
    .filter((value) => Number.isInteger(value));
  return numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
}

export function BulkBedsForm({
  tools,
  wardId,
  wardType,
  codePrefix: suggestedPrefix,
  floorLevel,
  rooms,
  beds,
  onCreated,
}: {
  tools: PanelTools;
  wardId: string;
  wardType: WardType;
  // Where new bed codes start, from bedCodePrefix().
  codePrefix: string;
  floorLevel: number | null;
  rooms: Room[];
  beds: Bed[];
  onCreated: (bedIds: string[]) => void;
}) {
  const { token } = useAdmin();
  const preset = unitPresets[wardType];
  const canRooms = tools.canManage;
  const [mode, setMode] = useState<'BEDS' | 'ROOMS'>(
    canRooms && preset.layout.mode === 'ROOMS' ? 'ROOMS' : 'BEDS',
  );
  const [bedType, setBedType] = useState<BedType>(preset.bedType);
  const [codePrefix, setCodePrefix] = useState(suggestedPrefix);
  const [namePrefix, setNamePrefix] = useState(bedNoun(preset.bedType));
  const [roomPrefix, setRoomPrefix] = useState(
    floorLevel !== null && floorLevel > 0 ? String(floorLevel) : '',
  );
  const [roomType, setRoomType] = useState<RoomType>(
    preset.layout.mode === 'ROOMS' ? preset.layout.roomType : 'GENERAL',
  );
  const [bedsPerRoom, setBedsPerRoom] = useState(
    preset.layout.mode === 'ROOMS' ? preset.layout.bedsPerRoom : 2,
  );
  const [roomId, setRoomId] = useState('');
  const [count, setCount] = useState(10);
  // Continue after the highest existing number, by code or by name.
  const [start, setStart] = useState(() =>
    Math.max(
      nextNumber(
        beds.map((bed) => bed.code),
        suggestedPrefix,
      ),
      nextNumber(
        beds.map((bed) => bed.displayName),
        `${bedNoun(preset.bedType)} `,
      ),
    ),
  );

  const input: BulkBedsInput =
    mode === 'BEDS'
      ? {
          mode,
          codePrefix: codePrefix.trim(),
          namePrefix: namePrefix.trim(),
          start,
          count,
          bedType,
          ...(roomId ? { roomId } : {}),
        }
      : { mode, roomPrefix: roomPrefix.trim(), start, count, roomType, bedsPerRoom, bedType };
  const plan = planBulkBeds(input);
  const prefix = mode === 'BEDS' ? codePrefix.trim() : roomPrefix.trim();
  const existingNames = new Set(beds.map((bed) => bed.displayName.toLowerCase()));
  const repeatedNames = plan.beds.filter((bed) => existingNames.has(bed.displayName.toLowerCase()));
  const problem = !prefixPattern.test(prefix)
    ? 'The prefix may use letters, numbers, and - . _ and must start with a letter or number.'
    : !Number.isInteger(count) || count < 1 || count > (mode === 'BEDS' ? 300 : 100)
      ? `Enter how many to add (1–${mode === 'BEDS' ? 300 : 100}).`
      : plan.beds.length > 300
        ? 'That is more than 300 beds. Add them in smaller groups.'
        : !Number.isInteger(start) || start < 0
          ? 'Enter a starting number of 0 or more.'
          : null;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (problem) return;
    void tools
      .run(
        async () => {
          const created = await staffApi.bulkBeds(token, wardId, input);
          onCreated(created.beds.map((bed) => bed.id));
        },
        mode === 'BEDS'
          ? `Added ${plan.beds.length} beds.`
          : `Added ${plan.rooms.length} rooms with ${plan.beds.length} beds.`,
      )
      .then((saved) => {
        if (saved) setStart(start + count);
      });
  }

  return (
    <form className="card create-form bulk-form" onSubmit={submit}>
      <h3>Add beds</h3>
      <div className="segmented" role="radiogroup" aria-label="How to add beds">
        <label className={mode === 'BEDS' ? 'active' : ''}>
          <input
            type="radio"
            name="bulk-mode"
            checked={mode === 'BEDS'}
            onChange={() => setMode('BEDS')}
          />
          Numbered beds
        </label>
        <label className={mode === 'ROOMS' ? 'active' : ''}>
          <input
            type="radio"
            name="bulk-mode"
            checked={mode === 'ROOMS'}
            disabled={!canRooms}
            onChange={() => setMode('ROOMS')}
          />
          Rooms with beds
        </label>
      </div>
      <div className="field-grid">
        {mode === 'BEDS' ? (
          <>
            <label>
              <span>
                Code prefix <em>(optional)</em>
              </span>
              <input
                value={codePrefix}
                {...prefixInput}
                onChange={(event) => setCodePrefix(event.target.value)}
              />
            </label>
            <label>
              Name shown to patients
              <input
                value={namePrefix}
                maxLength={60}
                onChange={(event) => setNamePrefix(event.target.value)}
              />
            </label>
            <RoomSelect
              label="Put them in a room"
              rooms={rooms}
              value={roomId}
              onChange={setRoomId}
            />
          </>
        ) : (
          <>
            <label>
              <span>
                Room number prefix <em>(optional)</em>
              </span>
              <input
                value={roomPrefix}
                {...prefixInput}
                placeholder="2"
                onChange={(event) => setRoomPrefix(event.target.value)}
              />
              <small className="muted">Prefix “2” with rooms 1–10 gives 201–210.</small>
            </label>
            <label>
              Room type
              <select
                value={roomType}
                onChange={(event) => setRoomType(event.target.value as RoomType)}
              >
                {roomTypes.map((type) => (
                  <option key={type} value={type}>
                    {roomTypeLabels[type]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Beds in each room
              <input
                type="number"
                min={1}
                max={12}
                value={bedsPerRoom}
                onChange={(event) => setBedsPerRoom(Number(event.target.value))}
              />
            </label>
          </>
        )}
        <label>
          {mode === 'BEDS' ? 'First number' : 'First room number'}
          <input
            type="number"
            min={0}
            value={start}
            onChange={(event) => setStart(Number(event.target.value))}
          />
        </label>
        <label>
          {mode === 'BEDS' ? 'How many beds' : 'How many rooms'}
          <input
            type="number"
            min={1}
            max={mode === 'BEDS' ? 300 : 100}
            value={count}
            onChange={(event) => setCount(Number(event.target.value))}
          />
        </label>
        <label>
          Bed type
          <select
            value={bedType}
            onChange={(event) => {
              const next = event.target.value as BedType;
              if (namePrefix === bedNoun(bedType)) setNamePrefix(bedNoun(next));
              setBedType(next);
            }}
          >
            {bedTypes.map((type) => (
              <option key={type} value={type}>
                {bedTypeLabels[type]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className={problem ? 'notice notice-warning' : 'bulk-preview'} role="status">
        {problem ??
          (mode === 'BEDS'
            ? `Will add ${plan.beds.length} beds: ${previewList(plan.beds.map((bed) => `${bed.displayName} (${bed.code})`))}`
            : `Will add ${plan.rooms.length} rooms (${previewList(plan.rooms)}) with ${bedsPerRoom} bed${bedsPerRoom === 1 ? '' : 's'} each, ${plan.beds.length} beds in total: ${previewList(plan.beds.map((bed) => bed.code))}`)}
      </p>
      {!problem && repeatedNames.length > 0 && (
        <p className="notice notice-warning small">
          {previewList(repeatedNames.map((bed) => bed.displayName))} already exist
          {repeatedNames.length === 1 ? 's' : ''} in this unit. Patients could confuse them;
          consider a different first number or name.
        </p>
      )}
      <button type="submit" disabled={tools.busy || problem !== null}>
        {mode === 'BEDS'
          ? `Add ${plan.beds.length} ${plan.beds.length === 1 ? 'bed' : 'beds'}`
          : `Add ${plan.rooms.length} ${plan.rooms.length === 1 ? 'room' : 'rooms'}`}
      </button>
    </form>
  );
}
