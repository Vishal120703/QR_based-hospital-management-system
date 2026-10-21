import { floorLevelLabel } from './location-types';
import {
  bedStats,
  LocationActions,
  PanelHeader,
  QrLabelsButton,
  type PanelTools,
} from './location-shared';
import { AddFloorForm } from './LocationForms';
import { ChildCard, plural, StatRow } from './location-parts';

export function BuildingPanel({ tools, id }: { tools: PanelTools; id: string }) {
  const { layout } = tools;
  const building = layout.buildings.find((item) => item.id === id);
  if (!building) return null;
  const floors = layout.floors.filter((floor) => floor.buildingId === id);
  const wards = layout.wards.filter((ward) => floors.some((floor) => floor.id === ward.floorId));
  const stats = bedStats(layout.beds.filter((bed) => wards.some((ward) => ward.id === bed.wardId)));

  return (
    <>
      <PanelHeader
        eyebrow="Building"
        title={building.name}
        code={building.code}
        active={building.active}
      >
        <QrLabelsButton
          tools={tools}
          scope={{ kind: 'BUILDING', id }}
          beds={layout.beds.filter((bed) => wards.some((ward) => ward.id === bed.wardId))}
          area={building.name}
        />
        <LocationActions
          tools={tools}
          kind="buildings"
          item={building}
          label={building.name}
          canEdit={tools.canManage}
          canDelete={floors.length === 0}
          editFields={[
            { name: 'name', label: 'Name' },
            { name: 'code', label: 'Code' },
          ]}
          editInitial={{ name: building.name, code: building.code }}
        />
      </PanelHeader>
      <StatRow
        items={[
          { label: 'Floors', value: floors.length },
          { label: 'Units', value: wards.length },
          { label: 'Beds', value: stats.total },
          ...(tools.showOccupancy ? [{ label: 'Occupied', value: stats.occupied }] : []),
        ]}
      />
      <h3 className="section-title">Floors</h3>
      {floors.length === 0 ? (
        <p className="muted">No floors in this building yet.</p>
      ) : (
        <div className="child-grid">
          {floors.map((floor) => (
            <ChildCard
              key={floor.id}
              title={floor.name}
              subtitle={[
                floorLevelLabel(floor.level),
                plural(layout.wards.filter((ward) => ward.floorId === floor.id).length, 'unit'),
              ]
                .filter(Boolean)
                .join(' · ')}
              active={floor.active}
              onOpen={() => tools.select({ kind: 'floor', id: floor.id })}
            />
          ))}
        </div>
      )}
      {tools.canManage && building.active && <AddFloorForm tools={tools} buildingId={id} />}
    </>
  );
}
