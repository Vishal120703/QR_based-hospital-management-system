import { type Prisma, type PrismaClient } from '@prisma/client';
import { type Db } from '../../database/client.js';
import { ConflictError, NotFoundError } from '../../common/errors/app-error.js';
import { recordStaffAudit } from '../audit/index.js';
import { type StaffContext } from '../auth/index.js';
import {
  EscalationPolicyRepository,
  type EscalationPolicyRow as PolicyRow,
} from './escalation-policy.repository.js';
import {
  type CreateEscalationPolicyInput,
  type EscalationLevelInput,
  type UpdateEscalationPolicyInput,
} from './sla.schemas.js';

const snapshot = (policy: PolicyRow) => ({ name: policy.name, levels: policy.levels });

// Levels are configuration only; the SLA worker phase executes them.
export class EscalationPolicyService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly policies = new EscalationPolicyRepository(),
  ) {}

  public list(context: StaffContext) {
    return this.policies.list(this.database, context.tenant.hospitalId);
  }

  public get(context: StaffContext, id: string) {
    return this.require(this.database, context, id);
  }

  public create(context: StaffContext, input: CreateEscalationPolicyInput, requestId: string) {
    const hospitalId = context.tenant.hospitalId;
    return this.database.$transaction(async (transaction) => {
      await this.requireRoles(transaction, hospitalId, input.levels);
      const created = await this.policies.create(transaction, hospitalId, input.name);
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
    input: UpdateEscalationPolicyInput,
    requestId: string,
  ) {
    const hospitalId = context.tenant.hospitalId;
    return this.database.$transaction(
      async (transaction) => {
        const before = await this.require(transaction, context, id);
        if (input.name !== undefined) {
          await this.policies.rename(transaction, hospitalId, id, input.name);
        }
        if (input.levels !== undefined) {
          await this.requireRoles(transaction, hospitalId, input.levels);
          await this.policies.deleteLevels(transaction, hospitalId, id);
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

  public async remove(context: StaffContext, id: string, requestId: string): Promise<void> {
    const hospitalId = context.tenant.hospitalId;
    await this.database.$transaction(async (transaction) => {
      const before = await this.require(transaction, context, id);
      if ((await this.policies.countServices(transaction, hospitalId, id)) > 0) {
        throw new ConflictError('Services use this escalation policy. Remove it from them first.');
      }
      await this.policies.deleteLevels(transaction, hospitalId, id);
      await this.policies.delete(transaction, hospitalId, id);
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
    await this.policies.createLevels(
      transaction,
      hospitalId,
      escalationPolicyId,
      levels.map((level) => ({
        afterMinutes: level.afterMinutes,
        targetType: level.targetType,
        roleId: level.targetType === 'ROLE' ? level.roleId : null,
      })),
    );
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
    const found = await this.policies.countActiveRoles(transaction, hospitalId, roleIds);
    if (found !== roleIds.length) {
      throw new NotFoundError('A referenced role was not found or is inactive.');
    }
  }

  private async require(db: Db, context: StaffContext, id: string): Promise<PolicyRow> {
    const policy = await this.policies.findById(db, context.tenant.hospitalId, id);
    if (!policy) {
      throw new NotFoundError();
    }
    return policy;
  }
}
