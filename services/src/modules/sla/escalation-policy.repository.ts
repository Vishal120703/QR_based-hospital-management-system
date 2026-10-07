import { type EscalationTarget, type Prisma } from '@prisma/client';
import { type Db } from '../../database/client.js';

export const escalationPolicyInclude = {
  levels: {
    orderBy: { level: 'asc' },
    select: { level: true, afterMinutes: true, targetType: true, roleId: true },
  },
} satisfies Prisma.EscalationPolicyInclude;

export type EscalationPolicyRow = Prisma.EscalationPolicyGetPayload<{
  include: typeof escalationPolicyInclude;
}>;

// Escalation policies and their ordered levels.
export class EscalationPolicyRepository {
  public list(db: Db, hospitalId: string) {
    return db.escalationPolicy.findMany({
      where: { hospitalId },
      include: escalationPolicyInclude,
      orderBy: { name: 'asc' },
    });
  }

  public findById(db: Db, hospitalId: string, id: string) {
    return db.escalationPolicy.findUnique({
      where: { hospitalId_id: { hospitalId, id } },
      include: escalationPolicyInclude,
    });
  }

  public create(db: Db, hospitalId: string, name: string) {
    return db.escalationPolicy.create({ data: { hospitalId, name } });
  }

  public async rename(db: Db, hospitalId: string, id: string, name: string): Promise<void> {
    await db.escalationPolicy.update({
      where: { hospitalId_id: { hospitalId, id } },
      data: { name },
    });
  }

  public async createLevels(
    db: Db,
    hospitalId: string,
    escalationPolicyId: string,
    levels: readonly {
      afterMinutes: number;
      targetType: EscalationTarget;
      roleId: string | null;
    }[],
  ): Promise<void> {
    await db.escalationLevel.createMany({
      data: levels.map((level, index) => ({
        hospitalId,
        escalationPolicyId,
        level: index + 1,
        ...level,
      })),
    });
  }

  public async deleteLevels(db: Db, hospitalId: string, escalationPolicyId: string): Promise<void> {
    await db.escalationLevel.deleteMany({ where: { hospitalId, escalationPolicyId } });
  }

  public async delete(db: Db, hospitalId: string, id: string): Promise<void> {
    await db.escalationPolicy.delete({ where: { hospitalId_id: { hospitalId, id } } });
  }

  public countServices(db: Db, hospitalId: string, escalationPolicyId: string) {
    return db.serviceItem.count({ where: { hospitalId, escalationPolicyId } });
  }

  public countActiveRoles(db: Db, hospitalId: string, roleIds: readonly string[]) {
    return db.role.count({ where: { hospitalId, id: { in: [...roleIds] }, active: true } });
  }
}
