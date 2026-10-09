import { type Prisma, type PrismaClient } from '@prisma/client';
import { type StaffContext } from '../auth/index.js';
import { describeAuditEntry, type NamedKind, referencesIn, targetKinds } from './audit-details.js';
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
  // Changes made by one person (who).
  readonly membershipId?: string | undefined;
  // Everything that happened to one item (what).
  readonly targetId?: string | undefined;
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

// The hospital's audit log in plain words: who did what, to what, and when,
// with the fields that changed (before → after) and names instead of ids.
export class AuditService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly audit = repository,
  ) {}

  // Newest first. Pass the last entry's id as `before` for the next page.
  // The first page also lists everyone who has made changes, for filtering.
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
      ...(filter.targetId ? { targetId: filter.targetId } : {}),
    };
    const rows = await this.audit.findPage(this.database, where, filter.limit + 1, filter.before);
    const page = rows.slice(0, filter.limit);

    // Every person and thing the page mentions, looked up in one go.
    const wanted = new Map<NamedKind, Set<string>>();
    const want = (kind: NamedKind | undefined, id: string | null) => {
      if (!kind || !id) return;
      const ids = wanted.get(kind) ?? new Set<string>();
      ids.add(id);
      wanted.set(kind, ids);
    };
    for (const row of page) {
      want('membership', row.actorMembershipId);
      want('user', row.actorPlatformUserId);
      want(targetKinds[row.targetType], row.targetId);
      for (const reference of referencesIn(row.metadata)) want(reference.kind, reference.id);
    }
    const [names, people] = await Promise.all([
      this.audit.findNames(this.database, hospitalId, wanted),
      filter.before ? Promise.resolve(undefined) : this.audit.findActors(this.database, hospitalId),
    ]);
    const nameOf = (kind: NamedKind, id: string) => names.get(`${kind}:${id}`) ?? null;

    return {
      entries: page.map((row) => {
        const kind = targetKinds[row.targetType];
        return {
          id: row.id,
          createdAt: row.createdAt,
          action: row.action,
          actorType: row.actorType,
          // Set for staff, so the log can show everything one person changed.
          actorId: row.actorMembershipId,
          actorName:
            row.actorType === 'SYSTEM'
              ? 'System'
              : row.actorType === 'PLATFORM'
                ? `${(row.actorPlatformUserId && nameOf('user', row.actorPlatformUserId)) || 'Platform admin'} (CARE QR platform)`
                : (row.actorMembershipId && nameOf('membership', row.actorMembershipId)) ||
                  'Former staff',
          targetType: row.targetType,
          targetId: row.targetId,
          targetName: (kind && nameOf(kind, row.targetId)) ?? nameFromMetadata(row.metadata),
          ...describeAuditEntry(row.action, row.metadata, nameOf),
        };
      }),
      nextBefore: rows.length > filter.limit ? (page.at(-1)?.id ?? null) : null,
      ...(people ? { people } : {}),
    };
  }
}
