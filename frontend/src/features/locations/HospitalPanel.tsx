import { unitPresets, wardTypes } from './location-types';
import { bedStats, PanelHeader, QrLabelsButton, type PanelTools } from './location-shared';
import { AddBuildingForm, AddFloorForm } from './LocationForms';
import { ChildCard, plural, StatRow } from './location-parts';

export function HospitalPanel({ tools }: { tools: PanelTools }) {
  const { layout } = tools;
  const stats = bedStats(layout.beds);
  const byType = wardTypes
    .map((type) => {
      const wards = layout.wards.filter((ward) => ward.unitType === type && ward.active);
      const beds = bedStats(
        layout.beds.filter((bed) => wards.some((ward) => ward.id === bed.wardId)),
      );
      return { type, wards: wards.length, ...beds };
    })
    .filter((row) => row.wards > 0);

  return (
    <>
      <PanelHeader eyebrow="Overview" title="Whole hospital">
        <QrLabelsButton
          tools={tools}
          scope={{ kind: 'HOSPITAL' }}
          beds={layout.beds}
          area="Whole hospital"
        />
      </PanelHeader>
      <StatRow
        items={[
          { label: 'Buildings', value: layout.buildings.filter((item) => item.active).length },
          { label: 'Floors', value: layout.floors.filter((item) => item.active).length },
          { label: 'Units / wards', value: layout.wards.filter((item) => item.active).length },
          { label: 'Beds', value: stats.total },
          ...(tools.showOccupancy ? [{ label: 'Occupied', value: stats.occupied }] : []),
        ]}
      />
      {layout.floors.length === 0 ? (
        <section className="card">
          <h3>Set up your hospital in four steps</h3>
          <ol className="plain-steps">
            <li>
              <strong>Buildings</strong> (optional): blocks, towers, or wings, such as “Main Block”.
            </li>
            <li>
              <strong>Floors</strong>: give each a level so they are listed basement → top.
            </li>
            <li>
              <strong>Units</strong>: General ward, Private rooms, Maternity, Emergency, Day care…
            </li>
            <li>
              <strong>Beds</strong>: add many at once. Rooms are optional, for private and
              semi-private wards.
            </li>
          </ol>
        </section>
      ) : (
        byType.length > 0 && (
          <section className="card">
            <h3>Beds by unit type</h3>
            <ul className="type-summary">
              {byType.map((row) => (
                <li key={row.type}>
                  <strong>{unitPresets[row.type].label}</strong>
                  <span className="muted small">
                    {row.wards} unit{row.wards === 1 ? '' : 's'} · {row.total} beds ·{' '}
                    {tools.showOccupancy && `${row.occupied} occupied · `}
                    {row.available} available
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )
      )}
      {layout.buildings.length > 0 && (
        <section>
          <h3 className="section-title">Buildings</h3>
          <div className="child-grid">
            {layout.buildings.map((building) => (
              <ChildCard
                key={building.id}
                title={building.name}
                subtitle={`${building.code} · ${plural(layout.floors.filter((floor) => floor.buildingId === building.id).length, 'floor')}`}
                active={building.active}
                onOpen={() => tools.select({ kind: 'building', id: building.id })}
              />
            ))}
          </div>
        </section>
      )}
      {tools.canManage && (
        <div className="form-pair">
          <AddBuildingForm tools={tools} />
          <AddFloorForm tools={tools} />
        </div>
      )}
    </>
  );
}
