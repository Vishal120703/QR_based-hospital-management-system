import { staffApi, type Bed, type BedSession, type StaffRequest } from '../../api';
import { isOverdue } from '../../lib/request-status';
import { bedState, loadPlaces, placeOfBed, type BedPlace, type BedState } from './bed-places';

// Open requests are counted from at most this many (most urgent first).
const requestPages = 5;

export interface BoardBed extends BedPlace {
  bed: Bed;
  state: BedState;
  session: BedSession | undefined;
  openRequests: number;
  overdueRequests: number;
}

interface Board {
  beds: BoardBed[];
  requestsTruncated: boolean;
}

async function openRequestsByBed(token: string) {
  const byBed = new Map<string, StaffRequest[]>();
  let truncated = false;
  for (let page = 1; page <= requestPages; page += 1) {
    const queue = await staffApi.requests(token, { view: 'open', page, pageSize: 100 });
    for (const request of queue.serviceRequests) {
      byBed.set(request.bedId, [...(byBed.get(request.bedId) ?? []), request]);
    }
    if (page * queue.pageSize >= queue.total) return { byBed, truncated };
    truncated = page === requestPages;
  }
  return { byBed, truncated };
}

export async function loadBoard(
  token: string,
  canReadLocations: boolean,
  canReadRequests: boolean,
): Promise<Board> {
  const now = Date.now();
  const [beds, places, sessions, requests] = await Promise.all([
    staffApi.list<Bed>(token, 'beds'),
    loadPlaces(token, canReadLocations),
    staffApi.list<BedSession>(token, 'bed-sessions', '?status=ACTIVE'),
    canReadRequests
      ? openRequestsByBed(token)
      : Promise.resolve({ byBed: new Map<string, StaffRequest[]>(), truncated: false }),
  ]);
  return {
    beds: beds.map((bed) => {
      const open = requests.byBed.get(bed.id) ?? [];
      return {
        bed,
        ...placeOfBed(bed, places),
        state: bedState(bed),
        session: sessions.find((item) => item.bedId === bed.id),
        openRequests: open.length,
        overdueRequests: open.filter((request) => isOverdue(request, now)).length,
      };
    }),
    requestsTruncated: requests.truncated,
  };
}
