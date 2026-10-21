import { useState } from 'react';
import { staffApi, type BedType, type Room, type RoomType } from '../../api';
import { bedTypeLabels, roomTypeLabels, bedTypes, roomTypes } from './location-types';
import { useAdmin } from '../workspace/AdminLayout';
import { type PanelTools } from './location-shared';
import { codeInput } from '../../lib/field-rules';

// Forms that add one room or one bed to a ward.

export function AddRoomForm({ tools, wardId }: { tools: PanelTools; wardId: string }) {
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
          {...codeInput}
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

export function AddBedForm({
  tools,
  wardId,
  rooms,
  defaultType,
  codePrefix,
}: {
  tools: PanelTools;
  wardId: string;
  rooms: Room[];
  defaultType: BedType;
  codePrefix: string;
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
          {...codeInput}
          placeholder={`${codePrefix}21`}
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
      <RoomSelect label="Room" rooms={rooms} value={roomId} onChange={setRoomId} />
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

// Optional room for new beds; only active rooms are offered.
export function RoomSelect({
  label,
  rooms,
  value,
  onChange,
}: {
  label: string;
  rooms: Room[];
  value: string;
  onChange: (roomId: string) => void;
}) {
  if (rooms.length === 0) return null;
  return (
    <label>
      <span>
        {label} <em>(optional)</em>
      </span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
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
  );
}
