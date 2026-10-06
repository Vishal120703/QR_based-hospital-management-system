import { type Prisma, type PrismaClient } from '@prisma/client';
import { ConflictError, InvalidInputError, NotFoundError } from '../../common/errors/app-error.js';
import { recordStaffAudit } from '../audit/audit-log.js';
import { type StaffContext } from '../auth/auth.service.js';

const policyInclude = {
  versions: { orderBy: { version: 'desc' } },
} satisfies Prisma.SlaPolicyInclude;

type PolicyRow = Prisma.SlaPolicyGetPayload<{ include: typeof policyInclude }>;

export interface SlaTimings {
  readonly acceptMinutes: number;
  readonly completeMinutes: number;
}

// Both deadlines are measured from submission, so completion cannot come first.
export function assertValidTimings(timings: SlaTimings): void {
  if (timings.completeMinutes < timings.acceptMinutes) {
    throw new InvalidInputError('The completion time must not be shorter than the accept time.');
  }
}

function currentOf(policy: PolicyRow) {
  const current = policy.versions.find((version) => version.version === policy.currentVersion);
  if (!current) {
    throw new Error(`SLA policy ${policy.id} has no current version.`);
  }
  return current;
}

function toView(policy: PolicyRow) {
  const current = currentOf(policy);
  return {
    id: policy.id,
    name: policy.name,
    currentVersion: policy.currentVersion,
    acceptMinutes: current.acceptMinutes,
    completeMinutes: current.completeMinutes,
    createdAt: policy.createdAt,
    updatedAt: policy.updatedAt,
    versions: policy.versions.map((version) => ({
      id: version.id,
      version: version.version,
      acceptMinutes: version.acceptMinutes,
      completeMinutes: version.completeMinutes,
      createdAt: version.createdAt,
    })),
  };
}

const snapshot = (view: ReturnType<typeof toView>) => ({
  name: view.name,
  version: view.currentVersion,
  acceptMinutes: view.acceptMinutes,
  completeMinutes: view.completeMinutes,
});

export class SlaPolicyService {
  public constructor(private readonly database: PrismaClient) {}

  public async list(context: StaffContext) {
    const policies = await this.database.slaPolicy.findMany({
      where: { hospitalId: context.tenant.hospitalId },
      include: policyInclude,
      orderBy: { name: 'asc' },
    });
    return policies.map(toView);
  }

  public async get(context: StaffContext, id: string) {
    return toView(await this.require(this.database, context, id));
  }

  public create(context: StaffContext, input: { name: string } & SlaTimings, requestId: string) {
    assertValidTimings(input);
    const hospitalId = context.tenant.hospitalId;
    return this.database.$transaction(async (transaction) => {
      const policy = await transaction.slaPolicy.create({
        data: {
          hospitalId,
          name: input.name,
          versions: {
            create: {
              version: 1,
              acceptMinutes: input.acceptMinutes,
              completeMinutes: input.completeMinutes,
              createdByMembershipId: context.membershipId,
            },
          },
        },
        include: policyInclude,
      });
      const view = toView(policy);
      await recordStaffAudit(transaction, context, requestId, {
        action: 'sla.create',
        targetType: 'SlaPolicy',
        targetId: policy.id,
        metadata: { after: snapshot(view) },
      });
      return view;
    });
  }

  // Changing a timing creates a new immutable version; existing requests keep
  // the version they were created with.
  public update(
    context: StaffContext,
    id: string,
    input: {
      name?: string | undefined;
      acceptMinutes?: number | undefined;
      completeMinutes?: number | undefined;
    },
    requestId: string,
  ) {
    const hospitalId = context.tenant.hospitalId;
    return this.database.$transaction(
      async (transaction) => {
        const before = toView(await this.require(transaction, context, id));
        const timings = {
          acceptMinutes: input.acceptMinutes ?? before.acceptMinutes,
          completeMinutes: input.completeMinutes ?? before.completeMinutes,
        };
        assertValidTimings(timings);
        const timingsChanged =
          timings.acceptMinutes !== before.acceptMinutes ||
          timings.completeMinutes !== before.completeMinutes;
        const nextVersion = timingsChanged ? before.currentVersion + 1 : before.currentVersion;

        // The version guard makes concurrent edits fail instead of both
        // claiming the same next version.
        const updated = await transaction.slaPolicy.updateMany({
          where: { hospitalId, id, currentVersion: before.currentVersion },
          data: {
            currentVersion: nextVersion,
            ...(input.name !== undefined ? { name: input.name } : {}),
          },
        });
        if (updated.count !== 1) {
          throw new ConflictError('This SLA policy was changed by someone else. Please retry.');
        }
        if (timingsChanged) {
          await transaction.slaPolicyVersion.create({
            data: {
              hospitalId,
              slaPolicyId: id,
              version: nextVersion,
              ...timings,
              createdByMembershipId: context.membershipId,
            },
          });
        }
        const after = toView(await this.require(transaction, context, id));
        await recordStaffAudit(transaction, context, requestId, {
          action: 'sla.update',
          targetType: 'SlaPolicy',
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
      const before = toView(await this.require(transaction, context, id));
      const services = await transaction.serviceItem.count({
        where: { hospitalId, slaPolicyId: id },
      });
      if (services > 0) {
        throw new ConflictError('Services use this SLA policy. Move them to another policy first.');
      }
      await transaction.slaPolicyVersion.deleteMany({ where: { hospitalId, slaPolicyId: id } });
      await transaction.slaPolicy.delete({ where: { hospitalId_id: { hospitalId, id } } });
      await recordStaffAudit(transaction, context, requestId, {
        action: 'sla.delete',
        targetType: 'SlaPolicy',
        targetId: id,
        metadata: { before: snapshot(before) },
      });
    });
  }

  private async require(
    client: PrismaClient | Prisma.TransactionClient,
    context: StaffContext,
    id: string,
  ): Promise<PolicyRow> {
    const policy = await client.slaPolicy.findUnique({
      where: { hospitalId_id: { hospitalId: context.tenant.hospitalId, id } },
      include: policyInclude,
    });
    if (!policy) {
      throw new NotFoundError();
    }
    return policy;
  }
}
