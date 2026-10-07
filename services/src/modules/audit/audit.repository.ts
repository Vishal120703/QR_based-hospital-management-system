import { type Prisma } from '@prisma/client';
import { type Db } from '../../database/client.js';

// Audit entries, plus the names the log shows for people and things.
export class AuditRepository {
  public async create(db: Db, data: Prisma.AuditLogUncheckedCreateInput): Promise<void> {
    await db.auditLog.create({ data });
  }

  // Newest first; `take` one extra row to know whether another page exists.
  public findPage(
    db: Db,
    where: Prisma.AuditLogWhereInput,
    take: number,
    before: string | undefined,
  ) {
    return db.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      ...(before ? { cursor: { id: before }, skip: 1 } : {}),
    });
  }

  public findMemberNames(db: Db, hospitalId: string, ids: readonly string[]) {
    return db.hospitalMembership.findMany({
      where: { hospitalId, id: { in: [...ids] } },
      select: { id: true, user: { select: { displayName: true } } },
    });
  }

  public findUserNames(db: Db, ids: readonly string[]) {
    return db.user.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, displayName: true },
    });
  }

  // Plain names for the things audit entries point at, so the log reads
  // "Role: Floor Manager" rather than an ID.
  public async findTargetNames(
    db: Db,
    hospitalId: string,
    entries: readonly { targetType: string; targetId: string }[],
  ): Promise<Map<string, string>> {
    const ids = (type: string) => [
      ...new Set(
        entries.filter((entry) => entry.targetType === type).map((entry) => entry.targetId),
      ),
    ];
    const named = (rows: { id: string; name: string }[]) =>
      rows.map((row) => [row.id, row.name] as const);
    const lookups = await Promise.all([
      db.hospitalMembership
        .findMany({
          where: { hospitalId, id: { in: ids('HospitalMembership') } },
          select: { id: true, user: { select: { displayName: true } } },
        })
        .then((rows) => rows.map((row) => [row.id, row.user.displayName] as const)),
      db.role
        .findMany({
          where: { hospitalId, id: { in: ids('Role') } },
          select: { id: true, name: true },
        })
        .then(named),
      db.bed
        .findMany({
          where: { hospitalId, id: { in: ids('Bed') } },
          select: { id: true, displayName: true },
        })
        .then((rows) => rows.map((row) => [row.id, row.displayName] as const)),
      db.ward
        .findMany({
          where: { hospitalId, id: { in: ids('Ward') } },
          select: { id: true, name: true },
        })
        .then(named),
      db.floor
        .findMany({
          where: { hospitalId, id: { in: ids('Floor') } },
          select: { id: true, name: true },
        })
        .then(named),
      db.building
        .findMany({
          where: { hospitalId, id: { in: ids('Building') } },
          select: { id: true, name: true },
        })
        .then(named),
      db.room
        .findMany({
          where: { hospitalId, id: { in: ids('Room') } },
          select: { id: true, name: true },
        })
        .then(named),
      db.department
        .findMany({
          where: { hospitalId, id: { in: ids('Department') } },
          select: { id: true, name: true },
        })
        .then(named),
      db.serviceItem
        .findMany({
          where: { hospitalId, id: { in: ids('ServiceItem') } },
          select: { id: true, name: true },
        })
        .then(named),
      db.serviceRequest
        .findMany({
          where: { hospitalId, id: { in: ids('ServiceRequest') } },
          select: { id: true, publicId: true, serviceName: true },
        })
        .then((rows) =>
          rows.map((row) => [row.id, `${row.serviceName} (${row.publicId})`] as const),
        ),
      db.bedSession
        .findMany({
          where: { hospitalId, id: { in: ids('BedSession') } },
          select: { id: true, bed: { select: { displayName: true } } },
        })
        .then((rows) => rows.map((row) => [row.id, row.bed.displayName] as const)),
      db.bedQrCode
        .findMany({
          where: { hospitalId, id: { in: ids('BedQrCode') } },
          select: { id: true, bed: { select: { displayName: true } } },
        })
        .then((rows) => rows.map((row) => [row.id, row.bed.displayName] as const)),
      db.hospital
        .findMany({ where: { id: { in: ids('Hospital') } }, select: { id: true, name: true } })
        .then(named),
    ]);
    return new Map(lookups.flat());
  }
}
