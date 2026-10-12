import {
  Prisma,
  type EscalationStage,
  type EscalationTarget,
  type RequestStatus,
} from '@prisma/client';
import { type Db } from '../../database/client.js';

// Escalation steps taken after missed deadlines, and the requests due one.
export class EscalationRepository {
  public lockWaiting(
    db: Db,
    hospitalId: string,
    id: string,
    stage: EscalationStage,
    statuses: readonly RequestStatus[],
    dueAt: Date,
  ) {
    return db.$queryRaw<{ id: string; escalationLevel: number }[]>(Prisma.sql`
      SELECT "id", "escalationLevel" FROM "ServiceRequest" WHERE "hospitalId" = ${hospitalId}::uuid
        AND "id" = ${id}::uuid AND "status"::text IN (${Prisma.join(statuses)})
        AND ${stage === 'ACCEPT' ? Prisma.sql`"acceptDueAt"` : Prisma.sql`"completeDueAt"`} = ${dueAt.toISOString()}::timestamp
      FOR UPDATE
    `);
  }
  // Open requests with an escalation policy, past their current deadline, in
  // hospitals that are open. Stable ID batches avoid starving later requests.
  public findOverdue(
    db: Db,
    overdue: Prisma.ServiceRequestWhereInput,
    take: number,
    after?: string,
  ) {
    return db.serviceRequest.findMany({
      where: {
        AND: [overdue, { escalationPolicyId: { not: null } }],
        hospital: { status: 'ACTIVE', client: { status: 'ACTIVE' } },
        ...(after ? { id: { gt: after } } : {}),
      },
      orderBy: { id: 'asc' },
      take,
      select: {
        id: true,
        hospitalId: true,
        status: true,
        acceptDueAt: true,
        completeDueAt: true,
        escalationPolicyId: true,
        escalationLevel: true,
        isEscalated: true,
      },
    });
  }

  // Records steps not taken yet; returns how many were new.
  public async create(
    db: Db,
    steps: readonly {
      hospitalId: string;
      requestId: string;
      stage: EscalationStage;
      level: number;
      targetType: EscalationTarget;
      roleId: string | null;
      dueAt: Date;
    }[],
  ): Promise<number> {
    const created = await db.requestEscalation.createMany({
      data: [...steps],
      skipDuplicates: true,
    });
    return created.count;
  }

  // Marks the request escalated only if it is still waiting on that deadline
  // (not accepted or finished meanwhile); returns 1 or 0.
  public async markEscalated(
    db: Db,
    hospitalId: string,
    id: string,
    statuses: readonly RequestStatus[],
    level: number,
  ): Promise<number> {
    const updated = await db.serviceRequest.updateMany({
      where: { hospitalId, id, status: { in: [...statuses] } },
      data: { isEscalated: true, escalationLevel: level },
    });
    return updated.count;
  }

  // Escalations still current (the request is still waiting on that deadline)
  // that are meant for this person: for a role they hold, or for whoever is
  // assigned. Only requests they may see.
  public findCurrentFor(
    db: Db,
    hospitalId: string,
    visible: Prisma.ServiceRequestWhereInput,
    person: { membershipId: string; roleIds: readonly string[] },
    take: number,
  ) {
    const where: Prisma.RequestEscalationWhereInput = {
      hospitalId,
      request: { is: visible },
      AND: [
        {
          OR: [
            { stage: 'ACCEPT', request: { is: { status: { in: ['SUBMITTED', 'ASSIGNED'] } } } },
            {
              stage: 'COMPLETE',
              request: { is: { status: { in: ['ACCEPTED', 'IN_PROGRESS'] } } },
            },
          ],
        },
        {
          OR: [
            { targetType: 'ROLE', roleId: { in: [...person.roleIds] } },
            { targetType: 'ASSIGNEE', request: { is: { assigneeId: person.membershipId } } },
          ],
        },
      ],
    };
    return Promise.all([
      db.requestEscalation.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
        include: {
          request: {
            select: {
              id: true,
              publicId: true,
              serviceName: true,
              bed: { select: { displayName: true } },
            },
          },
        },
      }),
      db.requestEscalation.count({ where }),
    ]);
  }
}
