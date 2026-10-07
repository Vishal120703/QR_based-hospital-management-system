import { type Prisma } from '@prisma/client';
import { type Db } from '../../database/client.js';

export const slaPolicyInclude = {
  versions: { orderBy: { version: 'desc' } },
} satisfies Prisma.SlaPolicyInclude;

export type SlaPolicyRow = Prisma.SlaPolicyGetPayload<{ include: typeof slaPolicyInclude }>;

// Response-time targets. Each change to the timings is a new, immutable version.
export class SlaPolicyRepository {
  public list(db: Db, hospitalId: string) {
    return db.slaPolicy.findMany({
      where: { hospitalId },
      include: slaPolicyInclude,
      orderBy: { name: 'asc' },
    });
  }

  public findById(db: Db, hospitalId: string, id: string) {
    return db.slaPolicy.findUnique({
      where: { hospitalId_id: { hospitalId, id } },
      include: slaPolicyInclude,
    });
  }

  // A new policy with its version 1.
  public create(
    db: Db,
    hospitalId: string,
    input: {
      name: string;
      acceptMinutes: number;
      completeMinutes: number;
      createdByMembershipId: string | null;
    },
  ) {
    return db.slaPolicy.create({
      data: {
        hospitalId,
        name: input.name,
        versions: {
          create: {
            version: 1,
            acceptMinutes: input.acceptMinutes,
            completeMinutes: input.completeMinutes,
            createdByMembershipId: input.createdByMembershipId,
          },
        },
      },
      include: slaPolicyInclude,
    });
  }

  // Moves the current version on, guarded by the version the caller read;
  // returns how many changed (0 or 1).
  public async setCurrentVersion(
    db: Db,
    hospitalId: string,
    id: string,
    expectedVersion: number,
    data: { currentVersion: number; name?: string },
  ): Promise<number> {
    return (
      await db.slaPolicy.updateMany({
        where: { hospitalId, id, currentVersion: expectedVersion },
        data,
      })
    ).count;
  }

  public async createVersion(
    db: Db,
    data: {
      hospitalId: string;
      slaPolicyId: string;
      version: number;
      acceptMinutes: number;
      completeMinutes: number;
      createdByMembershipId: string;
    },
  ): Promise<void> {
    await db.slaPolicyVersion.create({ data });
  }

  public countServices(db: Db, hospitalId: string, slaPolicyId: string) {
    return db.serviceItem.count({ where: { hospitalId, slaPolicyId } });
  }

  public async delete(db: Db, hospitalId: string, id: string): Promise<void> {
    await db.slaPolicyVersion.deleteMany({ where: { hospitalId, slaPolicyId: id } });
    await db.slaPolicy.delete({ where: { hospitalId_id: { hospitalId, id } } });
  }
}
