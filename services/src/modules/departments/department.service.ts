import { type Department, type PrismaClient } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../common/errors/app-error.js';
import { recordStaffAudit } from '../audit/audit-log.js';
import { type StaffContext } from '../auth/auth.service.js';

// Editable examples given to every new hospital. Departments are data, not
// logic: no code path depends on these codes.
export const exampleDepartments = [
  ['NURSING', 'Nursing'],
  ['HOUSEKEEPING', 'Housekeeping'],
  ['PANTRY', 'Pantry'],
  ['MAINTENANCE', 'Maintenance'],
  ['PATIENT-ASSIST', 'Patient Assistance'],
  ['BILLING', 'Billing'],
  ['TRANSPORT', 'Transport'],
] as const;

export interface DepartmentInput {
  readonly code?: string | undefined;
  readonly name?: string | undefined;
  readonly active?: boolean | undefined;
}

const snapshot = (row: Department) => ({ code: row.code, name: row.name, active: row.active });

export class DepartmentService {
  public constructor(private readonly database: PrismaClient) {}

  public list(context: StaffContext, filter: { active?: boolean | undefined }) {
    return this.database.department.findMany({
      where: {
        hospitalId: context.tenant.hospitalId,
        ...(filter.active !== undefined ? { active: filter.active } : {}),
      },
      orderBy: { name: 'asc' },
    });
  }

  public async get(context: StaffContext, id: string) {
    const department = await this.database.department.findUnique({
      where: { hospitalId_id: { hospitalId: context.tenant.hospitalId, id } },
    });
    if (!department) {
      throw new NotFoundError();
    }
    return department;
  }

  public create(context: StaffContext, input: { code: string; name: string }, requestId: string) {
    return this.database.$transaction(async (transaction) => {
      const department = await transaction.department.create({
        data: { hospitalId: context.tenant.hospitalId, code: input.code, name: input.name },
      });
      await recordStaffAudit(transaction, context, requestId, {
        action: 'department.create',
        targetType: 'Department',
        targetId: department.id,
        metadata: { after: snapshot(department) },
      });
      return department;
    });
  }

  public update(context: StaffContext, id: string, input: DepartmentInput, requestId: string) {
    const where = { hospitalId_id: { hospitalId: context.tenant.hospitalId, id } };
    return this.database.$transaction(
      async (transaction) => {
        const before = await transaction.department.findUnique({ where });
        if (!before) {
          throw new NotFoundError();
        }
        const after = await transaction.department.update({
          where,
          data: {
            ...(input.code !== undefined ? { code: input.code } : {}),
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.active !== undefined ? { active: input.active } : {}),
          },
        });
        await recordStaffAudit(transaction, context, requestId, {
          action: 'department.update',
          targetType: 'Department',
          targetId: id,
          metadata: { before: snapshot(before), after: snapshot(after) },
        });
        return after;
      },
      { isolationLevel: 'Serializable' },
    );
  }

  public async delete(context: StaffContext, id: string, requestId: string): Promise<void> {
    const hospitalId = context.tenant.hospitalId;
    await this.database.$transaction(async (transaction) => {
      const before = await transaction.department.findUnique({
        where: { hospitalId_id: { hospitalId, id } },
      });
      if (!before) {
        throw new NotFoundError();
      }
      const staff = await transaction.staffDepartment.count({
        where: { hospitalId, departmentId: id },
      });
      const shifts = await transaction.shift.count({ where: { hospitalId, departmentId: id } });
      const services = await transaction.serviceItem.count({
        where: { hospitalId, departmentId: id },
      });
      if (staff + shifts + services > 0) {
        throw new ConflictError(
          'This department has staff, shifts, or services. Deactivate it instead.',
        );
      }
      await transaction.department.delete({ where: { hospitalId_id: { hospitalId, id } } });
      await recordStaffAudit(transaction, context, requestId, {
        action: 'department.delete',
        targetType: 'Department',
        targetId: id,
        metadata: { before: snapshot(before) },
      });
    });
  }
}
