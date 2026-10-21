import {
  staffApi,
  type Bed,
  type BedStatus,
  type Building,
  type Floor,
  type Room,
  type Ward,
} from '../../api';

// Where a bed is: building, floor, ward, and room, for the bed screens.
export interface BedPlace {
  location: string;
  buildingId: string | undefined;
  buildingName: string | undefined;
  floorId: string | undefined;
  floorName: string | undefined;
  floorLevel: number | null;
  wardId: string;
  wardName: string | undefined;
  roomId: string | null;
  roomName: string | undefined;
}

export interface Places {
  wards: Ward[];
  floors: Floor[];
  rooms: Room[];
  buildings: Building[];
}

// Floor and ward managers hold location.read for their own area only; without
// it, beds still load, just without their place names.
export async function loadPlaces(token: string, canReadLocations: boolean): Promise<Places> {
  if (!canReadLocations) return { wards: [], floors: [], rooms: [], buildings: [] };
  const [wards, floors, rooms, buildings] = await Promise.all([
    staffApi.list<Ward>(token, 'wards'),
    staffApi.list<Floor>(token, 'floors'),
    staffApi.list<Room>(token, 'rooms'),
    staffApi.list<Building>(token, 'buildings'),
  ]);
  return { wards, floors, rooms, buildings };
}

export function placeOfBed(bed: Bed, places: Places): BedPlace {
  const ward = places.wards.find((item) => item.id === bed.wardId);
  const floor = places.floors.find((item) => item.id === ward?.floorId);
  const room = places.rooms.find((item) => item.id === bed.roomId);
  // Floor names repeat across buildings ("Ground Floor"), so name both.
  const building = places.buildings.find((item) => item.id === floor?.buildingId);
  return {
    location: [building?.name, floor?.name, ward?.name, room?.name].filter(Boolean).join(' · '),
    buildingId: building?.id,
    buildingName: building?.name,
    floorId: floor?.id,
    floorName: floor && [building?.name, floor.name].filter(Boolean).join(' · '),
    floorLevel: floor?.level ?? null,
    wardId: bed.wardId,
    wardName: ward?.name,
    roomId: bed.roomId,
    roomName: room?.name,
  };
}

// What a bed can do right now, in plain words. A bed switched off in Location
// setup (inactive) is out of service whatever its stored status.
export type BedState = 'AVAILABLE' | 'OCCUPIED' | 'MAINTENANCE' | 'OUT_OF_SERVICE';

export function bedState(bed: { status: BedStatus; active: boolean }): BedState {
  if (bed.status === 'OCCUPIED') return 'OCCUPIED';
  if (!bed.active || bed.status === 'INACTIVE') return 'OUT_OF_SERVICE';
  if (bed.status === 'MAINTENANCE') return 'MAINTENANCE';
  return 'AVAILABLE';
}

export const bedStateLabels: Record<BedState, string> = {
  AVAILABLE: 'Available',
  OCCUPIED: 'Occupied',
  MAINTENANCE: 'Under maintenance',
  OUT_OF_SERVICE: 'Out of service',
};
