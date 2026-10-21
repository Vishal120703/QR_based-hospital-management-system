import { type Building, type PrismaClient } from '@prisma/client';
import { recordStaffAudit } from '../audit/index.js';
import { type StaffContext } from '../auth/index.js';
import { areaFilters } from './location-access.js';
import {
  found,
  locationChanges,
  requireNoActiveChildren,
  requireNoChildren,
  writeSerializable,
} from './location-rules.js';
import { type LocationRepository } from './location.repository.js';
import {
  type BuildingFilter,
  type CreateBuildingInput,
  type UpdateBuildingInput,
} from './location.schemas.js';

const snapshot = (row: Building) => ({ code: row.code, name: row.name, active: row.active });

// Buildings, the top of the hierarchy. Reads respect the caller's floor or
// ward; every change is audited in the same transaction.
export class BuildingService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly locations: LocationRepository,
  ) {}

  public list(context: StaffContext, filter: BuildingFilter) {
    return this.locations.listBuildings(this.database, context.tenant.hospitalId, {
      active: filter.active,
      area: areaFilters(context, 'location.read').building,
    });
  }

  public async get(context: StaffContext, id: string) {
    return found(
      await this.locations.findBuildingInArea(
        this.database,
        context.tenant.hospitalId,
        id,
        areaFilters(context, 'location.read').building,
      ),
    );
  }

  public create(context: StaffContext, input: CreateBuildingInput, requestId: string) {
    return writeSerializable(this.database, async (transaction) => {
      const building = await this.locations.createBuilding(transaction, context.tenant.hospitalId, {
        code: input.code,
        name: input.name,
      });
      await recordStaffAudit(transaction, context, requestId, {
        action: 'building.create',
        targetType: 'Building',
        targetId: building.id,
        metadata: { after: snapshot(building) },
      });
      return building;
    });
  }

  public update(context: StaffContext, id: string, input: UpdateBuildingInput, requestId: string) {
    const hospitalId = context.tenant.hospitalId;
    return writeSerializable(this.database, async (transaction) => {
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
        metadata: { before: snapshot(before), after: snapshot(after) },
      });
      return after;
    });
  }

  public async remove(context: StaffContext, id: string, requestId: string) {
    const hospitalId = context.tenant.hospitalId;
    await writeSerializable(this.database, async (transaction) => {
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
        metadata: { before: snapshot(before) },
      });
    });
  }
}
