import { type ClientStatus, type HospitalStatus, type Prisma } from '@prisma/client';
import { type Db } from '../../database/client.js';

const openStatuses = ['SUBMITTED', 'ASSIGNED', 'ACCEPTED', 'IN_PROGRESS'] as const;

// The hospital fields the super admin sees, in lists and on a hospital page.
const hospitalSummary = {
  id: true,
  name: true,
  code: true,
  timezone: true,
  status: true,
  createdAt: true,
  logo: { select: { publicId: true } },
  client: { select: { id: true, name: true, code: true, status: true } },
} satisfies Prisma.HospitalSelect;

// What the super admin sees: clients, hospitals, and simple counts. Nothing
// clinical (no patients, requests, or staff records) is ever read here.
export class PlatformRepository {
  public listHospitals(db: Db, where: Prisma.HospitalWhereInput) {
    return db.hospital.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: hospitalSummary,
    });
  }

  // Active beds, active staff, and open requests per hospital.
  public countByHospital(db: Db, hospitalIds: readonly string[]) {
    const ids = [...hospitalIds];
    return Promise.all([
      db.bed.groupBy({
        by: ['hospitalId'],
        where: { hospitalId: { in: ids }, active: true },
        _count: true,
      }),
      db.hospitalMembership.groupBy({
        by: ['hospitalId'],
        where: { hospitalId: { in: ids }, status: 'ACTIVE' },
        _count: true,
      }),
      db.serviceRequest.groupBy({
        by: ['hospitalId'],
        where: { hospitalId: { in: ids }, status: { in: [...openStatuses] } },
        _count: true,
      }),
    ]);
  }

  public findHospital(db: Db, id: string) {
    return db.hospital.findUnique({ where: { id } });
  }

  public findHospitalDetail(db: Db, id: string) {
    return db.hospital.findUnique({
      where: { id },
      select: hospitalSummary,
    });
  }

  public updateHospital(
    db: Db,
    id: string,
    data: { name?: string; timezone?: string; status?: HospitalStatus; clientId?: string },
  ) {
    return db.hospital.update({ where: { id }, data });
  }

  // The people holding a role (by its built-in key) in a hospital.
  public findRoleHolders(db: Db, hospitalId: string, systemKey: string) {
    return db.userRole.findMany({
      where: { hospitalId, role: { systemKey } },
      select: {
        membership: {
          select: { id: true, status: true, user: { select: { email: true, displayName: true } } },
        },
      },
    });
  }

  public findRoleBySystemKey(db: Db, hospitalId: string, systemKey: string) {
    return db.role.findUnique({ where: { hospitalId_systemKey: { hospitalId, systemKey } } });
  }

  public listClients(db: Db) {
    return db.client.findMany({ orderBy: { createdAt: 'desc' } });
  }

  public findClient(db: Db, id: string) {
    return db.client.findUnique({ where: { id } });
  }

  public findClientWithHospitals(db: Db, id: string) {
    return db.client.findUnique({
      where: { id },
      include: { hospitals: { select: { id: true } } },
    });
  }

  public updateClient(
    db: Db,
    id: string,
    data: {
      name?: string;
      contactName?: string | null;
      contactEmail?: string | null;
      contactPhone?: string | null;
      status?: ClientStatus;
    },
  ) {
    return db.client.update({ where: { id }, data });
  }
}
