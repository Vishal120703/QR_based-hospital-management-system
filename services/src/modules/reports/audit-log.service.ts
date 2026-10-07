import { type Prisma, type PrismaClient } from '@prisma/client';
import { type StaffContext } from '../auth/auth.service.js';

export interface AuditFilter {
  readonly from?: Date | undefined;
  readonly to?: Date | undefined;
  // An action family such as "staff", "role", "request", or "qr".
  readonly category?: string | undefined;
  readonly membershipId?: string | undefined;
  readonly before?: string | undefined;
  readonly limit: number;
}

// Plain names for the things audit entries point at, so the log reads
// "Role: Floor Manager" rather than an ID.
async function targetNames(
  database: PrismaClient,
  hospitalId: string,
  entries: readonly { targetType: string; targetId: string }[],
): Promise<Map<string, string>> {
  const ids = (type: string) => [
    ...new Set(entries.filter((entry) => entry.targetType === type).map((entry) => entry.targetId)),
  ];
  const named = (rows: { id: string; name: string }[]) =>
    rows.map((row) => [row.id, row.name] as const);
  const lookups = await Promise.all([
    database.hospitalMembership
      .findMany({
        where: { hospitalId, id: { in: ids('HospitalMembership') } },
        select: { id: true, user: { select: { displayName: true } } },
      })
      .then((rows) => rows.map((row) => [row.id, row.user.displayName] as const)),
    database.role
      .findMany({
        where: { hospitalId, id: { in: ids('Role') } },
        select: { id: true, name: true },
      })
      .then(named),
    database.bed
      .findMany({
        where: { hospitalId, id: { in: ids('Bed') } },
        select: { id: true, displayName: true },
      })
      .then((rows) => rows.map((row) => [row.id, row.displayName] as const)),
    database.ward
      .findMany({
        where: { hospitalId, id: { in: ids('Ward') } },
        select: { id: true, name: true },
      })
      .then(named),
    database.floor
      .findMany({
        where: { hospitalId, id: { in: ids('Floor') } },
        select: { id: true, name: true },
      })
      .then(named),
    database.building
      .findMany({
        where: { hospitalId, id: { in: ids('Building') } },
        select: { id: true, name: true },
      })
      .then(named),
    database.room
      .findMany({
        where: { hospitalId, id: { in: ids('Room') } },
        select: { id: true, name: true },
      })
      .then(named),
    database.department
      .findMany({
        where: { hospitalId, id: { in: ids('Department') } },
        select: { id: true, name: true },
      })
      .then(named),
    database.serviceItem
      .findMany({
        where: { hospitalId, id: { in: ids('ServiceItem') } },
        select: { id: true, name: true },
      })
      .then(named),
    database.serviceRequest
      .findMany({
        where: { hospitalId, id: { in: ids('ServiceRequest') } },
        select: { id: true, publicId: true, serviceName: true },
      })
      .then((rows) => rows.map((row) => [row.id, `${row.serviceName} (${row.publicId})`] as const)),
    database.bedSession
      .findMany({
        where: { hospitalId, id: { in: ids('BedSession') } },
        select: { id: true, bed: { select: { displayName: true } } },
      })
      .then((rows) => rows.map((row) => [row.id, row.bed.displayName] as const)),
    database.bedQrCode
      .findMany({
        where: { hospitalId, id: { in: ids('BedQrCode') } },
        select: { id: true, bed: { select: { displayName: true } } },
      })
      .then((rows) => rows.map((row) => [row.id, row.bed.displayName] as const)),
    database.hospital
      .findMany({ where: { id: { in: ids('Hospital') } }, select: { id: true, name: true } })
      .then(named),
  ]);
  return new Map(lookups.flat());
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

export class AuditLogService {
  public constructor(private readonly database: PrismaClient) {}

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
    const rows = await this.database.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: filter.limit + 1,
      ...(filter.before ? { cursor: { id: filter.before }, skip: 1 } : {}),
    });
    const page = rows.slice(0, filter.limit);

    const memberIds = [
      ...new Set(page.flatMap((row) => (row.actorMembershipId ? [row.actorMembershipId] : []))),
    ];
    const platformIds = [
      ...new Set(page.flatMap((row) => (row.actorPlatformUserId ? [row.actorPlatformUserId] : []))),
    ];
    const [members, operators, targets] = await Promise.all([
      this.database.hospitalMembership.findMany({
        where: { hospitalId, id: { in: memberIds } },
        select: { id: true, user: { select: { displayName: true } } },
      }),
      this.database.user.findMany({
        where: { id: { in: platformIds } },
        select: { id: true, displayName: true },
      }),
      targetNames(this.database, hospitalId, page),
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
