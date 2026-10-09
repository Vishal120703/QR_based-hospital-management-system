import { type Prisma } from '@prisma/client';
import { type Db } from '../../database/client.js';
import { type NamedKind } from './audit-details.js';

type NameRow = { id: string; name: string };

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

  // Everyone on the staff who has made a recorded change in this hospital.
  public async findActors(db: Db, hospitalId: string): Promise<NameRow[]> {
    const rows = await db.auditLog.findMany({
      where: { hospitalId, actorMembershipId: { not: null } },
      distinct: ['actorMembershipId'],
      select: { actorMembershipId: true },
    });
    const ids = rows.flatMap((row) => (row.actorMembershipId ? [row.actorMembershipId] : []));
    const people = await db.hospitalMembership.findMany({
      where: { hospitalId, id: { in: ids } },
      select: { id: true, user: { select: { displayName: true } } },
    });
    return people
      .map((person) => ({ id: person.id, name: person.user.displayName }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  // Plain names for the people and things entries point at, keyed
  // "kind:id", so the log reads "Role: Floor Manager" rather than an id.
  // Only kinds that are asked for are queried.
  public async findNames(
    db: Db,
    hospitalId: string,
    wanted: ReadonlyMap<NamedKind, ReadonlySet<string>>,
  ): Promise<Map<string, string>> {
    const lookup = async (kind: NamedKind, query: (ids: string[]) => Promise<NameRow[]>) => {
      const ids = [...(wanted.get(kind) ?? [])];
      if (ids.length === 0) return [];
      return (await query(ids)).map((row) => [`${kind}:${row.id}`, row.name] as const);
    };
    const where = (ids: string[]) => ({ hospitalId, id: { in: ids } });
    const byName = { id: true, name: true } as const;

    const found = await Promise.all([
      lookup('membership', async (ids) =>
        (
          await db.hospitalMembership.findMany({
            where: where(ids),
            select: { id: true, user: { select: { displayName: true } } },
          })
        ).map((row) => ({ id: row.id, name: row.user.displayName })),
      ),
      // Super admins are global users, not hospital members.
      lookup('user', async (ids) =>
        (
          await db.user.findMany({
            where: { id: { in: ids } },
            select: { id: true, displayName: true },
          })
        ).map((row) => ({ id: row.id, name: row.displayName })),
      ),
      lookup('role', (ids) => db.role.findMany({ where: where(ids), select: byName })),
      lookup('department', (ids) => db.department.findMany({ where: where(ids), select: byName })),
      lookup('building', (ids) => db.building.findMany({ where: where(ids), select: byName })),
      lookup('floor', (ids) => db.floor.findMany({ where: where(ids), select: byName })),
      lookup('ward', (ids) => db.ward.findMany({ where: where(ids), select: byName })),
      lookup('room', (ids) => db.room.findMany({ where: where(ids), select: byName })),
      lookup('bed', async (ids) =>
        (await db.bed.findMany({ where: where(ids), select: { id: true, displayName: true } })).map(
          (row) => ({ id: row.id, name: row.displayName }),
        ),
      ),
      lookup('category', (ids) =>
        db.serviceCategory.findMany({ where: where(ids), select: byName }),
      ),
      lookup('service', (ids) => db.serviceItem.findMany({ where: where(ids), select: byName })),
      lookup('sla', (ids) => db.slaPolicy.findMany({ where: where(ids), select: byName })),
      lookup('escalation', (ids) =>
        db.escalationPolicy.findMany({ where: where(ids), select: byName }),
      ),
      lookup('request', async (ids) =>
        (
          await db.serviceRequest.findMany({
            where: where(ids),
            select: { id: true, publicId: true, serviceName: true },
          })
        ).map((row) => ({ id: row.id, name: `${row.serviceName} (${row.publicId})` })),
      ),
      lookup('bedSession', async (ids) =>
        (
          await db.bedSession.findMany({
            where: where(ids),
            select: { id: true, bed: { select: { displayName: true } } },
          })
        ).map((row) => ({ id: row.id, name: row.bed.displayName })),
      ),
      lookup('qr', async (ids) =>
        (
          await db.bedQrCode.findMany({
            where: where(ids),
            select: { id: true, bed: { select: { displayName: true } } },
          })
        ).map((row) => ({ id: row.id, name: row.bed.displayName })),
      ),
      lookup('hospital', (ids) =>
        db.hospital.findMany({
          where: { id: { in: ids.filter((id) => id === hospitalId) } },
          select: byName,
        }),
      ),
    ]);
    return new Map(found.flat());
  }
}
