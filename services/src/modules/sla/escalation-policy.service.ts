import { type Prisma, type PrismaClient } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../common/errors/app-error.js';
import { recordStaffAudit } from '../audit/audit-log.js';
import { type StaffContext } from '../auth/auth.service.js';

export type EscalationLevelInput =
  | { readonly afterMinutes: number; readonly targetType: 'ASSIGNEE' }
  | { readonly afterMinutes: number; readonly targetType: 'ROLE'; readonly roleId: string };

const policyInclude = {
  levels: {
    orderBy: { level: 'asc' },
    select: { level: true, afterMinutes: true, targetType: true, roleId: true },
  },
} satisfies Prisma.EscalationPolicyInclude;

type PolicyRow = Prisma.EscalationPolicyGetPayload<{ include: typeof policyInclude }>;

const snapshot = (policy: PolicyRow) => ({ name: policy.name, levels: policy.levels });

// Levels are configuration only; the SLA worker phase executes them.
export class EscalationPolicyService {
  public constructor(private readonly database: PrismaClient) {}

  public list(context: StaffContext) {
    return this.database.escalationPolicy.findMany({
      where: { hospitalId: context.tenant.hospitalId },
      include: policyInclude,
      orderBy: { name: 'asc' },
    });
  }

  public get(context: StaffContext, id: string) {
    return this.require(this.database, context, id);
  }

  public create(
    context: StaffContext,
    input: { name: string; levels: readonly EscalationLevelInput[] },
    requestId: string,
  ) {
    const hospitalId = context.tenant.hospitalId;
    return this.database.$transaction(async (transaction) => {
      await this.requireRoles(transaction, hospitalId, input.levels);
      const created = await transaction.escalationPolicy.create({
        data: { hospitalId, name: input.name },
      });
      await this.writeLevels(transaction, hospitalId, created.id, input.levels);
      const policy = await this.require(transaction, context, created.id);
      await recordStaffAudit(transaction, context, requestId, {
        action: 'escalation.create',
        targetType: 'EscalationPolicy',
        targetId: policy.id,
        metadata: { after: snapshot(policy) },
      });
      return policy;
    });
  }

  // `levels`, when given, replaces the whole ordered list.
  public update(
    context: StaffContext,
    id: string,
    input: { name?: string | undefined; levels?: readonly EscalationLevelInput[] | undefined },
    requestId: string,
  ) {
    const hospitalId = context.tenant.hospitalId;
    return this.database.$transaction(
      async (transaction) => {
        const before = await this.require(transaction, context, id);
        if (input.name !== undefined) {
          await transaction.escalationPolicy.update({
            where: { hospitalId_id: { hospitalId, id } },
            data: { name: input.name },
          });
        }
        if (input.levels !== undefined) {
          await this.requireRoles(transaction, hospitalId, input.levels);
          await transaction.escalationLevel.deleteMany({
            where: { hospitalId, escalationPolicyId: id },
          });
          await this.writeLevels(transaction, hospitalId, id, input.levels);
        }
        const after = await this.require(transaction, context, id);
        await recordStaffAudit(transaction, context, requestId, {
          action: 'escalation.update',
          targetType: 'EscalationPolicy',
          targetId: id,
          metadata: { before: snapshot(before), after: snapshot(after) },
        });
        return after;
      },
      { isolationLevel: 'Serializable' },
    );
  }

  public async delete(context: StaffContext, id: string, requestId: string): Promise<void> {
    const hospitalId = context.tenant.hospitalId;
    await this.database.$transaction(async (transaction) => {
      const before = await this.require(transaction, context, id);
      const services = await transaction.serviceItem.count({
        where: { hospitalId, escalationPolicyId: id },
      });
      if (services > 0) {
        throw new ConflictError('Services use this escalation policy. Remove it from them first.');
      }
      await transaction.escalationLevel.deleteMany({
        where: { hospitalId, escalationPolicyId: id },
      });
      await transaction.escalationPolicy.delete({ where: { hospitalId_id: { hospitalId, id } } });
      await recordStaffAudit(transaction, context, requestId, {
        action: 'escalation.delete',
        targetType: 'EscalationPolicy',
        targetId: id,
        metadata: { before: snapshot(before) },
      });
    });
  }

  private async writeLevels(
    transaction: Prisma.TransactionClient,
    hospitalId: string,
    escalationPolicyId: string,
    levels: readonly EscalationLevelInput[],
  ): Promise<void> {
    await transaction.escalationLevel.createMany({
      data: levels.map((level, index) => ({
        hospitalId,
        escalationPolicyId,
        level: index + 1,
        afterMinutes: level.afterMinutes,
        targetType: level.targetType,
        roleId: level.targetType === 'ROLE' ? level.roleId : null,
      })),
    });
  }

  private async requireRoles(
    transaction: Prisma.TransactionClient,
    hospitalId: string,
    levels: readonly EscalationLevelInput[],
  ): Promise<void> {
    const roleIds = [
      ...new Set(levels.flatMap((level) => (level.targetType === 'ROLE' ? [level.roleId] : []))),
    ];
    if (roleIds.length === 0) return;
    const found = await transaction.role.count({
      where: { hospitalId, id: { in: roleIds }, active: true },
    });
    if (found !== roleIds.length) {
      throw new NotFoundError('A referenced role was not found or is inactive.');
    }
  }

  private async require(
    client: PrismaClient | Prisma.TransactionClient,
    context: StaffContext,
    id: string,
  ): Promise<PolicyRow> {
    const policy = await client.escalationPolicy.findUnique({
      where: { hospitalId_id: { hospitalId: context.tenant.hospitalId, id } },
      include: policyInclude,
    });
    if (!policy) {
      throw new NotFoundError();
    }
    return policy;
  }
}
