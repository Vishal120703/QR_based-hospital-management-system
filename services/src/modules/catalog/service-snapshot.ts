import { type Prisma, type PrismaClient, type RequestPriority } from '@prisma/client';

// Everything a request copies from the catalog when it is submitted. Requests
// store these values, so later catalog or SLA edits never change them.
export interface ServiceSnapshot {
  readonly serviceItemId: string;
  readonly serviceName: string;
  readonly categoryName: string;
  readonly priority: RequestPriority;
  readonly departmentId: string;
  readonly escalationPolicyId: string | null;
  readonly slaPolicyId: string;
  readonly slaPolicyVersionId: string;
  readonly slaPolicyVersion: number;
  readonly acceptMinutes: number;
  readonly completeMinutes: number;
  readonly acceptDueAt: Date;
  readonly completeDueAt: Date;
}

// Both deadlines count from submission (see v1-decisions, SLA definitions).
export function dueDates(
  submittedAt: Date,
  timings: { acceptMinutes: number; completeMinutes: number },
): { acceptDueAt: Date; completeDueAt: Date } {
  return {
    acceptDueAt: new Date(submittedAt.getTime() + timings.acceptMinutes * 60_000),
    completeDueAt: new Date(submittedAt.getTime() + timings.completeMinutes * 60_000),
  };
}

// Returns null when the service cannot be requested: missing in this hospital,
// or the service, its category, or its department is inactive. Call it inside
// the transaction that creates the request.
export async function snapshotService(
  client: PrismaClient | Prisma.TransactionClient,
  hospitalId: string,
  serviceItemId: string,
  submittedAt: Date,
): Promise<ServiceSnapshot | null> {
  const item = await client.serviceItem.findUnique({
    where: { hospitalId_id: { hospitalId, id: serviceItemId } },
    include: {
      category: { select: { name: true, active: true } },
      department: { select: { active: true } },
      slaPolicy: { select: { currentVersion: true } },
    },
  });
  if (!item || !item.active || !item.category.active || !item.department.active) {
    return null;
  }
  const version = await client.slaPolicyVersion.findUniqueOrThrow({
    where: {
      hospitalId_slaPolicyId_version: {
        hospitalId,
        slaPolicyId: item.slaPolicyId,
        version: item.slaPolicy.currentVersion,
      },
    },
  });
  return {
    serviceItemId: item.id,
    serviceName: item.name,
    categoryName: item.category.name,
    priority: item.priority,
    departmentId: item.departmentId,
    escalationPolicyId: item.escalationPolicyId,
    slaPolicyId: item.slaPolicyId,
    slaPolicyVersionId: version.id,
    slaPolicyVersion: version.version,
    acceptMinutes: version.acceptMinutes,
    completeMinutes: version.completeMinutes,
    ...dueDates(submittedAt, version),
  };
}
