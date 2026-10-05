import { useEffect, useState, type ReactNode } from 'react';
import { staffApi, type Bed, type Building, type Floor, type Room, type Ward } from '../api';
import { CreateForm } from '../components';
import { useAdmin } from './AdminLayout';

interface Locations {
  buildings: Building[];
  floors: Floor[];
  wards: Ward[];
  rooms: Room[];
  beds: Bed[];
}

async function loadLocations(token: string): Promise<Locations> {
  const [buildings, floors, wards, rooms, beds] = await Promise.all([
    staffApi.list<Building>(token, 'buildings'),
    staffApi.list<Floor>(token, 'floors'),
    staffApi.list<Ward>(token, 'wards'),
    staffApi.list<Room>(token, 'rooms'),
    staffApi.list<Bed>(token, 'beds'),
  ]);
  return { buildings, floors, wards, rooms, beds };
}

const optionsOf = (items: { id: string; code: string; name: string }[]) =>
  items.map((item) => ({ value: item.id, label: `${item.code} — ${item.name}` }));

function codeOf(items: { id: string; code: string }[], id: string | null): string {
  return items.find((item) => item.id === id)?.code ?? '—';
}

export function LocationsPage() {
  const { token, reportError } = useAdmin();
  const [data, setData] = useState<Locations | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loadLocations(token).then(
      (result) => {
        if (!cancelled) setData(result);
      },
      (cause: unknown) => {
        if (!cancelled) reportError(cause);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [token, version, reportError]);

  if (!data) {
    return <p className="muted">Loading locations…</p>;
  }

  const create = (kind: Parameters<typeof staffApi.create>[1], input: object) =>
    staffApi.create(token, kind, input).then(() => setVersion((value) => value + 1));
  const optional = (value: string | undefined) => (value ? value : undefined);

  return (
    <>
      <h1>Locations</h1>
      <p className="muted">
        Set up the hospital from the top down. Building and room are optional; a bed always belongs
        to a ward.
      </p>
      <div className="location-grid">
        <Section title="Buildings" count={data.buildings.length}>
          <List
            items={data.buildings.map((item) => ({ ...item, detail: '' }))}
            empty="No buildings yet."
          />
          <CreateForm
            submitLabel="Add building"
            onError={reportError}
            fields={() => [
              { name: 'code', label: 'Code', placeholder: 'A' },
              { name: 'name', label: 'Name', placeholder: 'Main Block' },
            ]}
            onCreate={(values) => create('buildings', { code: values.code, name: values.name })}
          />
        </Section>

        <Section title="Floors" count={data.floors.length}>
          <List
            items={data.floors.map((item) => ({
              ...item,
              detail: item.buildingId ? `Building ${codeOf(data.buildings, item.buildingId)}` : '',
            }))}
            empty="No floors yet."
          />
          <CreateForm
            submitLabel="Add floor"
            onError={reportError}
            fields={() => [
              {
                name: 'buildingId',
                label: 'Building',
                optional: true,
                options: optionsOf(data.buildings.filter((item) => item.active)),
              },
              { name: 'code', label: 'Code', placeholder: 'F1' },
              { name: 'name', label: 'Name', placeholder: 'First Floor' },
            ]}
            onCreate={(values) =>
              create('floors', {
                buildingId: optional(values.buildingId),
                code: values.code,
                name: values.name,
              })
            }
          />
        </Section>

        <Section title="Wards" count={data.wards.length}>
          <List
            items={data.wards.map((item) => ({
              ...item,
              detail: `Floor ${codeOf(data.floors, item.floorId)}`,
            }))}
            empty="No wards yet."
          />
          <CreateForm
            submitLabel="Add ward"
            onError={reportError}
            fields={() => [
              {
                name: 'floorId',
                label: 'Floor',
                options: optionsOf(data.floors.filter((item) => item.active)),
              },
              { name: 'code', label: 'Code', placeholder: 'GEN' },
              { name: 'name', label: 'Name', placeholder: 'General Ward' },
            ]}
            onCreate={(values) =>
              create('wards', { floorId: values.floorId, code: values.code, name: values.name })
            }
          />
        </Section>

        <Section title="Rooms" count={data.rooms.length}>
          <List
            items={data.rooms.map((item) => ({
              ...item,
              detail: `Ward ${codeOf(data.wards, item.wardId)}`,
            }))}
            empty="No rooms yet."
          />
          <CreateForm
            submitLabel="Add room"
            onError={reportError}
            fields={() => [
              {
                name: 'wardId',
                label: 'Ward',
                options: optionsOf(data.wards.filter((item) => item.active)),
              },
              { name: 'code', label: 'Code', placeholder: '101' },
              { name: 'name', label: 'Name', placeholder: 'Room 101' },
            ]}
            onCreate={(values) =>
              create('rooms', { wardId: values.wardId, code: values.code, name: values.name })
            }
          />
        </Section>

        <Section title="Beds" count={data.beds.length}>
          <List
            items={data.beds.map((item) => ({
              ...item,
              name: item.displayName,
              detail: `Ward ${codeOf(data.wards, item.wardId)}`,
            }))}
            empty="No beds yet."
          />
          <CreateForm
            submitLabel="Add bed"
            onError={reportError}
            fields={(values) => [
              {
                name: 'wardId',
                label: 'Ward',
                options: optionsOf(data.wards.filter((item) => item.active)),
              },
              {
                name: 'roomId',
                label: 'Room',
                optional: true,
                options: optionsOf(
                  data.rooms.filter((item) => item.active && item.wardId === values.wardId),
                ),
              },
              { name: 'code', label: 'Code', placeholder: '101-A' },
              { name: 'displayName', label: 'Display name', placeholder: 'Bed 101-A' },
            ]}
            onCreate={(values) =>
              create('beds', {
                wardId: values.wardId,
                roomId: optional(values.roomId),
                code: values.code,
                displayName: values.displayName,
              })
            }
          />
        </Section>
      </div>
    </>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className="card">
      <h2>
        {title} <span className="count">{count}</span>
      </h2>
      {children}
    </section>
  );
}

function List({
  items,
  empty,
}: {
  items: { id: string; code: string; name: string; detail: string; active: boolean }[];
  empty: string;
}) {
  if (items.length === 0) {
    return <p className="muted">{empty}</p>;
  }
  return (
    <ul className="location-list">
      {items.map((item) => (
        <li key={item.id}>
          <span className="code">{item.code}</span> {item.name}
          {item.detail && <span className="muted"> · {item.detail}</span>}
          {!item.active && <span className="badge badge-muted">inactive</span>}
        </li>
      ))}
    </ul>
  );
}
