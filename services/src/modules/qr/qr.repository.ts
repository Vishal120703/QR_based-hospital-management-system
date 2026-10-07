import { type Prisma } from '@prisma/client';
import { type Db } from '../../database/client.js';
import { hospitalAccessSelect } from '../hospitals/index.js';

export type QrBatchScope =
  | { readonly kind: 'HOSPITAL' }
  | { readonly kind: 'BUILDING' | 'FLOOR' | 'WARD' | 'ROOM'; readonly id: string }
  | { readonly kind: 'BEDS'; readonly bedIds: readonly string[] };

function scopeWhere(scope: QrBatchScope): Prisma.BedWhereInput {
  switch (scope.kind) {
    case 'HOSPITAL':
      return {};
    case 'BUILDING':
      return { ward: { floor: { buildingId: scope.id } } };
    case 'FLOOR':
      return { ward: { floorId: scope.id } };
    case 'WARD':
      return { wardId: scope.id };
    case 'ROOM':
      return { roomId: scope.id };
    case 'BEDS':
      return { id: { in: [...scope.bedIds] } };
  }
}

// One QR code per bed. Only the hash of its token is stored; every change is
// guarded by the code's status and version, so concurrent changes cannot both win.
export class QrRepository {
  public list(
    db: Db,
    hospitalId: string,
    filter: { bedId?: string | undefined; wardArea: Prisma.WardWhereInput },
  ) {
    return db.bedQrCode.findMany({
      where: {
        hospitalId,
        ...(filter.bedId !== undefined ? { bedId: filter.bedId } : {}),
        bed: { ward: filter.wardArea },
      },
      orderBy: { issuedAt: 'desc' },
    });
  }

  public findBed(db: Db, hospitalId: string, bedId: string) {
    return db.bed.findUnique({ where: { hospitalId_id: { hospitalId, id: bedId } } });
  }

  public findForBed(db: Db, hospitalId: string, bedId: string) {
    return db.bedQrCode.findUnique({ where: { hospitalId_bedId: { hospitalId, bedId } } });
  }

  public async findById(db: Db, id: string) {
    return db.bedQrCode.findUniqueOrThrow({ where: { id } });
  }

  public create(db: Db, data: { hospitalId: string; bedId: string; tokenHash: string }) {
    return db.bedQrCode.create({ data });
  }

  // Re-issues a revoked code with a new token; returns how many changed (0 or 1).
  public async reissue(
    db: Db,
    existing: { id: string; version: number },
    tokenHash: string,
  ): Promise<number> {
    return (
      await db.bedQrCode.updateMany({
        where: { id: existing.id, status: 'REVOKED', version: existing.version },
        data: {
          tokenHash,
          status: 'ACTIVE',
          version: existing.version + 1,
          issuedAt: new Date(),
          revokedAt: null,
        },
      })
    ).count;
  }

  // Replaces an active code's token; returns how many changed (0 or 1).
  public async rotate(
    db: Db,
    existing: { id: string; version: number },
    tokenHash: string,
  ): Promise<number> {
    return (
      await db.bedQrCode.updateMany({
        where: { id: existing.id, status: 'ACTIVE', version: existing.version },
        data: {
          tokenHash,
          version: existing.version + 1,
          issuedAt: new Date(),
          rotatedAt: new Date(),
        },
      })
    ).count;
  }

  // Disables an active code; returns how many changed (0 or 1).
  public async revoke(db: Db, existing: { id: string; version: number }): Promise<number> {
    return (
      await db.bedQrCode.updateMany({
        where: { id: existing.id, status: 'ACTIVE', version: existing.version },
        data: { status: 'REVOKED', revokedAt: new Date() },
      })
    ).count;
  }

  // Beds in an area with their current code and location, for printing labels.
  public findBedsForLabels(db: Db, hospitalId: string, scope: QrBatchScope) {
    return db.bed.findMany({
      where: { hospitalId, ...scopeWhere(scope) },
      include: {
        qrCode: true,
        room: { select: { code: true, name: true } },
        ward: {
          select: {
            code: true,
            name: true,
            floor: {
              select: {
                code: true,
                name: true,
                level: true,
                building: { select: { code: true, name: true } },
              },
            },
          },
        },
      },
    });
  }

  // Whether the building, floor, ward, room, or every listed bed exists here.
  public async scopeExists(db: Db, hospitalId: string, scope: QrBatchScope): Promise<boolean> {
    const key = (id: string) => ({ where: { hospitalId_id: { hospitalId, id } } });
    switch (scope.kind) {
      case 'HOSPITAL':
        return true;
      case 'BUILDING':
        return Boolean(await db.building.findUnique(key(scope.id)));
      case 'FLOOR':
        return Boolean(await db.floor.findUnique(key(scope.id)));
      case 'WARD':
        return Boolean(await db.ward.findUnique(key(scope.id)));
      case 'ROOM':
        return Boolean(await db.room.findUnique(key(scope.id)));
      case 'BEDS': {
        const ids = [...new Set(scope.bedIds)];
        return (await db.bed.count({ where: { hospitalId, id: { in: ids } } })) === ids.length;
      }
    }
  }

  // Credential resolution is the pre-tenant lookup. The row lock makes
  // rotation and revocation wait, so neither can miss a guest session issued
  // from the old token between checking it and committing.
  public async lockActiveByTokenHash(db: Db, tokenHash: string) {
    const rows = await db.$queryRaw<Array<{ id: string; hospitalId: string }>>`
      SELECT "id", "hospitalId" FROM "BedQrCode"
      WHERE "tokenHash" = ${tokenHash} AND "status" = 'ACTIVE'
      FOR UPDATE
    `;
    return rows[0] ?? null;
  }

  public findForScan(db: Db, hospitalId: string, id: string) {
    return db.bedQrCode.findUnique({
      where: { hospitalId_id: { hospitalId, id } },
      include: {
        hospital: { select: hospitalAccessSelect },
        bed: { select: { active: true } },
      },
    });
  }
}
