import { useState, type ReactNode } from 'react';
import { type Building, type Floor } from '../../api';
import { floorLevelLabel, unitPresets } from './location-types';
import { type Layout, type Selection } from './location-shared';
import { plural } from './location-parts';

export function LayoutTree({
  layout,
  selection,
  select,
  query,
  showInactive,
}: {
  layout: Layout;
  selection: Selection;
  select: (next: Selection) => void;
  query: string;
  showInactive: boolean;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const selectedId = selection.kind === 'hospital' ? null : selection.id;
  const matches = (item: { code: string; name: string }) =>
    !query || item.name.toLowerCase().includes(query) || item.code.toLowerCase().includes(query);
  const visible = (item: { id: string; active: boolean }) =>
    showInactive || item.active || item.id === selectedId;

  const wardsOf = (floor: Floor) =>
    layout.wards.filter(
      (ward) => ward.floorId === floor.id && visible(ward) && (matches(floor) || matches(ward)),
    );
  const floorShown = (floor: Floor, building?: Building) =>
    visible(floor) &&
    (!query ||
      (building && matches(building)) ||
      matches(floor) ||
      layout.wards.some((ward) => ward.floorId === floor.id && matches(ward)));
  const bedsIn = (wardId: string) =>
    layout.beds.filter((bed) => bed.wardId === wardId && bed.active).length;

  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const isOpen = (id: string) => Boolean(query) || !collapsed.has(id);

  const node = (
    kind: 'building' | 'floor' | 'ward',
    item: { id: string; name: string; code: string; active: boolean },
    detail: ReactNode,
    expandable: boolean,
  ) => (
    <div className={`tree-row tree-${kind}`}>
      {expandable ? (
        <button
          type="button"
          className="tree-toggle"
          aria-expanded={isOpen(item.id)}
          aria-label={`${isOpen(item.id) ? 'Collapse' : 'Expand'} ${item.name}`}
          onClick={() => toggle(item.id)}
        >
          {isOpen(item.id) ? '▾' : '▸'}
        </button>
      ) : (
        <span className="tree-toggle" aria-hidden="true" />
      )}
      <button
        type="button"
        className={`tree-item${item.active ? '' : ' inactive'}`}
        aria-current={selectedId === item.id ? 'true' : undefined}
        onClick={() => select({ kind, id: item.id })}
      >
        <span className="tree-name">{item.name}</span>
        <span className="tree-detail">{detail}</span>
      </button>
    </div>
  );

  const floorBranch = (floor: Floor) => {
    const wards = wardsOf(floor);
    return (
      <li key={floor.id}>
        {node('floor', floor, floorLevelLabel(floor.level) || floor.code, wards.length > 0)}
        {wards.length > 0 && isOpen(floor.id) && (
          <ul>
            {wards.map((ward) => (
              <li key={ward.id}>
                {node(
                  'ward',
                  ward,
                  `${unitPresets[ward.unitType].label.split(' (')[0]} · ${bedsIn(ward.id)}`,
                  false,
                )}
              </li>
            ))}
          </ul>
        )}
      </li>
    );
  };

  const buildings = layout.buildings.filter(
    (building) =>
      visible(building) &&
      (!query ||
        matches(building) ||
        layout.floors.some((floor) => floor.buildingId === building.id && floorShown(floor))),
  );
  const looseFloors = layout.floors.filter((floor) => !floor.buildingId && floorShown(floor));
  const empty = buildings.length === 0 && looseFloors.length === 0;

  return (
    <div className="tree">
      <button
        type="button"
        className="tree-item tree-root"
        aria-current={selection.kind === 'hospital' ? 'true' : undefined}
        onClick={() => select({ kind: 'hospital' })}
      >
        <span className="tree-name">Whole hospital</span>
        <span className="tree-detail">{layout.beds.filter((bed) => bed.active).length} beds</span>
      </button>
      <ul>
        {buildings.map((building) => {
          const floors = layout.floors.filter(
            (floor) => floor.buildingId === building.id && floorShown(floor, building),
          );
          return (
            <li key={building.id}>
              {node('building', building, plural(floors.length, 'floor'), floors.length > 0)}
              {floors.length > 0 && isOpen(building.id) && (
                <ul>{floors.map((floor) => floorBranch(floor))}</ul>
              )}
            </li>
          );
        })}
        {looseFloors.length > 0 && buildings.length > 0 && (
          <li className="tree-group">Not in a building</li>
        )}
        {looseFloors.map((floor) => floorBranch(floor))}
      </ul>
      {empty && (
        <p className="muted small">
          {query ? 'Nothing matches your search.' : 'No floors yet. Add one on the right.'}
        </p>
      )}
    </div>
  );
}

export function Breadcrumbs({
  layout,
  selection,
  select,
}: {
  layout: Layout;
  selection: Selection;
  select: (next: Selection) => void;
}) {
  if (selection.kind === 'hospital') return null;
  const ward =
    selection.kind === 'ward' ? layout.wards.find((item) => item.id === selection.id) : undefined;
  const floor = layout.floors.find(
    (item) => item.id === (ward ? ward.floorId : selection.kind === 'floor' ? selection.id : ''),
  );
  const building = layout.buildings.find(
    (item) =>
      item.id === (floor ? floor.buildingId : selection.kind === 'building' ? selection.id : ''),
  );
  const crumbs: { label: string; target: Selection }[] = [
    { label: 'Whole hospital', target: { kind: 'hospital' } },
    ...(building
      ? [{ label: building.name, target: { kind: 'building' as const, id: building.id } }]
      : []),
    ...(floor ? [{ label: floor.name, target: { kind: 'floor' as const, id: floor.id } }] : []),
    ...(ward ? [{ label: ward.name, target: { kind: 'ward' as const, id: ward.id } }] : []),
  ];
  return (
    <nav className="breadcrumbs small" aria-label="You are here">
      {crumbs.map((crumb, index) =>
        index === crumbs.length - 1 ? (
          <span key={crumb.label} aria-current="page">
            {crumb.label}
          </span>
        ) : (
          <span key={crumb.label}>
            <button type="button" className="link" onClick={() => select(crumb.target)}>
              {crumb.label}
            </button>{' '}
            ›{' '}
          </span>
        ),
      )}
    </nav>
  );
}
