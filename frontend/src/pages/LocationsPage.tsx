import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import {
  staffApi,
  type Bed,
  type Building,
  type Floor,
  type QrCode,
  type Room,
  type Ward,
  type WardType,
} from '../api';
import { LoadState, PageHeading } from '../components';
import {
  floorLevelLabel,
  floorSuggestion,
  sortFloors,
  unitPresets,
  wardTypes,
} from '../location-types';
import { useAdmin } from './AdminLayout';
import {
  bedStats,
  LocationActions,
  PanelHeader,
  QrLabelsButton,
  type EditField,
  type Layout,
  type PanelTools,
  type Selection,
} from './location-shared';
import { WardPanel } from './WardPanel';

async function loadLayout(token: string, canReadBeds: boolean): Promise<Layout> {
  const [buildings, floors, wards, rooms, beds, qrCodes] = await Promise.all([
    staffApi.list<Building>(token, 'buildings'),
    staffApi.list<Floor>(token, 'floors'),
    staffApi.list<Ward>(token, 'wards'),
    staffApi.list<Room>(token, 'rooms'),
    canReadBeds ? staffApi.list<Bed>(token, 'beds') : Promise.resolve([]),
    canReadBeds ? staffApi.list<QrCode>(token, 'qr-codes') : Promise.resolve([]),
  ]);
  return { buildings, floors: sortFloors(floors), wards, rooms, beds, qrCodes };
}

function parseSelection(value: string | null): Selection {
  const [kind, id] = (value ?? '').split(':');
  return (kind === 'building' || kind === 'floor' || kind === 'ward') && id
    ? { kind, id }
    : { kind: 'hospital' };
}

export function LocationsPage() {
  const { token, reportError, reportSuccess, can } = useAdmin();
  const [layout, setLayout] = useState<Layout | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [params, setParams] = useSearchParams();
  const canReadBeds = can('bed.read');

  useEffect(() => {
    let cancelled = false;
    loadLayout(token, canReadBeds).then(
      (result) => {
        if (!cancelled) setLayout(result);
      },
      (cause: unknown) => {
        if (cancelled) return;
        setLoadError(cause instanceof Error ? cause.message : 'Could not load the layout.');
        reportError(cause);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [token, version, reportError, canReadBeds]);

  const select = useCallback(
    (next: Selection) => {
      setParams(next.kind === 'hospital' ? {} : { at: `${next.kind}:${next.id}` });
    },
    [setParams],
  );

  const run = useCallback(
    async (action: () => Promise<unknown>, success: string, confirmText?: string) => {
      if (busy) return false;
      if (confirmText && !window.confirm(confirmText)) return false;
      setBusy(true);
      try {
        await action();
        setLayout(await loadLayout(token, canReadBeds));
        reportSuccess(success);
        return true;
      } catch (cause) {
        reportError(cause);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [busy, token, canReadBeds, reportError, reportSuccess],
  );

  if (!layout) {
    return (
      <LoadState
        loading={!loadError}
        error={loadError}
        label="Loading the hospital layout…"
        onRetry={() => {
          setLoadError(null);
          setVersion((value) => value + 1);
        }}
      />
    );
  }

  const requested = parseSelection(params.get('at'));
  const pools = { building: layout.buildings, floor: layout.floors, ward: layout.wards };
  // A stale link (deleted place) falls back to the whole hospital.
  const selection: Selection =
    requested.kind === 'hospital' || pools[requested.kind].some((item) => item.id === requested.id)
      ? requested
      : { kind: 'hospital' };

  const tools: PanelTools = {
    layout,
    select,
    run,
    busy,
    canManage: can('location.manage'),
    canManageBeds: can('bed.manage'),
    canReadBeds,
    canPrintQr: canReadBeds && can('hospital.manage') && can('qr.generate'),
  };

  return (
    <>
      <PageHeading
        title="Hospital layout"
        description="Buildings, floors, units, rooms, and beds. Pick a place on the left to see and change what is inside it."
      />
      {!tools.canManage && (
        <p className="notice notice-warning">You have read-only access to locations.</p>
      )}
      <div className="layout-explorer">
        <nav className="card layout-tree" aria-label="Hospital layout">
          <label className="tree-search">
            <span className="visually-hidden">Search the layout</span>
            <input
              type="search"
              placeholder="Search units, floors…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label className="checkbox small">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(event) => setShowInactive(event.target.checked)}
            />
            Show inactive
          </label>
          <LayoutTree
            layout={layout}
            selection={selection}
            select={select}
            query={query.trim().toLowerCase()}
            showInactive={showInactive}
          />
        </nav>
        <section className="layout-detail" aria-live="polite">
          <Breadcrumbs layout={layout} selection={selection} select={select} />
          {selection.kind === 'hospital' && <HospitalPanel tools={tools} />}
          {selection.kind === 'building' && <BuildingPanel tools={tools} id={selection.id} />}
          {selection.kind === 'floor' && <FloorPanel tools={tools} id={selection.id} />}
          {selection.kind === 'ward' && (
            <WardPanel key={selection.id} tools={tools} id={selection.id} />
          )}
        </section>
      </div>
    </>
  );
}

// Tree

function LayoutTree({
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
              {node('building', building, `${floors.length} floors`, floors.length > 0)}
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

function Breadcrumbs({
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

function StatRow({ items }: { items: { label: string; value: number | string }[] }) {
  return (
    <dl className="stat-row">
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ChildCard({
  title,
  subtitle,
  active,
  onOpen,
}: {
  title: string;
  subtitle: string;
  active: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className={`card child-card${active ? '' : ' inactive'}`}
      onClick={onOpen}
    >
      <strong>{title}</strong>
      <span className="muted small">{subtitle}</span>
      {!active && <span className="badge">inactive</span>}
    </button>
  );
}

const levelField: EditField = {
  name: 'level',
  label: 'Level',
  type: 'number',
  optional: true,
  help: '-1 basement, 0 ground, 1 first floor… Floors are listed in this order.',
};

function levelPatch(changes: Record<string, string>): object {
  const { level, ...rest } = changes;
  if (level === undefined) return rest;
  return { ...rest, level: level.trim() === '' ? null : Number(level) };
}

// Panels

function HospitalPanel({ tools }: { tools: PanelTools }) {
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
          { label: 'Occupied', value: stats.occupied },
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
              <strong>Units</strong>: General ward, ICU, NICU, Emergency, Day care, Private rooms…
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
                    {row.wards} unit{row.wards === 1 ? '' : 's'} · {row.total} beds · {row.occupied}{' '}
                    occupied · {row.available} available
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
                subtitle={`${building.code} · ${layout.floors.filter((floor) => floor.buildingId === building.id).length} floors`}
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

function BuildingPanel({ tools, id }: { tools: PanelTools; id: string }) {
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
          { label: 'Occupied', value: stats.occupied },
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
                `${layout.wards.filter((ward) => ward.floorId === floor.id).length} units`,
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

function FloorPanel({ tools, id }: { tools: PanelTools; id: string }) {
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
          { label: 'Occupied', value: stats.occupied },
          { label: 'Available', value: stats.available },
        ]}
      />
      <h3 className="section-title">Units and wards</h3>
      {wards.length === 0 ? (
        <p className="muted">No units on this floor yet. Add a ward, ICU, or other unit below.</p>
      ) : (
        <div className="child-grid">
          {wards.map((ward) => {
            const beds = bedStats(layout.beds.filter((bed) => bed.wardId === ward.id));
            return (
              <ChildCard
                key={ward.id}
                title={ward.name}
                subtitle={`${unitPresets[ward.unitType].label} · ${beds.total} beds · ${beds.occupied} occupied`}
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

// Add forms

function AddBuildingForm({ tools }: { tools: PanelTools }) {
  const { token } = useAdmin();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  return (
    <form
      className="card create-form"
      onSubmit={(event) => {
        event.preventDefault();
        void tools
          .run(() => staffApi.create(token, 'buildings', { code, name }), `${name} added.`)
          .then((saved) => {
            if (saved) {
              setCode('');
              setName('');
            }
          });
      }}
    >
      <h3>Add a building</h3>
      <p className="muted small">Optional. Use it for blocks, towers, or wings on a campus.</p>
      <label>
        Name
        <input
          value={name}
          required
          maxLength={120}
          placeholder="Main Block"
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label>
        Code
        <input
          value={code}
          required
          maxLength={32}
          placeholder="MB"
          onChange={(event) => setCode(event.target.value)}
        />
      </label>
      <button type="submit" disabled={tools.busy}>
        Add building
      </button>
    </form>
  );
}

function AddFloorForm({ tools, buildingId }: { tools: PanelTools; buildingId?: string }) {
  const { token } = useAdmin();
  const [building, setBuilding] = useState(buildingId ?? '');
  const [level, setLevel] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);

  function changeLevel(value: string) {
    setLevel(value);
    if (!touched && value.trim() !== '' && Number.isInteger(Number(value))) {
      const suggestion = floorSuggestion(Number(value));
      setCode(suggestion.code);
      setName(suggestion.name);
    }
  }

  return (
    <form
      className="card create-form"
      onSubmit={(event) => {
        event.preventDefault();
        void tools
          .run(
            () =>
              staffApi.create(token, 'floors', {
                code,
                name,
                ...(building ? { buildingId: building } : {}),
                ...(level.trim() !== '' ? { level: Number(level) } : {}),
              }),
            `${name} added.`,
          )
          .then((saved) => {
            if (saved) {
              setLevel('');
              setCode('');
              setName('');
              setTouched(false);
            }
          });
      }}
    >
      <h3>Add a floor</h3>
      {!buildingId && (
        <label>
          <span>
            Building <em>(optional)</em>
          </span>
          <select value={building} onChange={(event) => setBuilding(event.target.value)}>
            <option value="">Not in a building</option>
            {tools.layout.buildings
              .filter((item) => item.active)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
        </label>
      )}
      <label>
        <span>
          Level <em>(recommended)</em>
        </span>
        <input
          type="number"
          min={-10}
          max={200}
          value={level}
          placeholder="0 = ground, -1 = basement"
          onChange={(event) => changeLevel(event.target.value)}
        />
      </label>
      <label>
        Name
        <input
          value={name}
          required
          maxLength={120}
          placeholder="First Floor"
          onChange={(event) => {
            setTouched(true);
            setName(event.target.value);
          }}
        />
      </label>
      <label>
        Code
        <input
          value={code}
          required
          maxLength={32}
          placeholder="F1"
          onChange={(event) => {
            setTouched(true);
            setCode(event.target.value);
          }}
        />
      </label>
      <button type="submit" disabled={tools.busy}>
        Add floor
      </button>
    </form>
  );
}

function AddUnitForm({ tools, floorId }: { tools: PanelTools; floorId: string }) {
  const { token } = useAdmin();
  const [unitType, setUnitType] = useState<WardType>('GENERAL');
  const [name, setName] = useState(unitPresets.GENERAL.name);
  const [code, setCode] = useState(unitPresets.GENERAL.code);
  const [touched, setTouched] = useState(false);
  const preset = unitPresets[unitType];

  function changeType(next: WardType) {
    setUnitType(next);
    if (!touched) {
      setName(unitPresets[next].name);
      setCode(unitPresets[next].code);
    }
  }

  return (
    <form
      className="card create-form"
      onSubmit={(event) => {
        event.preventDefault();
        void tools
          .run(async () => {
            const created = (await staffApi.create(token, 'wards', {
              floorId,
              unitType,
              code,
              name,
            })) as { ward?: Ward };
            // Open the new unit so beds can be added straight away.
            if (created.ward) tools.select({ kind: 'ward', id: created.ward.id });
          }, `${name} added. Now add its beds.`)
          .then((saved) => {
            if (saved) setTouched(false);
          });
      }}
    >
      <h3>Add a unit or ward</h3>
      <label>
        Type of unit
        <select value={unitType} onChange={(event) => changeType(event.target.value as WardType)}>
          {wardTypes.map((type) => (
            <option key={type} value={type}>
              {unitPresets[type].label}
            </option>
          ))}
        </select>
        <small className="muted">{preset.hint}</small>
      </label>
      <label>
        Name
        <input
          value={name}
          required
          maxLength={120}
          placeholder="Male Medical Ward"
          onChange={(event) => {
            setTouched(true);
            setName(event.target.value);
          }}
        />
      </label>
      <label>
        Code
        <input
          value={code}
          required
          maxLength={32}
          placeholder="MMW"
          onChange={(event) => {
            setTouched(true);
            setCode(event.target.value);
          }}
        />
        <small className="muted">Short and unique on this floor. Printed on QR labels.</small>
      </label>
      <button type="submit" disabled={tools.busy}>
        Add unit
      </button>
    </form>
  );
}
