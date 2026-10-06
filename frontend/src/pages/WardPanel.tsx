import { useState, type FormEvent } from 'react';
import {
  staffApi,
  type Bed,
  type BedType,
  type BulkBedsInput,
  type Room,
  type RoomType,
  type WardType,
} from '../api';
import {
  bedTypeLabels,
  floorLevelLabel,
  planBulkBeds,
  previewList,
  roomTypeLabels,
  unitPresets,
  wardTypes,
} from '../location-types';
import { useAdmin } from './AdminLayout';
import {
  bedStats,
  hasActiveQr,
  LocationActions,
  PanelHeader,
  QrLabelsButton,
  type EditField,
  type PanelTools,
} from './location-shared';

const bedTypes = Object.keys(bedTypeLabels) as BedType[];
const roomTypes = Object.keys(roomTypeLabels) as RoomType[];
const prefixPattern = /^([A-Za-z0-9][A-Za-z0-9._-]*)?$/;

const statusBadge: Record<Bed['status'], string> = {
  AVAILABLE: 'badge badge-available',
  OCCUPIED: 'badge badge-occupied',
  MAINTENANCE: 'badge badge-maintenance',
  INACTIVE: 'badge',
};

function bedNoun(type: BedType): string {
  if (type === 'DAY_CARE_CHAIR' || type === 'DIALYSIS_CHAIR') return 'Chair';
  if (type === 'EMERGENCY_TROLLEY') return 'Bay';
  if (type === 'PEDIATRIC_COT' || type === 'NEONATAL') return 'Cot';
  return 'Bed';
}

export function WardPanel({ tools, id }: { tools: PanelTools; id: string }) {
  const { layout } = tools;
  // Beds added in bulk just now, offered for QR printing straight away.
  const [justCreated, setJustCreated] = useState<string[]>([]);
  const ward = layout.wards.find((item) => item.id === id);
  if (!ward) return null;
  const floor = layout.floors.find((item) => item.id === ward.floorId);
  const rooms = layout.rooms
    .filter((room) => room.wardId === id)
    .sort((left, right) => left.code.localeCompare(right.code, undefined, { numeric: true }));
  const beds = layout.beds
    .filter((bed) => bed.wardId === id)
    .sort((left, right) => left.code.localeCompare(right.code, undefined, { numeric: true }));
  const stats = bedStats(beds);
  const preset = unitPresets[ward.unitType];
  const area = [floor?.name, ward.name].filter(Boolean).join(' · ');
  const fresh = beds.filter((bed) => justCreated.includes(bed.id));
  const groups = [
    ...rooms.map((room) => ({ room, beds: beds.filter((bed) => bed.roomId === room.id) })),
    { room: null, beds: beds.filter((bed) => !bed.roomId) },
  ].filter((group) => group.room || group.beds.length > 0);

  return (
    <>
      <PanelHeader
        eyebrow={[preset.label, floor?.name, floor && floorLevelLabel(floor.level)]
          .filter(Boolean)
          .join(' · ')}
        title={ward.name}
        code={ward.code}
        active={ward.active}
      >
        <QrLabelsButton tools={tools} scope={{ kind: 'WARD', id }} beds={beds} area={area} />
        <LocationActions
          tools={tools}
          kind="wards"
          item={ward}
          label={ward.name}
          canEdit={tools.canManage}
          canDelete={rooms.length + beds.length === 0}
          editFields={[
            { name: 'name', label: 'Name' },
            { name: 'code', label: 'Code' },
            {
              name: 'unitType',
              label: 'Type of unit',
              type: 'select',
              options: wardTypes.map((type) => ({ value: type, label: unitPresets[type].label })),
            },
          ]}
          editInitial={{ name: ward.name, code: ward.code, unitType: ward.unitType }}
        />
      </PanelHeader>

      {tools.canReadBeds && (
        <dl className="stat-row">
          {[
            ['Beds', stats.total],
            ['Occupied', stats.occupied],
            ['Available', stats.available],
            ['Maintenance', stats.maintenance],
            ['Rooms', rooms.length],
          ].map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {tools.canManageBeds && ward.active && (
        <BulkBedsForm
          tools={tools}
          wardId={id}
          wardType={ward.unitType}
          wardCode={ward.code}
          floorLevel={floor?.level ?? null}
          rooms={rooms}
          beds={beds}
          onCreated={setJustCreated}
        />
      )}

      {fresh.length > 0 && tools.canPrintQr && (
        <div className="notice notice-success next-step" role="status">
          <span>
            <strong>{fresh.length} beds added.</strong> Next, print their bedside QR labels.
          </span>
          <span className="actions">
            <QrLabelsButton
              tools={tools}
              scope={{ kind: 'BEDS', bedIds: fresh.map((bed) => bed.id) }}
              beds={fresh}
              area={`${area} · new beds`}
              primary
            />
            <button type="button" className="link" onClick={() => setJustCreated([])}>
              Later
            </button>
          </span>
        </div>
      )}

      {tools.canReadBeds ? (
        <section aria-labelledby="ward-beds-title">
          <h3 id="ward-beds-title" className="section-title">
            Rooms and beds
          </h3>
          {groups.length === 0 ? (
            <p className="muted">No beds yet. Use “Add beds” above to create them in one go.</p>
          ) : (
            groups.map((group) => (
              <RoomGroup
                key={group.room?.id ?? 'open'}
                tools={tools}
                room={group.room}
                beds={group.beds}
              />
            ))
          )}
        </section>
      ) : (
        <p className="muted">Your role cannot view beds.</p>
      )}

      {ward.active && (tools.canManage || tools.canManageBeds) && (
        <details className="card more-forms">
          <summary>Add a single room or bed</summary>
          <div className="form-pair">
            {tools.canManage && <AddRoomForm tools={tools} wardId={id} />}
            {tools.canManageBeds && (
              <AddBedForm tools={tools} wardId={id} rooms={rooms} defaultType={preset.bedType} />
            )}
          </div>
        </details>
      )}
    </>
  );
}

function RoomGroup({ tools, room, beds }: { tools: PanelTools; room: Room | null; beds: Bed[] }) {
  const roomFields: EditField[] = [
    { name: 'name', label: 'Name' },
    { name: 'code', label: 'Code' },
    {
      name: 'roomType',
      label: 'Room type',
      type: 'select',
      options: roomTypes.map((type) => ({ value: type, label: roomTypeLabels[type] })),
    },
  ];
  return (
    <div className={`card room-group${room && !room.active ? ' inactive' : ''}`}>
      <div className="room-group-head">
        <div>
          <strong>{room ? room.name : 'Open bay (no room)'}</strong>{' '}
          {room && <span className="muted small">{roomTypeLabels[room.roomType]}</span>}{' '}
          {room && !room.active && <span className="badge">inactive</span>}
        </div>
        {room && (
          <span className="room-group-actions">
            <QrLabelsButton
              tools={tools}
              scope={{ kind: 'ROOM', id: room.id }}
              beds={beds}
              area={room.name}
              compact
            />
            <LocationActions
              tools={tools}
              kind="rooms"
              item={room}
              label={room.name}
              compact
              canEdit={tools.canManage}
              canDelete={beds.length === 0}
              editFields={roomFields}
              editInitial={{ name: room.name, code: room.code, roomType: room.roomType }}
            />
          </span>
        )}
      </div>
      {beds.length === 0 ? (
        <p className="muted small">No beds in this room.</p>
      ) : (
        <div className="table-wrap flat">
          <table className="bed-list">
            <thead>
              <tr>
                <th>Bed</th>
                <th>Code</th>
                <th>Type</th>
                <th>QR label</th>
                <th>Status</th>
                {tools.canManageBeds && <th className="visually-hidden">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {beds.map((bed) => (
                <tr key={bed.id} className={bed.active ? '' : 'inactive'}>
                  <td data-label="Bed">{bed.displayName}</td>
                  <td data-label="Code" className="code">
                    {bed.code}
                  </td>
                  <td data-label="Type">{bedTypeLabels[bed.bedType]}</td>
                  <td data-label="QR label">
                    {hasActiveQr(tools.layout, bed.id) ? (
                      <span className="badge badge-available">printed</span>
                    ) : (
                      <span className="badge">not yet</span>
                    )}
                  </td>
                  <td data-label="Status">
                    <span className={statusBadge[bed.status]}>
                      {bed.active ? bed.status.toLowerCase() : 'inactive'}
                    </span>
                  </td>
                  {tools.canManageBeds && (
                    <td>
                      <LocationActions
                        tools={tools}
                        kind="beds"
                        item={bed}
                        label={bed.displayName}
                        compact
                        canEdit={bed.status !== 'OCCUPIED'}
                        canDelete
                        deleteHint="Beds with QR or admission history can only be deactivated."
                        editFields={[
                          { name: 'displayName', label: 'Name shown to patients' },
                          { name: 'code', label: 'Code' },
                          {
                            name: 'bedType',
                            label: 'Type',
                            type: 'select',
                            options: bedTypes.map((type) => ({
                              value: type,
                              label: bedTypeLabels[type],
                            })),
                          },
                          {
                            name: 'status',
                            label: 'Status',
                            type: 'select',
                            options: [
                              { value: 'AVAILABLE', label: 'Available' },
                              { value: 'MAINTENANCE', label: 'Under maintenance' },
                            ],
                          },
                        ]}
                        editInitial={{
                          displayName: bed.displayName,
                          code: bed.code,
                          bedType: bed.bedType,
                          status: bed.status === 'MAINTENANCE' ? 'MAINTENANCE' : 'AVAILABLE',
                        }}
                      />
                      {bed.status === 'OCCUPIED' && (
                        <span className="muted small">Patient admitted</span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function nextNumber(codes: string[], prefix: string): number {
  const upper = prefix.toUpperCase();
  const numbers = codes
    .filter((code) => code.toUpperCase().startsWith(upper))
    .map((code) => Number(code.slice(upper.length)))
    .filter((value) => Number.isInteger(value));
  return numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
}

function BulkBedsForm({
  tools,
  wardId,
  wardType,
  wardCode,
  floorLevel,
  rooms,
  beds,
  onCreated,
}: {
  tools: PanelTools;
  wardId: string;
  wardType: WardType;
  wardCode: string;
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
  const [codePrefix, setCodePrefix] = useState(`${wardCode}-`);
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
        `${wardCode}-`,
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
                maxLength={16}
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
            {rooms.length > 0 && (
              <label>
                <span>
                  Put them in a room <em>(optional)</em>
                </span>
                <select value={roomId} onChange={(event) => setRoomId(event.target.value)}>
                  <option value="">No room (open bay)</option>
                  {rooms
                    .filter((room) => room.active)
                    .map((room) => (
                      <option key={room.id} value={room.id}>
                        {room.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
          </>
        ) : (
          <>
            <label>
              <span>
                Room number prefix <em>(optional)</em>
              </span>
              <input
                value={roomPrefix}
                maxLength={16}
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
        {mode === 'BEDS' ? `Add ${plan.beds.length} beds` : `Add ${plan.rooms.length} rooms`}
      </button>
    </form>
  );
}

function AddRoomForm({ tools, wardId }: { tools: PanelTools; wardId: string }) {
  const { token } = useAdmin();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [roomType, setRoomType] = useState<RoomType>('GENERAL');
  return (
    <form
      className="create-form"
      onSubmit={(event) => {
        event.preventDefault();
        void tools
          .run(
            () =>
              staffApi.create(token, 'rooms', {
                wardId,
                code,
                name: name || `Room ${code}`,
                roomType,
              }),
            'Room added.',
          )
          .then((saved) => {
            if (saved) {
              setCode('');
              setName('');
            }
          });
      }}
    >
      <h4>One room</h4>
      <label>
        Room number or code
        <input
          value={code}
          required
          maxLength={32}
          placeholder="305"
          onChange={(event) => setCode(event.target.value)}
        />
      </label>
      <label>
        <span>
          Name <em>(optional)</em>
        </span>
        <input
          value={name}
          maxLength={120}
          placeholder={code ? `Room ${code}` : 'Room 305'}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label>
        Room type
        <select value={roomType} onChange={(event) => setRoomType(event.target.value as RoomType)}>
          {roomTypes.map((type) => (
            <option key={type} value={type}>
              {roomTypeLabels[type]}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={tools.busy}>
        Add room
      </button>
    </form>
  );
}

function AddBedForm({
  tools,
  wardId,
  rooms,
  defaultType,
}: {
  tools: PanelTools;
  wardId: string;
  rooms: Room[];
  defaultType: BedType;
}) {
  const { token } = useAdmin();
  const [code, setCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [roomId, setRoomId] = useState('');
  const [bedType, setBedType] = useState<BedType>(defaultType);
  return (
    <form
      className="create-form"
      onSubmit={(event) => {
        event.preventDefault();
        void tools
          .run(
            () =>
              staffApi.create(token, 'beds', {
                wardId,
                code,
                displayName: displayName || `Bed ${code}`,
                bedType,
                ...(roomId ? { roomId } : {}),
              }),
            'Bed added.',
          )
          .then((saved) => {
            if (saved) {
              setCode('');
              setDisplayName('');
            }
          });
      }}
    >
      <h4>One bed</h4>
      <label>
        Code
        <input
          value={code}
          required
          maxLength={32}
          placeholder="GW-21"
          onChange={(event) => setCode(event.target.value)}
        />
      </label>
      <label>
        <span>
          Name shown to patients <em>(optional)</em>
        </span>
        <input
          value={displayName}
          maxLength={120}
          placeholder={code ? `Bed ${code}` : 'Bed 21'}
          onChange={(event) => setDisplayName(event.target.value)}
        />
      </label>
      {rooms.length > 0 && (
        <label>
          <span>
            Room <em>(optional)</em>
          </span>
          <select value={roomId} onChange={(event) => setRoomId(event.target.value)}>
            <option value="">No room (open bay)</option>
            {rooms
              .filter((room) => room.active)
              .map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
          </select>
        </label>
      )}
      <label>
        Type
        <select value={bedType} onChange={(event) => setBedType(event.target.value as BedType)}>
          {bedTypes.map((type) => (
            <option key={type} value={type}>
              {bedTypeLabels[type]}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={tools.busy}>
        Add bed
      </button>
    </form>
  );
}
