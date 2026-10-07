import { type Prisma, type PrismaClient } from '@prisma/client';
import { type Db } from '../../database/client.js';
import { ConflictError, InvalidInputError, NotFoundError } from '../../common/errors/app-error.js';
import { recordStaffAudit } from '../audit/index.js';
import { type StaffContext } from '../auth/index.js';
import { SlaPolicyRepository, type SlaPolicyRow as PolicyRow } from './sla-policy.repository.js';
import { type CreateSlaPolicyInput, type UpdateSlaPolicyInput } from './sla.schemas.js';

const repository = new SlaPolicyRepository();

export interface SlaTimings {
  readonly acceptMinutes: number;
  readonly completeMinutes: number;
}

// Both deadlines are measured from submission, so completion cannot come first.
function assertValidTimings(timings: SlaTimings): void {
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

// Creates a response-time target with its version 1, inside the caller's
// transaction (for a new hospital's examples).
export async function createSlaPolicy(
  transaction: Prisma.TransactionClient,
  hospitalId: string,
  input: { name: string } & SlaTimings,
): Promise<string> {
  assertValidTimings(input);
  const policy = await repository.create(transaction, hospitalId, {
    ...input,
    createdByMembershipId: null,
  });
  return policy.id;
}

export class SlaPolicyService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly policies = repository,
  ) {}

  public async list(context: StaffContext) {
    return (await this.policies.list(this.database, context.tenant.hospitalId)).map(toView);
  }

  public async get(context: StaffContext, id: string) {
    return toView(await this.require(this.database, context, id));
  }

  public create(context: StaffContext, input: CreateSlaPolicyInput, requestId: string) {
    assertValidTimings(input);
    const hospitalId = context.tenant.hospitalId;
    return this.database.$transaction(async (transaction) => {
      const policy = await this.policies.create(transaction, hospitalId, {
        ...input,
        createdByMembershipId: context.membershipId,
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
  public update(context: StaffContext, id: string, input: UpdateSlaPolicyInput, requestId: string) {
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
        const updated = await this.policies.setCurrentVersion(
          transaction,
          hospitalId,
          id,
          before.currentVersion,
          {
            currentVersion: nextVersion,
            ...(input.name !== undefined ? { name: input.name } : {}),
          },
        );
        if (updated !== 1) {
          throw new ConflictError('This SLA policy was changed by someone else. Please retry.');
        }
        if (timingsChanged) {
          await this.policies.createVersion(transaction, {
            hospitalId,
            slaPolicyId: id,
            version: nextVersion,
            ...timings,
            createdByMembershipId: context.membershipId,
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

  public async remove(context: StaffContext, id: string, requestId: string): Promise<void> {
    const hospitalId = context.tenant.hospitalId;
    await this.database.$transaction(async (transaction) => {
      const before = toView(await this.require(transaction, context, id));
      if ((await this.policies.countServices(transaction, hospitalId, id)) > 0) {
        throw new ConflictError('Services use this SLA policy. Move them to another policy first.');
      }
      await this.policies.delete(transaction, hospitalId, id);
      await recordStaffAudit(transaction, context, requestId, {
        action: 'sla.delete',
        targetType: 'SlaPolicy',
        targetId: id,
        metadata: { before: snapshot(before) },
      });
    });
  }

  private async require(db: Db, context: StaffContext, id: string): Promise<PolicyRow> {
    const policy = await this.policies.findById(db, context.tenant.hospitalId, id);
    if (!policy) {
      throw new NotFoundError();
    }
    return policy;
  }
}
