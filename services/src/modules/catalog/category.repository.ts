import { type Prisma } from '@prisma/client';
import { type Db } from '../../database/client.js';

// Service categories: the groups of buttons on the patient page.
export class CategoryRepository {
  public list(db: Db, hospitalId: string, filter: { active?: boolean | undefined }) {
    return db.serviceCategory.findMany({
      where: { hospitalId, ...(filter.active !== undefined ? { active: filter.active } : {}) },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  public findById(db: Db, hospitalId: string, id: string) {
    return db.serviceCategory.findUnique({ where: { hospitalId_id: { hospitalId, id } } });
  }

  public create(
    db: Db,
    hospitalId: string,
    data: Omit<Prisma.ServiceCategoryUncheckedCreateInput, 'hospitalId'>,
  ) {
    return db.serviceCategory.create({ data: { hospitalId, ...data } });
  }

  public createMany(
    db: Db,
    hospitalId: string,
    rows: readonly Omit<Prisma.ServiceCategoryUncheckedCreateInput, 'hospitalId'>[],
  ) {
    return db.serviceCategory.createManyAndReturn({
      data: rows.map((row) => ({ hospitalId, ...row })),
    });
  }

  public update(
    db: Db,
    hospitalId: string,
    id: string,
    data: Prisma.ServiceCategoryUncheckedUpdateInput,
  ) {
    return db.serviceCategory.update({ where: { hospitalId_id: { hospitalId, id } }, data });
  }

  public async delete(db: Db, hospitalId: string, id: string): Promise<void> {
    await db.serviceCategory.delete({ where: { hospitalId_id: { hospitalId, id } } });
  }

  public countServices(db: Db, hospitalId: string, categoryId: string) {
    return db.serviceItem.count({ where: { hospitalId, categoryId } });
  }
}
