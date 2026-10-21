import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  staffApi,
  type Bed,
  type Building,
  type Floor,
  type QrCode,
  type Room,
  type Ward,
} from '../../api';
import { LoadState, PageHeading, useConfirm } from '../../components';
import { useLoad } from '../../lib/use-load';
import { sortFloors } from './location-types';
import { useAdmin } from '../workspace/AdminLayout';
import { type Layout, type PanelTools, type Selection } from './location-shared';
import { WardPanel } from './WardPanel';
import { BuildingPanel } from './BuildingPanel';
import { FloorPanel } from './FloorPanel';
import { HospitalPanel } from './HospitalPanel';
import { Breadcrumbs, LayoutTree } from './LayoutTree';

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
  const { token, me, reportError, reportSuccess, can } = useAdmin();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [params, setParams] = useSearchParams();
  const canReadBeds = can('bed.read');

  const {
    data: layout,
    error: loadError,
    reload,
    refresh,
  } = useLoad(
    useCallback(() => loadLayout(token, canReadBeds), [token, canReadBeds]),
    { failure: 'Could not load the layout.', onUnauthorized: reportError },
  );

  const select = useCallback(
    (next: Selection) => {
      setParams(next.kind === 'hospital' ? {} : { at: `${next.kind}:${next.id}` });
    },
    [setParams],
  );

  const run = useCallback(
    async (action: () => Promise<unknown>, success: string, confirmText?: string) => {
      if (busy) return false;
      if (confirmText && !(await confirm(confirmText))) return false;
      setBusy(true);
      try {
        await action();
        await refresh();
        reportSuccess(success);
        return true;
      } catch (cause) {
        reportError(cause);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [busy, confirm, refresh, reportError, reportSuccess],
  );

  if (!layout) {
    return (
      <LoadState
        loading={!loadError}
        error={loadError}
        label="Loading the hospital layout…"
        onRetry={reload}
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
    showOccupancy: me.tenant.bedOccupancyEnabled,
  };

  return (
    <>
      <PageHeading
        title="Hospital layout"
        description="Buildings, floors, units, rooms, and beds. Pick a place on the left to see and change what is inside it."
      />
      <LoadState loading={false} error={loadError} onRetry={reload} />
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
