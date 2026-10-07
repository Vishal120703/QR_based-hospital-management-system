import { type Prisma } from '@prisma/client';
import { type Db } from '../../database/client.js';

const key = (hospitalId: string, id: string) => ({ hospitalId_id: { hospitalId, id } });

// Services a patient can request, and the records they point at.
export class ServiceItemRepository {
  public list(
    db: Db,
    hospitalId: string,
    filter: {
      categoryId?: string | undefined;
      departmentId?: string | undefined;
      active?: boolean | undefined;
    },
  ) {
    return db.serviceItem.findMany({
      where: {
        hospitalId,
        ...(filter.categoryId !== undefined ? { categoryId: filter.categoryId } : {}),
        ...(filter.departmentId !== undefined ? { departmentId: filter.departmentId } : {}),
        ...(filter.active !== undefined ? { active: filter.active } : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  public findById(db: Db, hospitalId: string, id: string) {
    return db.serviceItem.findUnique({ where: key(hospitalId, id) });
  }

  public create(db: Db, data: Prisma.ServiceItemUncheckedCreateInput) {
    return db.serviceItem.create({ data });
  }

  public async createMany(
    db: Db,
    rows: readonly Prisma.ServiceItemUncheckedCreateInput[],
  ): Promise<void> {
    await db.serviceItem.createMany({ data: [...rows] });
  }

  public update(
    db: Db,
    hospitalId: string,
    id: string,
    data: Prisma.ServiceItemUncheckedUpdateInput,
  ) {
    return db.serviceItem.update({ where: key(hospitalId, id), data });
  }

  public async delete(db: Db, hospitalId: string, id: string): Promise<void> {
    await db.serviceItem.delete({ where: key(hospitalId, id) });
  }

  public findCategory(db: Db, hospitalId: string, id: string) {
    return db.serviceCategory.findUnique({ where: key(hospitalId, id) });
  }

  public findDepartment(db: Db, hospitalId: string, id: string) {
    return db.department.findUnique({ where: key(hospitalId, id) });
  }

  public findSlaPolicy(db: Db, hospitalId: string, id: string) {
    return db.slaPolicy.findUnique({ where: key(hospitalId, id) });
  }

  public findEscalationPolicy(db: Db, hospitalId: string, id: string) {
    return db.escalationPolicy.findUnique({ where: key(hospitalId, id) });
  }

  // What a patient sees: active categories with their active services whose
  // department is active. No internal routing or SLA details.
  public findPatientCatalog(db: Db, hospitalId: string) {
    return db.serviceCategory.findMany({
      where: { hospitalId, active: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        description: true,
        emergencyNotice: true,
        items: {
          where: { active: true, department: { active: true } },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          select: { id: true, name: true, description: true },
        },
      },
    });
  }

  // A service with what a request copies from it.
  public findForSnapshot(db: Db, hospitalId: string, id: string) {
    return db.serviceItem.findUnique({
      where: key(hospitalId, id),
      include: {
        category: { select: { name: true, active: true } },
        department: { select: { active: true } },
        slaPolicy: { select: { currentVersion: true } },
      },
    });
  }

  public findSlaVersion(db: Db, hospitalId: string, slaPolicyId: string, version: number) {
    return db.slaPolicyVersion.findUniqueOrThrow({
      where: { hospitalId_slaPolicyId_version: { hospitalId, slaPolicyId, version } },
    });
  }
}
