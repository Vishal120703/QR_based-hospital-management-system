import {
  type Bed,
  type BedStatus,
  type Building,
  type Floor,
  type Prisma,
  type PrismaClient,
  type Room,
  type Ward,
} from '@prisma/client';
import { ConflictError, NotFoundError } from '../../common/errors/app-error.js';
import { recordStaffAudit } from '../audit/audit-log.js';
import { type StaffContext } from '../auth/auth.service.js';

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
}
export interface WardCreate extends LocationCreate {
  readonly floorId: string;
}
export interface RoomCreate extends LocationCreate {
  readonly wardId: string;
}
export interface LocationUpdate {
  readonly code?: string | undefined;
  readonly name?: string | undefined;
  readonly active?: boolean | undefined;
}

// OCCUPIED is reserved for the BedSession lifecycle and is never set manually.
export type ManualBedStatus = Exclude<BedStatus, 'OCCUPIED'>;

export interface BedCreate {
  readonly wardId: string;
  readonly roomId?: string | undefined;
  readonly code: string;
  readonly displayName: string;
}
export interface BedUpdate {
  readonly code?: string | undefined;
  readonly displayName?: string | undefined;
  readonly status?: ManualBedStatus | undefined;
  readonly active?: boolean | undefined;
}

const snapshot = {
  building: (row: Building) => ({ code: row.code, name: row.name, active: row.active }),
  floor: (row: Floor) => ({
    buildingId: row.buildingId,
    code: row.code,
    name: row.name,
    active: row.active,
  }),
  ward: (row: Ward) => ({
    floorId: row.floorId,
    code: row.code,
    name: row.name,
    active: row.active,
  }),
  room: (row: Room) => ({ wardId: row.wardId, code: row.code, name: row.name, active: row.active }),
  bed: (row: Bed) => ({
    wardId: row.wardId,
    roomId: row.roomId,
    code: row.code,
    displayName: row.displayName,
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
      where: { hospitalId: context.tenant.hospitalId, ...activeWhere(filter) },
      orderBy: { code: 'asc' },
    });
  }

  public async getBuilding(context: StaffContext, id: string) {
    return found(await this.database.building.findUnique({ where: tenantKey(context, id) }));
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
      },
      orderBy: { code: 'asc' },
    });
  }

  public async getFloor(context: StaffContext, id: string) {
    return found(await this.database.floor.findUnique({ where: tenantKey(context, id) }));
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

  public updateFloor(context: StaffContext, id: string, input: LocationUpdate, requestId: string) {
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
        data: locationChanges(input),
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
      },
      orderBy: { code: 'asc' },
    });
  }

  public async getWard(context: StaffContext, id: string) {
    return found(await this.database.ward.findUnique({ where: tenantKey(context, id) }));
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

  public updateWard(context: StaffContext, id: string, input: LocationUpdate, requestId: string) {
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
        data: locationChanges(input),
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
      },
      orderBy: { code: 'asc' },
    });
  }

  public async getRoom(context: StaffContext, id: string) {
    return found(await this.database.room.findUnique({ where: tenantKey(context, id) }));
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

  public updateRoom(context: StaffContext, id: string, input: LocationUpdate, requestId: string) {
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
        data: locationChanges(input),
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
      },
      orderBy: [{ wardId: 'asc' }, { code: 'asc' }],
    });
  }

  public async getBed(context: StaffContext, id: string) {
    return found(await this.database.bed.findUnique({ where: tenantKey(context, id) }));
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

  // Serializable isolation keeps the parent/child "active" checks race-free:
  // a concurrent deactivate-parent and create-child cannot both commit.
  private write<T>(operation: (transaction: Transaction) => Promise<T>): Promise<T> {
    return this.database.$transaction(operation, { isolationLevel: 'Serializable' });
  }
}
