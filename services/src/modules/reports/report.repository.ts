import { type Prisma } from '@prisma/client';
import { type Db } from '../../database/client.js';

// Read-only queries behind Reports: requests with their location and full
// event history, and the names of the staff involved.
export class ReportRepository {
  public findRequestsWithHistory(db: Db, where: Prisma.ServiceRequestWhereInput, take: number) {
    return db.serviceRequest.findMany({
      where,
      orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
      take,
      include: {
        department: { select: { name: true } },
        bed: {
          select: {
            displayName: true,
            room: { select: { name: true } },
            ward: {
              select: {
                name: true,
                floor: { select: { name: true, building: { select: { name: true } } } },
              },
            },
          },
        },
        events: { orderBy: { requestVersion: 'asc' } },
      },
    });
  }

  public findMemberNames(db: Db, hospitalId: string, ids: readonly string[]) {
    return db.hospitalMembership.findMany({
      where: { hospitalId, id: { in: [...ids] } },
      select: { id: true, user: { select: { displayName: true } } },
    });
  }

  public findSubmittedAt(db: Db, where: Prisma.ServiceRequestWhereInput) {
    return db.serviceRequest.findFirst({ where, select: { submittedAt: true } });
  }
}
