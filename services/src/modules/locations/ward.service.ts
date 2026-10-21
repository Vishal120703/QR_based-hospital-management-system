import { type PrismaClient, type Ward } from '@prisma/client';
import { recordStaffAudit } from '../audit/index.js';
import { type StaffContext } from '../auth/index.js';
import { areaFilters } from './location-access.js';
import {
  found,
  locationChanges,
  requireActiveParent,
  requireNoActiveChildren,
  requireNoChildren,
  requireNoRoleScopes,
  writeSerializable,
} from './location-rules.js';
import { type LocationRepository } from './location.repository.js';
import { type CreateWardInput, type UpdateWardInput, type WardFilter } from './location.schemas.js';

const snapshot = (row: Ward) => ({
  floorId: row.floorId,
  code: row.code,
  name: row.name,
  unitType: row.unitType,
  active: row.active,
});

// Wards (care units) on a floor. Reads respect the caller's floor or ward;
// every change is audited in the same transaction.
export class WardService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly locations: LocationRepository,
  ) {}

  public list(context: StaffContext, filter: WardFilter) {
    return this.locations.listWards(this.database, context.tenant.hospitalId, {
      floorId: filter.floorId,
      active: filter.active,
      area: areaFilters(context, 'location.read').ward,
    });
  }

  public async get(context: StaffContext, id: string) {
    return found(
      await this.locations.findWardInArea(
        this.database,
        context.tenant.hospitalId,
        id,
        areaFilters(context, 'location.read').ward,
      ),
    );
  }

  public create(context: StaffContext, input: CreateWardInput, requestId: string) {
    const hospitalId = context.tenant.hospitalId;
    return writeSerializable(this.database, async (transaction) => {
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
        metadata: { after: snapshot(ward) },
      });
      return ward;
    });
  }

  public update(context: StaffContext, id: string, input: UpdateWardInput, requestId: string) {
    const hospitalId = context.tenant.hospitalId;
    return writeSerializable(this.database, async (transaction) => {
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
        metadata: { before: snapshot(before), after: snapshot(after) },
      });
      return after;
    });
  }

  public async remove(context: StaffContext, id: string, requestId: string) {
    const hospitalId = context.tenant.hospitalId;
    await writeSerializable(this.database, async (transaction) => {
      const before = found(await this.locations.findWard(transaction, hospitalId, id));
      const rooms = await this.locations.countRoomsInWard(transaction, hospitalId, id, false);
      const beds = await this.locations.countBedsInWard(transaction, hospitalId, id, false);
      requireNoChildren(rooms + beds, 'ward');
      requireNoRoleScopes(
        await this.locations.countRoleScopes(transaction, hospitalId, 'WARD', id),
        'ward',
      );
      await this.locations.deleteWard(transaction, hospitalId, id);
      await recordStaffAudit(transaction, context, requestId, {
        action: 'ward.delete',
        targetType: 'Ward',
        targetId: id,
        metadata: { before: snapshot(before) },
      });
    });
  }
}
