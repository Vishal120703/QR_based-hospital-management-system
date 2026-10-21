import { type Bed, type PrismaClient } from '@prisma/client';
import { ConflictError, InvalidInputError } from '../../common/errors/app-error.js';
import { recordStaffAudit } from '../audit/index.js';
import { type StaffContext } from '../auth/index.js';
import { maxBulkBeds, planBulkBeds, type BulkBedsInput } from './bulk-beds.js';
import { areaFilters } from './location-access.js';
import { found, requireActiveParent, writeSerializable } from './location-rules.js';
import { type LocationRepository } from './location.repository.js';
import { type BedFilter, type CreateBedInput, type UpdateBedInput } from './location.schemas.js';

const snapshot = (row: Bed) => ({
  wardId: row.wardId,
  roomId: row.roomId,
  code: row.code,
  displayName: row.displayName,
  bedType: row.bedType,
  status: row.status,
  active: row.active,
});

// Beds in a ward, optionally in one of its rooms, and bulk bed creation.
// Reads respect the caller's floor or ward; every change is audited in the
// same transaction. Occupancy is changed only through bed sessions.
export class BedService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly locations: LocationRepository,
  ) {}

  public list(context: StaffContext, filter: BedFilter) {
    return this.locations.listBeds(this.database, context.tenant.hospitalId, {
      wardId: filter.wardId,
      roomId: filter.roomId,
      status: filter.status,
      active: filter.active,
      wardArea: areaFilters(context, 'bed.read').ward,
    });
  }

  public async get(context: StaffContext, id: string) {
    return found(
      await this.locations.findBedInArea(
        this.database,
        context.tenant.hospitalId,
        id,
        areaFilters(context, 'bed.read').ward,
      ),
    );
  }

  public create(context: StaffContext, input: CreateBedInput, requestId: string) {
    const hospitalId = context.tenant.hospitalId;
    return writeSerializable(this.database, async (transaction) => {
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
        metadata: { after: snapshot(bed) },
      });
      return bed;
    });
  }

  public update(context: StaffContext, id: string, input: UpdateBedInput, requestId: string) {
    const hospitalId = context.tenant.hospitalId;
    return writeSerializable(this.database, async (transaction) => {
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
        metadata: { before: snapshot(before), after: snapshot(after) },
      });
      return after;
    });
  }

  public async remove(context: StaffContext, id: string, requestId: string) {
    const hospitalId = context.tenant.hospitalId;
    await writeSerializable(this.database, async (transaction) => {
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
        metadata: { before: snapshot(before) },
      });
    });
  }

  // All-or-nothing: if any generated code already exists in the ward, nothing
  // is created and the conflicting codes are reported.
  public bulkCreate(
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
    return writeSerializable(this.database, async (transaction) => {
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
}
