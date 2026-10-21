import { type Floor, type PrismaClient } from '@prisma/client';
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
import {
  type CreateFloorInput,
  type FloorFilter,
  type UpdateFloorInput,
} from './location.schemas.js';

const snapshot = (row: Floor) => ({
  buildingId: row.buildingId,
  code: row.code,
  name: row.name,
  level: row.level,
  active: row.active,
});

// Floors, optionally inside a building. Reads respect the caller's floor or
// ward; every change is audited in the same transaction.
export class FloorService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly locations: LocationRepository,
  ) {}

  public list(context: StaffContext, filter: FloorFilter) {
    return this.locations.listFloors(this.database, context.tenant.hospitalId, {
      buildingId: filter.buildingId,
      active: filter.active,
      area: areaFilters(context, 'location.read').floor,
    });
  }

  public async get(context: StaffContext, id: string) {
    return found(
      await this.locations.findFloorInArea(
        this.database,
        context.tenant.hospitalId,
        id,
        areaFilters(context, 'location.read').floor,
      ),
    );
  }

  public create(context: StaffContext, input: CreateFloorInput, requestId: string) {
    const hospitalId = context.tenant.hospitalId;
    return writeSerializable(this.database, async (transaction) => {
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
        metadata: { after: snapshot(floor) },
      });
      return floor;
    });
  }

  public update(context: StaffContext, id: string, input: UpdateFloorInput, requestId: string) {
    const hospitalId = context.tenant.hospitalId;
    return writeSerializable(this.database, async (transaction) => {
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
        metadata: { before: snapshot(before), after: snapshot(after) },
      });
      return after;
    });
  }

  public async remove(context: StaffContext, id: string, requestId: string) {
    const hospitalId = context.tenant.hospitalId;
    await writeSerializable(this.database, async (transaction) => {
      const before = found(await this.locations.findFloor(transaction, hospitalId, id));
      requireNoChildren(
        await this.locations.countWardsOnFloor(transaction, hospitalId, id, false),
        'floor',
      );
      requireNoRoleScopes(
        await this.locations.countRoleScopes(transaction, hospitalId, 'FLOOR', id),
        'floor',
      );
      await this.locations.deleteFloor(transaction, hospitalId, id);
      await recordStaffAudit(transaction, context, requestId, {
        action: 'floor.delete',
        targetType: 'Floor',
        targetId: id,
        metadata: { before: snapshot(before) },
      });
    });
  }
}
