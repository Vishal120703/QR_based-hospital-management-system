import {
  type Bed,
  type Building,
  type Floor,
  type Prisma,
  type PrismaClient,
  type Room,
  type Ward,
} from '@prisma/client';
import { ConflictError, InvalidInputError, NotFoundError } from '../../common/errors/app-error.js';
import { recordStaffAudit } from '../audit/index.js';
import { bedScopeWhere, type StaffContext } from '../auth/index.js';
import { maxBulkBeds, planBulkBeds, type BulkBedsInput } from './bulk-beds.js';
import { LocationRepository } from './location.repository.js';
import {
  type BedFilter,
  type BuildingFilter,
  type CreateBedInput,
  type CreateBuildingInput,
  type CreateFloorInput,
  type CreateRoomInput,
  type CreateWardInput,
  type FloorFilter,
  type RoomFilter,
  type UpdateBedInput,
  type UpdateBuildingInput,
  type UpdateFloorInput,
  type UpdateRoomInput,
  type UpdateWardInput,
  type WardFilter,
} from './location.schemas.js';

type Transaction = Prisma.TransactionClient;

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

function locationChanges(input: {
  code?: string | undefined;
  name?: string | undefined;
  active?: boolean | undefined;
}) {
  return {
    ...(input.code !== undefined ? { code: input.code } : {}),
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.active !== undefined ? { active: input.active } : {}),
  };
}

// Buildings, floors, wards (units), rooms, and beds. Reads respect the
// caller's floor or ward; every change is audited in the same transaction.
export class LocationService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly locations = new LocationRepository(),
  ) {}

  // Buildings

  public listBuildings(context: StaffContext, filter: BuildingFilter) {
    return this.locations.listBuildings(this.database, context.tenant.hospitalId, {
      active: filter.active,
      area: areaFilters(context, 'location.read').building,
    });
  }

  public async getBuilding(context: StaffContext, id: string) {
    return found(
      await this.locations.findBuildingInArea(
        this.database,
        context.tenant.hospitalId,
        id,
        areaFilters(context, 'location.read').building,
      ),
    );
  }

  public createBuilding(context: StaffContext, input: CreateBuildingInput, requestId: string) {
    return this.write(async (transaction) => {
      const building = await this.locations.createBuilding(transaction, context.tenant.hospitalId, {
        code: input.code,
        name: input.name,
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
    input: UpdateBuildingInput,
    requestId: string,
  ) {
    const hospitalId = context.tenant.hospitalId;
    return this.write(async (transaction) => {
      const before = found(await this.locations.findBuilding(transaction, hospitalId, id));
      if (input.active === false && before.active) {
        requireNoActiveChildren(
          await this.locations.countFloorsInBuilding(transaction, hospitalId, id, true),
          'building',
        );
      }
      const after = await this.locations.updateBuilding(
        transaction,
        hospitalId,
        id,
        locationChanges(input),
      );
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
      const before = found(await this.locations.findBuilding(transaction, hospitalId, id));
      requireNoChildren(
        await this.locations.countFloorsInBuilding(transaction, hospitalId, id, false),
        'building',
      );
      await this.locations.deleteBuilding(transaction, hospitalId, id);
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
    return this.locations.listFloors(this.database, context.tenant.hospitalId, {
      buildingId: filter.buildingId,
      active: filter.active,
      area: areaFilters(context, 'location.read').floor,
    });
  }

  public async getFloor(context: StaffContext, id: string) {
    return found(
      await this.locations.findFloorInArea(
        this.database,
        context.tenant.hospitalId,
        id,
        areaFilters(context, 'location.read').floor,
      ),
    );
  }

  public createFloor(context: StaffContext, input: CreateFloorInput, requestId: string) {
    const hospitalId = context.tenant.hospitalId;
    return this.write(async (transaction) => {
      if (input.buildingId !== undefined) {
        requireActiveParent(
          await this.locations.findBuilding(transaction, hospitalId, input.buildingId),
          'building',
        );
      }
      const floor = await this.locations.createFloor(transaction, hospitalId, {
        buildingId: input.buildingId ?? null,
        code: input.code,
        name: input.name,
        level: input.level ?? null,
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

  public updateFloor(
    context: StaffContext,
    id: string,
    input: UpdateFloorInput,
    requestId: string,
  ) {
    const hospitalId = context.tenant.hospitalId;
    return this.write(async (transaction) => {
      const before = found(await this.locations.findFloor(transaction, hospitalId, id));
      if (input.active === true && !before.active && before.buildingId) {
        requireActiveParent(
          await this.locations.findBuilding(transaction, hospitalId, before.buildingId),
          'building',
        );
      }
      if (input.active === false && before.active) {
        requireNoActiveChildren(
          await this.locations.countWardsOnFloor(transaction, hospitalId, id, true),
          'floor',
        );
      }
      const after = await this.locations.updateFloor(transaction, hospitalId, id, {
        ...locationChanges(input),
        ...(input.level !== undefined ? { level: input.level } : {}),
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
      const before = found(await this.locations.findFloor(transaction, hospitalId, id));
      requireNoChildren(
        await this.locations.countWardsOnFloor(transaction, hospitalId, id, false),
        'floor',
      );
      await this.locations.deleteFloor(transaction, hospitalId, id);
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
    return this.locations.listWards(this.database, context.tenant.hospitalId, {
      floorId: filter.floorId,
      active: filter.active,
      area: areaFilters(context, 'location.read').ward,
    });
  }

  public async getWard(context: StaffContext, id: string) {
    return found(
      await this.locations.findWardInArea(
        this.database,
        context.tenant.hospitalId,
        id,
        areaFilters(context, 'location.read').ward,
      ),
    );
  }

  public createWard(context: StaffContext, input: CreateWardInput, requestId: string) {
    const hospitalId = context.tenant.hospitalId;
    return this.write(async (transaction) => {
      requireActiveParent(
        await this.locations.findFloor(transaction, hospitalId, input.floorId),
        'floor',
      );
      const ward = await this.locations.createWard(transaction, hospitalId, {
        floorId: input.floorId,
        code: input.code,
        name: input.name,
        ...(input.unitType ? { unitType: input.unitType } : {}),
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

  public updateWard(context: StaffContext, id: string, input: UpdateWardInput, requestId: string) {
    const hospitalId = context.tenant.hospitalId;
    return this.write(async (transaction) => {
      const before = found(await this.locations.findWard(transaction, hospitalId, id));
      if (input.active === true && !before.active) {
        requireActiveParent(
          await this.locations.findFloor(transaction, hospitalId, before.floorId),
          'floor',
        );
      }
      if (input.active === false && before.active) {
        const activeRooms = await this.locations.countRoomsInWard(
          transaction,
          hospitalId,
          id,
          true,
        );
        const activeBeds = await this.locations.countBedsInWard(transaction, hospitalId, id, true);
        requireNoActiveChildren(activeRooms + activeBeds, 'ward');
      }
      const after = await this.locations.updateWard(transaction, hospitalId, id, {
        ...locationChanges(input),
        ...(input.unitType !== undefined ? { unitType: input.unitType } : {}),
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
      const before = found(await this.locations.findWard(transaction, hospitalId, id));
      const rooms = await this.locations.countRoomsInWard(transaction, hospitalId, id, false);
      const beds = await this.locations.countBedsInWard(transaction, hospitalId, id, false);
      requireNoChildren(rooms + beds, 'ward');
      await this.locations.deleteWard(transaction, hospitalId, id);
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
    return this.locations.listRooms(this.database, context.tenant.hospitalId, {
      wardId: filter.wardId,
      active: filter.active,
      wardArea: areaFilters(context, 'location.read').ward,
    });
  }

  public async getRoom(context: StaffContext, id: string) {
    return found(
      await this.locations.findRoomInArea(
        this.database,
        context.tenant.hospitalId,
        id,
        areaFilters(context, 'location.read').ward,
      ),
    );
  }

  public createRoom(context: StaffContext, input: CreateRoomInput, requestId: string) {
    const hospitalId = context.tenant.hospitalId;
    return this.write(async (transaction) => {
      requireActiveParent(
        await this.locations.findWard(transaction, hospitalId, input.wardId),
        'ward',
      );
      const room = await this.locations.createRoom(transaction, hospitalId, {
        wardId: input.wardId,
        code: input.code,
        name: input.name,
        ...(input.roomType ? { roomType: input.roomType } : {}),
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

  public updateRoom(context: StaffContext, id: string, input: UpdateRoomInput, requestId: string) {
    const hospitalId = context.tenant.hospitalId;
    return this.write(async (transaction) => {
      const before = found(await this.locations.findRoom(transaction, hospitalId, id));
      if (input.active === true && !before.active) {
        requireActiveParent(
          await this.locations.findWard(transaction, hospitalId, before.wardId),
          'ward',
        );
      }
      if (input.active === false && before.active) {
        requireNoActiveChildren(
          await this.locations.countBedsInRoom(transaction, hospitalId, id, true),
          'room',
        );
      }
      const after = await this.locations.updateRoom(transaction, hospitalId, id, {
        ...locationChanges(input),
        ...(input.roomType !== undefined ? { roomType: input.roomType } : {}),
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
      const before = found(await this.locations.findRoom(transaction, hospitalId, id));
      requireNoChildren(
        await this.locations.countBedsInRoom(transaction, hospitalId, id, false),
        'room',
      );
      await this.locations.deleteRoom(transaction, hospitalId, id);
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
    return this.locations.listBeds(this.database, context.tenant.hospitalId, {
      wardId: filter.wardId,
      roomId: filter.roomId,
      status: filter.status,
      active: filter.active,
      wardArea: areaFilters(context, 'bed.read').ward,
    });
  }

  public async getBed(context: StaffContext, id: string) {
    return found(
      await this.locations.findBedInArea(
        this.database,
        context.tenant.hospitalId,
        id,
        areaFilters(context, 'bed.read').ward,
      ),
    );
  }

  public createBed(context: StaffContext, input: CreateBedInput, requestId: string) {
    const hospitalId = context.tenant.hospitalId;
    return this.write(async (transaction) => {
      requireActiveParent(
        await this.locations.findWard(transaction, hospitalId, input.wardId),
        'ward',
      );
      if (input.roomId !== undefined) {
        // The room must belong to the bed's own ward, not merely the same hospital.
        requireActiveParent(
          await this.locations.findRoomInWard(transaction, hospitalId, input.wardId, input.roomId),
          'room',
        );
      }
      const bed = await this.locations.createBed(transaction, hospitalId, {
        wardId: input.wardId,
        roomId: input.roomId ?? null,
        code: input.code,
        displayName: input.displayName,
        ...(input.bedType ? { bedType: input.bedType } : {}),
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

  public updateBed(context: StaffContext, id: string, input: UpdateBedInput, requestId: string) {
    const hospitalId = context.tenant.hospitalId;
    return this.write(async (transaction) => {
      const before = found(await this.locations.findBed(transaction, hospitalId, id));
      if (before.status === 'OCCUPIED' && (input.status !== undefined || input.active === false)) {
        throw new ConflictError('An occupied bed is managed through its bed session.');
      }
      if (input.active === true && !before.active) {
        requireActiveParent(
          await this.locations.findWard(transaction, hospitalId, before.wardId),
          'ward',
        );
        if (before.roomId) {
          requireActiveParent(
            await this.locations.findRoom(transaction, hospitalId, before.roomId),
            'room',
          );
        }
      }
      const after = await this.locations.updateBed(transaction, hospitalId, id, {
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        ...(input.bedType !== undefined ? { bedType: input.bedType } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
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
    const hospitalId = context.tenant.hospitalId;
    await this.write(async (transaction) => {
      const before = found(await this.locations.findBed(transaction, hospitalId, id));
      if ((await this.locations.countBedHistory(transaction, hospitalId, id)) > 0) {
        throw new ConflictError(
          'This bed has a QR code or session history. Deactivate it instead.',
        );
      }
      await this.locations.deleteBed(transaction, hospitalId, id);
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
      requireActiveParent(await this.locations.findWard(transaction, hospitalId, wardId), 'ward');
      if (input.mode === 'BEDS' && input.roomId !== undefined) {
        requireActiveParent(
          await this.locations.findRoomInWard(transaction, hospitalId, wardId, input.roomId),
          'room',
        );
      }
      const [takenBeds, takenRooms] = await Promise.all([
        this.locations.findBedCodes(
          transaction,
          hospitalId,
          wardId,
          plan.beds.map((bed) => bed.code),
        ),
        this.locations.findRoomCodes(
          transaction,
          hospitalId,
          wardId,
          plan.rooms.map((room) => room.code),
        ),
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
          ? await this.locations.createRooms(
              transaction,
              hospitalId,
              wardId,
              plan.rooms.map((room) => ({
                code: room.code,
                name: room.name,
                roomType: input.roomType,
              })),
            )
          : [];
      const roomIdByCode = new Map(rooms.map((room) => [room.code, room.id]));
      const beds = await this.locations.createBeds(
        transaction,
        hospitalId,
        wardId,
        plan.beds.map((bed) => ({
          roomId:
            input.mode === 'ROOMS'
              ? (roomIdByCode.get(bed.roomCode ?? '') ?? null)
              : (input.roomId ?? null),
          code: bed.code,
          displayName: bed.displayName,
          bedType: input.bedType,
        })),
      );
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
