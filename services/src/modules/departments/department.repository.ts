import { type Db } from '../../database/client.js';

// Departments (teams such as Nursing or Pantry) of one hospital.
export class DepartmentRepository {
  public list(db: Db, hospitalId: string, filter: { active?: boolean | undefined }) {
    return db.department.findMany({
      where: { hospitalId, ...(filter.active !== undefined ? { active: filter.active } : {}) },
      orderBy: { name: 'asc' },
    });
  }

  public findById(db: Db, hospitalId: string, id: string) {
    return db.department.findUnique({ where: { hospitalId_id: { hospitalId, id } } });
  }

  public create(db: Db, hospitalId: string, data: { code: string; name: string }) {
    return db.department.create({ data: { hospitalId, ...data } });
  }

  public createMany(db: Db, hospitalId: string, rows: readonly { code: string; name: string }[]) {
    return db.department.createManyAndReturn({
      data: rows.map((row) => ({ hospitalId, ...row })),
    });
  }

  public update(
    db: Db,
    hospitalId: string,
    id: string,
    data: { code?: string; name?: string; active?: boolean },
  ) {
    return db.department.update({ where: { hospitalId_id: { hospitalId, id } }, data });
  }

  public async delete(db: Db, hospitalId: string, id: string): Promise<void> {
    await db.department.delete({ where: { hospitalId_id: { hospitalId, id } } });
  }

  // How many staff, shifts, services, and authorization scopes still use it.
  public async countUses(db: Db, hospitalId: string, id: string): Promise<number> {
    const where = { hospitalId, departmentId: id };
    const [staff, shifts, services, roleScopes] = await Promise.all([
      db.staffDepartment.count({ where }),
      db.shift.count({ where }),
      db.serviceItem.count({ where }),
      db.scopeAssignment.count({
        where: { hospitalId, scopeType: 'DEPARTMENT', scopeId: id },
      }),
    ]);
    return staff + shifts + services + roleScopes;
  }
}
