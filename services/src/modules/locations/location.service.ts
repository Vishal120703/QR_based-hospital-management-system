import {
  type Bed,
  type BedStatus,
  type BedType,
  type Building,
  type Floor,
  type Prisma,
  type PrismaClient,
  type Room,
  type RoomType,
  type Ward,
  type WardType,
} from '@prisma/client';
import { ConflictError, InvalidInputError, NotFoundError } from '../../common/errors/app-error.js';
import { recordStaffAudit } from '../audit/audit-log.js';
import { bedScopeWhere, type StaffContext } from '../auth/auth.service.js';

type Transaction = Prisma.TransactionClient;

export interface ActiveFilter {
  readonly active?: boolean | undefined;
}
export interface FloorFilter extends ActiveFilter {
  readonly buildingId?: string | undefined;
}
export interface WardFilter extends ActiveFilter {
  readonly floorId?: string | undefined;
}
export interface RoomFilter extends ActiveFilter {
  readonly wardId?: string | undefined;
}
export interface BedFilter extends RoomFilter {
  readonly roomId?: string | undefined;
  readonly status?: BedStatus | undefined;
}

export interface LocationCreate {
  readonly code: string;
  readonly name: string;
}
export interface FloorCreate extends LocationCreate {
  readonly buildingId?: string | undefined;
  readonly level?: number | undefined;
}
export interface WardCreate extends LocationCreate {
  readonly floorId: string;
  readonly unitType?: WardType | undefined;
}
export interface RoomCreate extends LocationCreate {
  readonly wardId: string;
  readonly roomType?: RoomType | undefined;
}
export interface LocationUpdate {
  readonly code?: string | undefined;
  readonly name?: string | undefined;
  readonly active?: boolean | undefined;
}
export interface FloorUpdate extends LocationUpdate {
  readonly level?: number | null | undefined;
}
export interface WardUpdate extends LocationUpdate {
  readonly unitType?: WardType | undefined;
}
export interface RoomUpdate extends LocationUpdate {
  readonly roomType?: RoomType | undefined;
}

// Creates many beds in one ward at once, either as numbered beds or as
// numbered rooms that each hold the same number of beds.
export type BulkBedsInput =
  | {
      readonly mode: 'BEDS';
      readonly roomId?: string | undefined;
      readonly codePrefix: string;
      readonly namePrefix: string;
      readonly start: number;
      readonly count: number;
      readonly bedType: BedType;
    }
  | {
      readonly mode: 'ROOMS';
      readonly roomPrefix: string;
      readonly start: number;
      readonly count: number;
      readonly roomType: RoomType;
      readonly bedsPerRoom: number;
      readonly bedType: BedType;
    };

export const maxBulkBeds = 300;

// The rooms and beds a bulk request would create. Kept pure so the numbering
// rule is easy to test and identical to the preview shown in the browser.
export function planBulkBeds(input: BulkBedsInput): {
  rooms: { code: string; name: string }[];
  beds: { roomCode: string | null; code: string; displayName: string }[];
} {
  const last = input.start + input.count - 1;
  const width = Math.max(2, String(last).length);
  const numbers = Array.from({ length: input.count }, (_, index) => input.start + index);
  if (input.mode === 'BEDS') {
    return {
      rooms: [],
      beds: numbers.map((number) => {
        const label = String(number).padStart(width, '0');
        return {
          roomCode: null,
          code: `${input.codePrefix}${label}`.toUpperCase(),
          displayName: `${input.namePrefix} ${label}`.trim(),
        };
      }),
    };
  }
  // Floor prefix "2" with rooms 1–3 gives 201, 202, 203.
  const rooms = numbers.map((number) => {
    const code = `${input.roomPrefix}${String(number).padStart(width, '0')}`.toUpperCase();
    return { code, name: `Room ${code}` };
  });
  return {
    rooms,
    beds: rooms.flatMap((room) =>
      input.bedsPerRoom === 1
        ? [{ roomCode: room.code, code: room.code, displayName: `Room ${room.code}` }]
        : Array.from({ length: input.bedsPerRoom }, (_, index) => {
            const code = `${room.code}-${String.fromCharCode(65 + index)}`;
            return { roomCode: room.code, code, displayName: `Bed ${code}` };
          }),
    ),
  };
}

// OCCUPIED is reserved for the BedSession lifecycle and is never set manually.
export type ManualBedStatus = Exclude<BedStatus, 'OCCUPIED'>;

export interface BedCreate {
  readonly wardId: string;
  readonly roomId?: string | undefined;
  readonly code: string;
  readonly displayName: string;
  readonly bedType?: BedType | undefined;
}
export interface BedUpdate {
  readonly code?: string | undefined;
  readonly displayName?: string | undefined;
  readonly bedType?: BedType | undefined;
  readonly status?: ManualBedStatus | undefined;
  readonly active?: boolean | undefined;
}

const snapshot = {
  building: (row: Building) => ({ code: row.code, name: row.name, active: row.active }),
  floor: (row: Floor) => ({
    buildingId: row.buildingId,
    code: row.code,
    name: row.name,
    level: row.level,
    active: row.active,
  }),
  ward: (row: Ward) => ({
    floorId: row.floorId,
    code: row.code,
    name: row.name,
    unitType: row.unitType,
    active: row.active,
  }),
  room: (row: Room) => ({
    wardId: row.wardId,
    code: row.code,
    name: row.name,
    roomType: row.roomType,
    active: row.active,
  }),
  bed: (row: Bed) => ({
    wardId: row.wardId,
    roomId: row.roomId,
    code: row.code,
    displayName: row.displayName,
    bedType: row.bedType,
    status: row.status,
    active: row.active,
  }),
};

function tenantKey(context: StaffContext, id: string) {
  return { hospitalId_id: { hospitalId: context.tenant.hospitalId, id } };
}

function found<T>(row: T | null): T {
  if (!row) {
    throw new NotFoundError();
  }
  return row;
}

// Invariant: an active location always has active ancestors.
function requireActiveParent(parent: { active: boolean } | null, label: string): void {
  if (!parent) {
    throw new NotFoundError(`The referenced ${label} was not found.`);
  }
  if (!parent.active) {
    throw new ConflictError(`The ${label} is inactive.`);
  }
}

function requireNoActiveChildren(count: number, label: string): void {
  if (count > 0) {
    throw new ConflictError(`Deactivate the active locations inside this ${label} first.`);
  }
}

function requireNoChildren(count: number, label: string): void {
  if (count > 0) {
    throw new ConflictError(`Delete the locations inside this ${label} first.`);
  }
}

// What a floor- or ward-level role may see: its own floors and wards, their
// rooms and beds, and the buildings around them. Hospital-wide access adds no
// filter; a permission held nowhere relevant matches nothing.
export function areaFilters(context: StaffContext, permission: string) {
  const area = bedScopeWhere(context, permission);
  if (area && 'hospitalWide' in area) {
    return { building: {}, floor: {}, ward: {} };
  }
  const floorIds = area?.floorIds ?? [];
  const wardIds = area?.wardIds ?? [];
  const floor: Prisma.FloorWhereInput = {
    OR: [{ id: { in: floorIds } }, { wards: { some: { id: { in: wardIds } } } }],
  };
  const ward: Prisma.WardWhereInput = {
    OR: [{ floorId: { in: floorIds } }, { id: { in: wardIds } }],
  };
  const building: Prisma.BuildingWhereInput = { floors: { some: floor } };
  return { building, floor, ward };
}

function activeWhere(filter: ActiveFilter) {
  return filter.active === undefined ? {} : { active: filter.active };
}

function locationChanges(input: LocationUpdate) {
  return {
    ...(input.code !== undefined ? { code: input.code } : {}),
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.active !== undefined ? { active: input.active } : {}),
  };
}

export class LocationService {
  public constructor(private readonly database: PrismaClient) {}

  // Buildings

  public listBuildings(context: StaffContext, filter: ActiveFilter) {
    return this.database.building.findMany({
      where: {
        hospitalId: context.tenant.hospitalId,
        ...activeWhere(filter),
        AND: [areaFilters(context, 'location.read').building],
      },
      orderBy: { code: 'asc' },
    });
  }

  public async getBuilding(context: StaffContext, id: string) {
    return found(
      await this.database.building.findFirst({
        where: {
          hospitalId: context.tenant.hospitalId,
          id,
          AND: [areaFilters(context, 'location.read').building],
        },
      }),
    );
  }

  public createBuilding(context: StaffContext, input: LocationCreate, requestId: string) {
    return this.write(async (transaction) => {
      const building = await transaction.building.create({
        data: { hospitalId: context.tenant.hospitalId, code: input.code, name: input.name },
      });
      await recordStaffAudit(transaction, context, requestId, {
        action: 'building.create',
        targetType: 'Building',
        targetId: building.id,
        metadata: { after: snapshot.building(building) },
      });
      return building;
    });
  }

  public updateBuilding(
    context: StaffContext,
    id: string,
    input: LocationUpdate,
    requestId: string,
  ) {
    const hospitalId = context.tenant.hospitalId;
    return this.write(async (transaction) => {
      const before = found(
        await transaction.building.findUnique({ where: tenantKey(context, id) }),
      );
      if (input.active === false && before.active) {
        requireNoActiveChildren(
          await transaction.floor.count({ where: { hospitalId, buildingId: id, active: true } }),
          'building',
        );
      }
      const after = await transaction.building.update({
        where: tenantKey(context, id),
        data: locationChanges(input),
      });
      await recordStaffAudit(transaction, context, requestId, {
        action: 'building.update',
        targetType: 'Building',
        targetId: id,
        metadata: { before: snapshot.building(before), after: snapshot.building(after) },
      });
      return after;
    });
  }

  public async deleteBuilding(context: StaffContext, id: string, requestId: string) {
    const hospitalId = context.tenant.hospitalId;
    await this.write(async (transaction) => {
      const before = found(
        await transaction.building.findUnique({ where: tenantKey(context, id) }),
      );
      requireNoChildren(
        await transaction.floor.count({ where: { hospitalId, buildingId: id } }),
        'building',
      );
      await transaction.building.delete({ where: tenantKey(context, id) });
      await recordStaffAudit(transaction, context, requestId, {
        action: 'building.delete',
        targetType: 'Building',
        targetId: id,
        metadata: { before: snapshot.building(before) },
      });
    });
  }

  // Floors

  public listFloors(context: StaffContext, filter: FloorFilter) {
    return this.database.floor.findMany({
      where: {
        hospitalId: context.tenant.hospitalId,
        ...(filter.buildingId !== undefined ? { buildingId: filter.buildingId } : {}),
        ...activeWhere(filter),
        AND: [areaFilters(context, 'location.read').floor],
      },
      orderBy: [{ level: { sort: 'asc', nulls: 'last' } }, { code: 'asc' }],
    });
  }

  public async getFloor(context: StaffContext, id: string) {
    return found(
      await this.database.floor.findFirst({
        where: {
          hospitalId: context.tenant.hospitalId,
          id,
          AND: [areaFilters(context, 'location.read').floor],
        },
      }),
    );
  }

  public createFloor(context: StaffContext, input: FloorCreate, requestId: string) {
    return this.write(async (transaction) => {
      if (input.buildingId !== undefined) {
        requireActiveParent(
          await transaction.building.findUnique({ where: tenantKey(context, input.buildingId) }),
          'building',
        );
      }
      const floor = await transaction.floor.create({
        data: {
          hospitalId: context.tenant.hospitalId,
          buildingId: input.buildingId ?? null,
          code: input.code,
          name: input.name,
          level: input.level ?? null,
        },
      });
      await recordStaffAudit(transaction, context, requestId, {
        action: 'floor.create',
        targetType: 'Floor',
        targetId: floor.id,
        metadata: { after: snapshot.floor(floor) },
      });
      return floor;
    });
  }

  public updateFloor(context: StaffContext, id: string, input: FloorUpdate, requestId: string) {
    const hospitalId = context.tenant.hospitalId;
    return this.write(async (transaction) => {
      const before = found(await transaction.floor.findUnique({ where: tenantKey(context, id) }));
      if (input.active === true && !before.active && before.buildingId) {
        requireActiveParent(
          await transaction.building.findUnique({ where: tenantKey(context, before.buildingId) }),
          'building',
        );
      }
      if (input.active === false && before.active) {
        requireNoActiveChildren(
          await transaction.ward.count({ where: { hospitalId, floorId: id, active: true } }),
          'floor',
        );
      }
      const after = await transaction.floor.update({
        where: tenantKey(context, id),
        data: {
          ...locationChanges(input),
          ...(input.level !== undefined ? { level: input.level } : {}),
        },
      });
      await recordStaffAudit(transaction, context, requestId, {
        action: 'floor.update',
        targetType: 'Floor',
        targetId: id,
        metadata: { before: snapshot.floor(before), after: snapshot.floor(after) },
      });
      return after;
    });
  }

  public async deleteFloor(context: StaffContext, id: string, requestId: string) {
    const hospitalId = context.tenant.hospitalId;
    await this.write(async (transaction) => {
      const before = found(await transaction.floor.findUnique({ where: tenantKey(context, id) }));
      requireNoChildren(
        await transaction.ward.count({ where: { hospitalId, floorId: id } }),
        'floor',
      );
      await transaction.floor.delete({ where: tenantKey(context, id) });
      await recordStaffAudit(transaction, context, requestId, {
        action: 'floor.delete',
        targetType: 'Floor',
        targetId: id,
        metadata: { before: snapshot.floor(before) },
      });
    });
  }

  // Wards

  public listWards(context: StaffContext, filter: WardFilter) {
    return this.database.ward.findMany({
      where: {
        hospitalId: context.tenant.hospitalId,
        ...(filter.floorId !== undefined ? { floorId: filter.floorId } : {}),
        ...activeWhere(filter),
        AND: [areaFilters(context, 'location.read').ward],
      },
      orderBy: { code: 'asc' },
    });
  }

  public async getWard(context: StaffContext, id: string) {
    return found(
      await this.database.ward.findFirst({
        where: {
          hospitalId: context.tenant.hospitalId,
          id,
          AND: [areaFilters(context, 'location.read').ward],
        },
      }),
    );
  }

  public createWard(context: StaffContext, input: WardCreate, requestId: string) {
    return this.write(async (transaction) => {
      requireActiveParent(
        await transaction.floor.findUnique({ where: tenantKey(context, input.floorId) }),
        'floor',
      );
      const ward = await transaction.ward.create({
        data: {
          hospitalId: context.tenant.hospitalId,
          floorId: input.floorId,
          code: input.code,
          name: input.name,
          ...(input.unitType ? { unitType: input.unitType } : {}),
        },
      });
      await recordStaffAudit(transaction, context, requestId, {
        action: 'ward.create',
        targetType: 'Ward',
        targetId: ward.id,
        metadata: { after: snapshot.ward(ward) },
      });
      return ward;
    });
  }

  public updateWard(context: StaffContext, id: string, input: WardUpdate, requestId: string) {
    const hospitalId = context.tenant.hospitalId;
    return this.write(async (transaction) => {
      const before = found(await transaction.ward.findUnique({ where: tenantKey(context, id) }));
      if (input.active === true && !before.active) {
        requireActiveParent(
          await transaction.floor.findUnique({ where: tenantKey(context, before.floorId) }),
          'floor',
        );
      }
      if (input.active === false && before.active) {
        const activeRooms = await transaction.room.count({
          where: { hospitalId, wardId: id, active: true },
        });
        const activeBeds = await transaction.bed.count({
          where: { hospitalId, wardId: id, active: true },
        });
        requireNoActiveChildren(activeRooms + activeBeds, 'ward');
      }
      const after = await transaction.ward.update({
        where: tenantKey(context, id),
        data: {
          ...locationChanges(input),
          ...(input.unitType !== undefined ? { unitType: input.unitType } : {}),
        },
      });
      await recordStaffAudit(transaction, context, requestId, {
        action: 'ward.update',
        targetType: 'Ward',
        targetId: id,
        metadata: { before: snapshot.ward(before), after: snapshot.ward(after) },
      });
      return after;
    });
  }

  public async deleteWard(context: StaffContext, id: string, requestId: string) {
    const hospitalId = context.tenant.hospitalId;
    await this.write(async (transaction) => {
      const before = found(await transaction.ward.findUnique({ where: tenantKey(context, id) }));
      const rooms = await transaction.room.count({ where: { hospitalId, wardId: id } });
      const beds = await transaction.bed.count({ where: { hospitalId, wardId: id } });
      requireNoChildren(rooms + beds, 'ward');
      await transaction.ward.delete({ where: tenantKey(context, id) });
      await recordStaffAudit(transaction, context, requestId, {
        action: 'ward.delete',
        targetType: 'Ward',
        targetId: id,
        metadata: { before: snapshot.ward(before) },
      });
    });
  }

  // Rooms

  public listRooms(context: StaffContext, filter: RoomFilter) {
    return this.database.room.findMany({
      where: {
        hospitalId: context.tenant.hospitalId,
        ...(filter.wardId !== undefined ? { wardId: filter.wardId } : {}),
        ...activeWhere(filter),
        ward: areaFilters(context, 'location.read').ward,
      },
      orderBy: { code: 'asc' },
    });
  }

  public async getRoom(context: StaffContext, id: string) {
    return found(
      await this.database.room.findFirst({
        where: {
          hospitalId: context.tenant.hospitalId,
          id,
          ward: areaFilters(context, 'location.read').ward,
        },
      }),
    );
  }

  public createRoom(context: StaffContext, input: RoomCreate, requestId: string) {
    return this.write(async (transaction) => {
      requireActiveParent(
        await transaction.ward.findUnique({ where: tenantKey(context, input.wardId) }),
        'ward',
      );
      const room = await transaction.room.create({
        data: {
          hospitalId: context.tenant.hospitalId,
          wardId: input.wardId,
          code: input.code,
          name: input.name,
          ...(input.roomType ? { roomType: input.roomType } : {}),
        },
      });
      await recordStaffAudit(transaction, context, requestId, {
        action: 'room.create',
        targetType: 'Room',
        targetId: room.id,
        metadata: { after: snapshot.room(room) },
      });
      return room;
    });
  }

  public updateRoom(context: StaffContext, id: string, input: RoomUpdate, requestId: string) {
    const hospitalId = context.tenant.hospitalId;
    return this.write(async (transaction) => {
      const before = found(await transaction.room.findUnique({ where: tenantKey(context, id) }));
      if (input.active === true && !before.active) {
        requireActiveParent(
          await transaction.ward.findUnique({ where: tenantKey(context, before.wardId) }),
          'ward',
        );
      }
      if (input.active === false && before.active) {
        requireNoActiveChildren(
          await transaction.bed.count({ where: { hospitalId, roomId: id, active: true } }),
          'room',
        );
      }
      const after = await transaction.room.update({
        where: tenantKey(context, id),
        data: {
          ...locationChanges(input),
          ...(input.roomType !== undefined ? { roomType: input.roomType } : {}),
        },
      });
      await recordStaffAudit(transaction, context, requestId, {
        action: 'room.update',
        targetType: 'Room',
        targetId: id,
        metadata: { before: snapshot.room(before), after: snapshot.room(after) },
      });
      return after;
    });
  }

  public async deleteRoom(context: StaffContext, id: string, requestId: string) {
    const hospitalId = context.tenant.hospitalId;
    await this.write(async (transaction) => {
      const before = found(await transaction.room.findUnique({ where: tenantKey(context, id) }));
      requireNoChildren(await transaction.bed.count({ where: { hospitalId, roomId: id } }), 'room');
      await transaction.room.delete({ where: tenantKey(context, id) });
      await recordStaffAudit(transaction, context, requestId, {
        action: 'room.delete',
        targetType: 'Room',
        targetId: id,
        metadata: { before: snapshot.room(before) },
      });
    });
  }

  // Beds

  public listBeds(context: StaffContext, filter: BedFilter) {
    return this.database.bed.findMany({
      where: {
        hospitalId: context.tenant.hospitalId,
        ...(filter.wardId !== undefined ? { wardId: filter.wardId } : {}),
        ...(filter.roomId !== undefined ? { roomId: filter.roomId } : {}),
        ...(filter.status !== undefined ? { status: filter.status } : {}),
        ...activeWhere(filter),
        ward: areaFilters(context, 'bed.read').ward,
      },
      orderBy: [{ wardId: 'asc' }, { code: 'asc' }],
    });
  }

  public async getBed(context: StaffContext, id: string) {
    return found(
      await this.database.bed.findFirst({
        where: {
          hospitalId: context.tenant.hospitalId,
          id,
          ward: areaFilters(context, 'bed.read').ward,
        },
      }),
    );
  }

  public createBed(context: StaffContext, input: BedCreate, requestId: string) {
    const hospitalId = context.tenant.hospitalId;
    return this.write(async (transaction) => {
      requireActiveParent(
        await transaction.ward.findUnique({ where: tenantKey(context, input.wardId) }),
        'ward',
      );
      if (input.roomId !== undefined) {
        // The room must belong to the bed's own ward, not merely the same hospital.
        requireActiveParent(
          await transaction.room.findUnique({
            where: {
              hospitalId_wardId_id: { hospitalId, wardId: input.wardId, id: input.roomId },
            },
          }),
          'room',
        );
      }
      const bed = await transaction.bed.create({
        data: {
          hospitalId,
          wardId: input.wardId,
          roomId: input.roomId ?? null,
          code: input.code,
          displayName: input.displayName,
          ...(input.bedType ? { bedType: input.bedType } : {}),
        },
      });
      await recordStaffAudit(transaction, context, requestId, {
        action: 'bed.create',
        targetType: 'Bed',
        targetId: bed.id,
        metadata: { after: snapshot.bed(bed) },
      });
      return bed;
    });
  }

  public updateBed(context: StaffContext, id: string, input: BedUpdate, requestId: string) {
    return this.write(async (transaction) => {
      const before = found(await transaction.bed.findUnique({ where: tenantKey(context, id) }));
      if (before.status === 'OCCUPIED' && (input.status !== undefined || input.active === false)) {
        throw new ConflictError('An occupied bed is managed through its bed session.');
      }
      if (input.active === true && !before.active) {
        requireActiveParent(
          await transaction.ward.findUnique({ where: tenantKey(context, before.wardId) }),
          'ward',
        );
        if (before.roomId) {
          requireActiveParent(
            await transaction.room.findUnique({ where: tenantKey(context, before.roomId) }),
            'room',
          );
        }
      }
      const after = await transaction.bed.update({
        where: tenantKey(context, id),
        data: {
          ...(input.code !== undefined ? { code: input.code } : {}),
          ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
          ...(input.bedType !== undefined ? { bedType: input.bedType } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
        },
      });
      await recordStaffAudit(transaction, context, requestId, {
        action: 'bed.update',
        targetType: 'Bed',
        targetId: id,
        metadata: { before: snapshot.bed(before), after: snapshot.bed(after) },
      });
      return after;
    });
  }

  public async deleteBed(context: StaffContext, id: string, requestId: string) {
    await this.write(async (transaction) => {
      const before = found(await transaction.bed.findUnique({ where: tenantKey(context, id) }));
      const hospitalId = context.tenant.hospitalId;
      const qrCodes = await transaction.bedQrCode.count({ where: { hospitalId, bedId: id } });
      const sessions = await transaction.bedSession.count({ where: { hospitalId, bedId: id } });
      if (qrCodes + sessions > 0) {
        throw new ConflictError(
          'This bed has a QR code or session history. Deactivate it instead.',
        );
      }
      await transaction.bed.delete({ where: tenantKey(context, id) });
      await recordStaffAudit(transaction, context, requestId, {
        action: 'bed.delete',
        targetType: 'Bed',
        targetId: id,
        metadata: { before: snapshot.bed(before) },
      });
    });
  }

  // All-or-nothing: if any generated code already exists in the ward, nothing
  // is created and the conflicting codes are reported.
  public bulkCreateBeds(
    context: StaffContext,
    wardId: string,
    input: BulkBedsInput,
    requestId: string,
  ) {
    const hospitalId = context.tenant.hospitalId;
    const plan = planBulkBeds(input);
    if (plan.beds.length > maxBulkBeds) {
      throw new InvalidInputError(`Create at most ${maxBulkBeds} beds at a time.`);
    }
    return this.write(async (transaction) => {
      requireActiveParent(
        await transaction.ward.findUnique({ where: tenantKey(context, wardId) }),
        'ward',
      );
      if (input.mode === 'BEDS' && input.roomId !== undefined) {
        requireActiveParent(
          await transaction.room.findUnique({
            where: { hospitalId_wardId_id: { hospitalId, wardId, id: input.roomId } },
          }),
          'room',
        );
      }
      const [takenBeds, takenRooms] = await Promise.all([
        transaction.bed.findMany({
          where: { hospitalId, wardId, code: { in: plan.beds.map((bed) => bed.code) } },
          select: { code: true },
        }),
        transaction.room.findMany({
          where: { hospitalId, wardId, code: { in: plan.rooms.map((room) => room.code) } },
          select: { code: true },
        }),
      ]);
      const taken = [...takenRooms, ...takenBeds].map((row) => row.code);
      if (taken.length > 0) {
        const sample = [...new Set(taken)].slice(0, 5).join(', ');
        throw new ConflictError(
          `These codes already exist in this ward: ${sample}${taken.length > 5 ? ', …' : ''}. Choose another prefix or start number.`,
        );
      }

      const rooms =
        input.mode === 'ROOMS'
          ? await transaction.room.createManyAndReturn({
              data: plan.rooms.map((room) => ({
                hospitalId,
                wardId,
                code: room.code,
                name: room.name,
                roomType: input.roomType,
              })),
            })
          : [];
      const roomIdByCode = new Map(rooms.map((room) => [room.code, room.id]));
      const beds = await transaction.bed.createManyAndReturn({
        data: plan.beds.map((bed) => ({
          hospitalId,
          wardId,
          roomId:
            input.mode === 'ROOMS'
              ? (roomIdByCode.get(bed.roomCode ?? '') ?? null)
              : (input.roomId ?? null),
          code: bed.code,
          displayName: bed.displayName,
          bedType: input.bedType,
        })),
      });
      await recordStaffAudit(transaction, context, requestId, {
        action: 'bed.bulk_create',
        targetType: 'Ward',
        targetId: wardId,
        metadata: {
          mode: input.mode,
          roomCodes: rooms.map((room) => room.code),
          bedCodes: beds.map((bed) => bed.code),
        },
      });
      return { rooms, beds };
    });
  }

  // Serializable isolation keeps the parent/child "active" checks race-free:
  // a concurrent deactivate-parent and create-child cannot both commit.
  private write<T>(operation: (transaction: Transaction) => Promise<T>): Promise<T> {
    return this.database.$transaction(operation, { isolationLevel: 'Serializable' });
  }
}
