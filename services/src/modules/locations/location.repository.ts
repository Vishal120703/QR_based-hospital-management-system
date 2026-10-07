import {
  type BedStatus,
  type BedType,
  type Prisma,
  type RoomType,
  type WardType,
} from '@prisma/client';
import { type Db } from '../../database/client.js';

const key = (hospitalId: string, id: string) => ({ hospitalId_id: { hospitalId, id } });
const activeOnly = (onlyActive: boolean) => (onlyActive ? { active: true } : {});
const activeWhere = (active: boolean | undefined) => (active === undefined ? {} : { active });

// The location hierarchy: Building → Floor → Ward (unit) → Room → Bed.
// `area` filters limit floor- and ward-level staff to their own part.
export class LocationRepository {
  // Buildings

  public listBuildings(
    db: Db,
    hospitalId: string,
    filter: { active?: boolean | undefined; area: Prisma.BuildingWhereInput },
  ) {
    return db.building.findMany({
      where: { hospitalId, ...activeWhere(filter.active), AND: [filter.area] },
      orderBy: { code: 'asc' },
    });
  }

  public findBuildingInArea(
    db: Db,
    hospitalId: string,
    id: string,
    area: Prisma.BuildingWhereInput,
  ) {
    return db.building.findFirst({ where: { hospitalId, id, AND: [area] } });
  }

  public findBuilding(db: Db, hospitalId: string, id: string) {
    return db.building.findUnique({ where: key(hospitalId, id) });
  }

  public createBuilding(db: Db, hospitalId: string, data: { code: string; name: string }) {
    return db.building.create({ data: { hospitalId, ...data } });
  }

  public updateBuilding(
    db: Db,
    hospitalId: string,
    id: string,
    data: Prisma.BuildingUncheckedUpdateInput,
  ) {
    return db.building.update({ where: key(hospitalId, id), data });
  }

  public async deleteBuilding(db: Db, hospitalId: string, id: string): Promise<void> {
    await db.building.delete({ where: key(hospitalId, id) });
  }

  public countFloorsInBuilding(
    db: Db,
    hospitalId: string,
    buildingId: string,
    onlyActive: boolean,
  ) {
    return db.floor.count({ where: { hospitalId, buildingId, ...activeOnly(onlyActive) } });
  }

  // Floors

  public listFloors(
    db: Db,
    hospitalId: string,
    filter: {
      buildingId?: string | undefined;
      active?: boolean | undefined;
      area: Prisma.FloorWhereInput;
    },
  ) {
    return db.floor.findMany({
      where: {
        hospitalId,
        ...(filter.buildingId !== undefined ? { buildingId: filter.buildingId } : {}),
        ...activeWhere(filter.active),
        AND: [filter.area],
      },
      orderBy: [{ level: { sort: 'asc', nulls: 'last' } }, { code: 'asc' }],
    });
  }

  public findFloorInArea(db: Db, hospitalId: string, id: string, area: Prisma.FloorWhereInput) {
    return db.floor.findFirst({ where: { hospitalId, id, AND: [area] } });
  }

  public findFloor(db: Db, hospitalId: string, id: string) {
    return db.floor.findUnique({ where: key(hospitalId, id) });
  }

  public createFloor(
    db: Db,
    hospitalId: string,
    data: { buildingId: string | null; code: string; name: string; level: number | null },
  ) {
    return db.floor.create({ data: { hospitalId, ...data } });
  }

  public updateFloor(
    db: Db,
    hospitalId: string,
    id: string,
    data: Prisma.FloorUncheckedUpdateInput,
  ) {
    return db.floor.update({ where: key(hospitalId, id), data });
  }

  public async deleteFloor(db: Db, hospitalId: string, id: string): Promise<void> {
    await db.floor.delete({ where: key(hospitalId, id) });
  }

  public countWardsOnFloor(db: Db, hospitalId: string, floorId: string, onlyActive: boolean) {
    return db.ward.count({ where: { hospitalId, floorId, ...activeOnly(onlyActive) } });
  }

  // Wards (units)

  public listWards(
    db: Db,
    hospitalId: string,
    filter: {
      floorId?: string | undefined;
      active?: boolean | undefined;
      area: Prisma.WardWhereInput;
    },
  ) {
    return db.ward.findMany({
      where: {
        hospitalId,
        ...(filter.floorId !== undefined ? { floorId: filter.floorId } : {}),
        ...activeWhere(filter.active),
        AND: [filter.area],
      },
      orderBy: { code: 'asc' },
    });
  }

  public findWardInArea(db: Db, hospitalId: string, id: string, area: Prisma.WardWhereInput) {
    return db.ward.findFirst({ where: { hospitalId, id, AND: [area] } });
  }

  public findWard(db: Db, hospitalId: string, id: string) {
    return db.ward.findUnique({ where: key(hospitalId, id) });
  }

  public createWard(
    db: Db,
    hospitalId: string,
    data: { floorId: string; code: string; name: string; unitType?: WardType },
  ) {
    return db.ward.create({ data: { hospitalId, ...data } });
  }

  public updateWard(db: Db, hospitalId: string, id: string, data: Prisma.WardUncheckedUpdateInput) {
    return db.ward.update({ where: key(hospitalId, id), data });
  }

  public async deleteWard(db: Db, hospitalId: string, id: string): Promise<void> {
    await db.ward.delete({ where: key(hospitalId, id) });
  }

  // Rooms

  public listRooms(
    db: Db,
    hospitalId: string,
    filter: {
      wardId?: string | undefined;
      active?: boolean | undefined;
      wardArea: Prisma.WardWhereInput;
    },
  ) {
    return db.room.findMany({
      where: {
        hospitalId,
        ...(filter.wardId !== undefined ? { wardId: filter.wardId } : {}),
        ...activeWhere(filter.active),
        ward: filter.wardArea,
      },
      orderBy: { code: 'asc' },
    });
  }

  public findRoomInArea(db: Db, hospitalId: string, id: string, wardArea: Prisma.WardWhereInput) {
    return db.room.findFirst({ where: { hospitalId, id, ward: wardArea } });
  }

  public findRoom(db: Db, hospitalId: string, id: string) {
    return db.room.findUnique({ where: key(hospitalId, id) });
  }

  // A room only counts when it belongs to this ward, not merely this hospital.
  public findRoomInWard(db: Db, hospitalId: string, wardId: string, id: string) {
    return db.room.findUnique({ where: { hospitalId_wardId_id: { hospitalId, wardId, id } } });
  }

  public createRoom(
    db: Db,
    hospitalId: string,
    data: { wardId: string; code: string; name: string; roomType?: RoomType },
  ) {
    return db.room.create({ data: { hospitalId, ...data } });
  }

  public createRooms(
    db: Db,
    hospitalId: string,
    wardId: string,
    rows: readonly { code: string; name: string; roomType: RoomType }[],
  ) {
    return db.room.createManyAndReturn({
      data: rows.map((row) => ({ hospitalId, wardId, ...row })),
    });
  }

  public updateRoom(db: Db, hospitalId: string, id: string, data: Prisma.RoomUncheckedUpdateInput) {
    return db.room.update({ where: key(hospitalId, id), data });
  }

  public async deleteRoom(db: Db, hospitalId: string, id: string): Promise<void> {
    await db.room.delete({ where: key(hospitalId, id) });
  }

  public countRoomsInWard(db: Db, hospitalId: string, wardId: string, onlyActive: boolean) {
    return db.room.count({ where: { hospitalId, wardId, ...activeOnly(onlyActive) } });
  }

  public findRoomCodes(db: Db, hospitalId: string, wardId: string, codes: readonly string[]) {
    return db.room.findMany({
      where: { hospitalId, wardId, code: { in: [...codes] } },
      select: { code: true },
    });
  }

  // Beds

  public listBeds(
    db: Db,
    hospitalId: string,
    filter: {
      wardId?: string | undefined;
      roomId?: string | undefined;
      status?: BedStatus | undefined;
      active?: boolean | undefined;
      wardArea: Prisma.WardWhereInput;
    },
  ) {
    return db.bed.findMany({
      where: {
        hospitalId,
        ...(filter.wardId !== undefined ? { wardId: filter.wardId } : {}),
        ...(filter.roomId !== undefined ? { roomId: filter.roomId } : {}),
        ...(filter.status !== undefined ? { status: filter.status } : {}),
        ...activeWhere(filter.active),
        ward: filter.wardArea,
      },
      orderBy: [{ wardId: 'asc' }, { code: 'asc' }],
    });
  }

  public findBedInArea(db: Db, hospitalId: string, id: string, wardArea: Prisma.WardWhereInput) {
    return db.bed.findFirst({ where: { hospitalId, id, ward: wardArea } });
  }

  public findBed(db: Db, hospitalId: string, id: string) {
    return db.bed.findUnique({ where: key(hospitalId, id) });
  }

  public createBed(
    db: Db,
    hospitalId: string,
    data: {
      wardId: string;
      roomId: string | null;
      code: string;
      displayName: string;
      bedType?: BedType;
    },
  ) {
    return db.bed.create({ data: { hospitalId, ...data } });
  }

  public createBeds(
    db: Db,
    hospitalId: string,
    wardId: string,
    rows: readonly { roomId: string | null; code: string; displayName: string; bedType: BedType }[],
  ) {
    return db.bed.createManyAndReturn({
      data: rows.map((row) => ({ hospitalId, wardId, ...row })),
    });
  }

  public updateBed(db: Db, hospitalId: string, id: string, data: Prisma.BedUncheckedUpdateInput) {
    return db.bed.update({ where: key(hospitalId, id), data });
  }

  public async deleteBed(db: Db, hospitalId: string, id: string): Promise<void> {
    await db.bed.delete({ where: key(hospitalId, id) });
  }

  public countBedsInWard(db: Db, hospitalId: string, wardId: string, onlyActive: boolean) {
    return db.bed.count({ where: { hospitalId, wardId, ...activeOnly(onlyActive) } });
  }

  public countBedsInRoom(db: Db, hospitalId: string, roomId: string, onlyActive: boolean) {
    return db.bed.count({ where: { hospitalId, roomId, ...activeOnly(onlyActive) } });
  }

  public findBedCodes(db: Db, hospitalId: string, wardId: string, codes: readonly string[]) {
    return db.bed.findMany({
      where: { hospitalId, wardId, code: { in: [...codes] } },
      select: { code: true },
    });
  }

  // QR codes and patient stays that would be lost if the bed were deleted.
  public async countBedHistory(db: Db, hospitalId: string, bedId: string): Promise<number> {
    const [qrCodes, sessions] = await Promise.all([
      db.bedQrCode.count({ where: { hospitalId, bedId } }),
      db.bedSession.count({ where: { hospitalId, bedId } }),
    ]);
    return qrCodes + sessions;
  }

  // Moves an active, available bed to OCCUPIED; returns how many changed (0 or 1).
  public async occupyBed(db: Db, hospitalId: string, bedId: string): Promise<number> {
    return (
      await db.bed.updateMany({
        where: { hospitalId, id: bedId, active: true, status: 'AVAILABLE' },
        data: { status: 'OCCUPIED' },
      })
    ).count;
  }

  public async releaseBed(db: Db, hospitalId: string, bedId: string): Promise<void> {
    await db.bed.updateMany({
      where: { hospitalId, id: bedId, status: 'OCCUPIED' },
      data: { status: 'AVAILABLE' },
    });
  }
}
