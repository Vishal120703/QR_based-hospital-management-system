import { useState } from 'react';
import { type Bed, type Room } from '../../api';
import {
  bedCodePrefix,
  bedTypeLabels,
  floorLevelLabel,
  roomTypeLabels,
  unitPresets,
  wardTypes,
  bedTypes,
  roomTypes,
} from './location-types';
import {
  bedStats,
  hasActiveQr,
  LocationActions,
  PanelHeader,
  QrLabelsButton,
  type EditField,
  type PanelTools,
} from './location-shared';
import { BulkBedsForm } from './BulkBedsForm';
import { AddBedForm, AddRoomForm } from './WardForms';

const statusBadge: Record<Bed['status'], string> = {
  AVAILABLE: 'badge badge-available',
  OCCUPIED: 'badge badge-occupied',
  MAINTENANCE: 'badge badge-maintenance',
  INACTIVE: 'badge',
};

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
  const codePrefix = bedCodePrefix(ward, floor, layout.buildings);
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
            ...(tools.showOccupancy ? [['Occupied', stats.occupied]] : []),
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
          codePrefix={codePrefix}
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
              <AddBedForm
                tools={tools}
                wardId={id}
                rooms={rooms}
                defaultType={preset.bedType}
                codePrefix={codePrefix}
              />
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
                {tools.canManageBeds && (
                  <th>
                    <span className="visually-hidden">Actions</span>
                  </th>
                )}
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
