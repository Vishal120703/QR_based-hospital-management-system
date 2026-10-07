import { type Prisma, type PrismaClient } from '@prisma/client';
import { type StaffContext } from '../auth/index.js';
import { AuditRepository } from './audit.repository.js';

const repository = new AuditRepository();

export interface StaffAuditEntry {
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly metadata: Prisma.InputJsonObject;
}

// Records a staff member's change. Must run inside the same transaction as
// the change it records, so one never exists without the other.
export function recordStaffAudit(
  transaction: Prisma.TransactionClient,
  context: StaffContext,
  requestId: string,
  entry: StaffAuditEntry,
): Promise<void> {
  return repository.create(transaction, {
    hospitalId: context.tenant.hospitalId,
    actorType: 'STAFF',
    actorMembershipId: context.membershipId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    metadata: entry.metadata,
    requestId,
  });
}

// Records a super admin's change, in the audit log of the hospital it
// changed. Must run inside the transaction of the change.
export function recordPlatformAudit(
  transaction: Prisma.TransactionClient,
  entry: {
    readonly platformUserId: string;
    readonly hospitalId: string;
    readonly requestId: string;
    readonly action: string;
    readonly metadata: Prisma.InputJsonObject;
  },
): Promise<void> {
  return repository.create(transaction, {
    hospitalId: entry.hospitalId,
    actorType: 'PLATFORM',
    actorPlatformUserId: entry.platformUserId,
    action: entry.action,
    targetType: 'Hospital',
    targetId: entry.hospitalId,
    metadata: entry.metadata,
    requestId: entry.requestId,
  });
}

// Records a change made by the system itself (for example creating a
// hospital), inside the transaction of the change.
export function recordSystemAudit(
  transaction: Prisma.TransactionClient,
  entry: {
    readonly hospitalId: string;
    readonly action: string;
    readonly targetType: string;
    readonly targetId: string;
    readonly metadata: Prisma.InputJsonObject;
  },
): Promise<void> {
  return repository.create(transaction, { ...entry, actorType: 'SYSTEM' });
}

export interface AuditFilter {
  readonly from?: Date | undefined;
  readonly to?: Date | undefined;
  // An action family such as "staff", "role", "request", or "qr".
  readonly category?: string | undefined;
  readonly membershipId?: string | undefined;
  readonly before?: string | undefined;
  readonly limit: number;
}

// A deleted item can no longer be looked up, but its name is in the entry.
function nameFromMetadata(metadata: Prisma.JsonValue): string | null {
  const record = (value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  const top = record(metadata);
  for (const source of [record(top?.after), record(top?.before), top]) {
    for (const key of ['name', 'displayName']) {
      const value = source?.[key];
      if (typeof value === 'string' && value) return value;
    }
  }
  return null;
}

// The hospital's audit log in plain words: who did what, to what, and when.
export class AuditService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly audit = repository,
  ) {}

  // Newest first. Pass the last entry's id as `before` for the next page.
  public async list(context: StaffContext, filter: AuditFilter) {
    const hospitalId = context.tenant.hospitalId;
    const where: Prisma.AuditLogWhereInput = {
      hospitalId,
      ...(filter.from || filter.to
        ? {
            createdAt: {
              ...(filter.from ? { gte: filter.from } : {}),
              ...(filter.to ? { lt: filter.to } : {}),
            },
          }
        : {}),
      ...(filter.category ? { action: { startsWith: `${filter.category}.` } } : {}),
      ...(filter.membershipId ? { actorMembershipId: filter.membershipId } : {}),
    };
    const rows = await this.audit.findPage(this.database, where, filter.limit + 1, filter.before);
    const page = rows.slice(0, filter.limit);

    const memberIds = [
      ...new Set(page.flatMap((row) => (row.actorMembershipId ? [row.actorMembershipId] : []))),
    ];
    const platformIds = [
      ...new Set(page.flatMap((row) => (row.actorPlatformUserId ? [row.actorPlatformUserId] : []))),
    ];
    const [members, operators, targets] = await Promise.all([
      this.audit.findMemberNames(this.database, hospitalId, memberIds),
      this.audit.findUserNames(this.database, platformIds),
      this.audit.findTargetNames(this.database, hospitalId, page),
    ]);
    return {
      entries: page.map((row) => ({
        id: row.id,
        createdAt: row.createdAt,
        action: row.action,
        actorType: row.actorType,
        actorName:
          row.actorType === 'SYSTEM'
            ? 'System'
            : row.actorType === 'PLATFORM'
              ? `${operators.find((user) => user.id === row.actorPlatformUserId)?.displayName ?? 'Platform admin'} (CARE QR platform)`
              : (members.find((member) => member.id === row.actorMembershipId)?.user.displayName ??
                'Former staff'),
        targetType: row.targetType,
        targetId: row.targetId,
        targetName: targets.get(row.targetId) ?? nameFromMetadata(row.metadata),
        metadata: row.metadata,
      })),
      nextBefore: rows.length > filter.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }
}
