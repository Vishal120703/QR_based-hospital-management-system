import { type PrismaClient, type Room } from '@prisma/client';
import { recordStaffAudit } from '../audit/index.js';
import { type StaffContext } from '../auth/index.js';
import { areaFilters } from './location-access.js';
import {
  found,
  locationChanges,
  requireActiveParent,
  requireNoActiveChildren,
  requireNoChildren,
  writeSerializable,
} from './location-rules.js';
import { type LocationRepository } from './location.repository.js';
import { type CreateRoomInput, type RoomFilter, type UpdateRoomInput } from './location.schemas.js';

const snapshot = (row: Room) => ({
  wardId: row.wardId,
  code: row.code,
  name: row.name,
  roomType: row.roomType,
  active: row.active,
});

// Rooms inside a ward. Reads respect the caller's floor or ward; every change
// is audited in the same transaction.
export class RoomService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly locations: LocationRepository,
  ) {}

  public list(context: StaffContext, filter: RoomFilter) {
    return this.locations.listRooms(this.database, context.tenant.hospitalId, {
      wardId: filter.wardId,
      active: filter.active,
      wardArea: areaFilters(context, 'location.read').ward,
    });
  }

  public async get(context: StaffContext, id: string) {
    return found(
      await this.locations.findRoomInArea(
        this.database,
        context.tenant.hospitalId,
        id,
        areaFilters(context, 'location.read').ward,
      ),
    );
  }

  public create(context: StaffContext, input: CreateRoomInput, requestId: string) {
    const hospitalId = context.tenant.hospitalId;
    return writeSerializable(this.database, async (transaction) => {
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
        metadata: { after: snapshot(room) },
      });
      return room;
    });
  }

  public update(context: StaffContext, id: string, input: UpdateRoomInput, requestId: string) {
    const hospitalId = context.tenant.hospitalId;
    return writeSerializable(this.database, async (transaction) => {
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
        metadata: { before: snapshot(before), after: snapshot(after) },
      });
      return after;
    });
  }

  public async remove(context: StaffContext, id: string, requestId: string) {
    const hospitalId = context.tenant.hospitalId;
    await writeSerializable(this.database, async (transaction) => {
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
        metadata: { before: snapshot(before) },
      });
    });
  }
}
