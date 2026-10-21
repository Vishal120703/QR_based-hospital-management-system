import { floorLevelLabel, unitPresets } from './location-types';
import {
  bedStats,
  LocationActions,
  PanelHeader,
  QrLabelsButton,
  type PanelTools,
} from './location-shared';
import { AddUnitForm } from './LocationForms';
import { ChildCard, levelField, levelPatch, StatRow } from './location-parts';

export function FloorPanel({ tools, id }: { tools: PanelTools; id: string }) {
  const { layout } = tools;
  const floor = layout.floors.find((item) => item.id === id);
  if (!floor) return null;
  const wards = layout.wards.filter((ward) => ward.floorId === id);
  const stats = bedStats(layout.beds.filter((bed) => wards.some((ward) => ward.id === bed.wardId)));

  return (
    <>
      <PanelHeader
        eyebrow={['Floor', floorLevelLabel(floor.level)].filter(Boolean).join(' · ')}
        title={floor.name}
        code={floor.code}
        active={floor.active}
      >
        <QrLabelsButton
          tools={tools}
          scope={{ kind: 'FLOOR', id }}
          beds={layout.beds.filter((bed) => wards.some((ward) => ward.id === bed.wardId))}
          area={[layout.buildings.find((item) => item.id === floor.buildingId)?.name, floor.name]
            .filter(Boolean)
            .join(' · ')}
        />
        <LocationActions
          tools={tools}
          kind="floors"
          item={floor}
          label={floor.name}
          canEdit={tools.canManage}
          canDelete={wards.length === 0}
          editFields={[
            { name: 'name', label: 'Name' },
            { name: 'code', label: 'Code' },
            levelField,
          ]}
          editInitial={{
            name: floor.name,
            code: floor.code,
            level: floor.level === null ? '' : String(floor.level),
          }}
          toPatch={levelPatch}
        />
      </PanelHeader>
      <StatRow
        items={[
          { label: 'Units', value: wards.length },
          { label: 'Beds', value: stats.total },
          ...(tools.showOccupancy ? [{ label: 'Occupied', value: stats.occupied }] : []),
          { label: 'Available', value: stats.available },
        ]}
      />
      <h3 className="section-title">Units and wards</h3>
      {wards.length === 0 ? (
        <p className="muted">No units on this floor yet. Add a ward or other unit below.</p>
      ) : (
        <div className="child-grid">
          {wards.map((ward) => {
            const beds = bedStats(layout.beds.filter((bed) => bed.wardId === ward.id));
            return (
              <ChildCard
                key={ward.id}
                title={ward.name}
                subtitle={`${unitPresets[ward.unitType].label} · ${beds.total} beds${
                  tools.showOccupancy ? ` · ${beds.occupied} occupied` : ''
                }`}
                active={ward.active}
                onOpen={() => tools.select({ kind: 'ward', id: ward.id })}
              />
            );
          })}
        </div>
      )}
      {tools.canManage && floor.active && <AddUnitForm tools={tools} floorId={id} />}
    </>
  );
}
