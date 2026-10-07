import { type Department, type Prisma, type PrismaClient } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../common/errors/app-error.js';
import { recordStaffAudit } from '../audit/index.js';
import { type StaffContext } from '../auth/index.js';
import { DepartmentRepository } from './department.repository.js';
import {
  type CreateDepartmentInput,
  type DepartmentFilter,
  type UpdateDepartmentInput,
} from './department.schemas.js';

const repository = new DepartmentRepository();

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

// Creates the example departments for a new hospital, inside its bootstrap
// transaction, and returns their IDs by code.
export async function createExampleDepartments(
  transaction: Prisma.TransactionClient,
  hospitalId: string,
): Promise<Map<string, string>> {
  const created = await repository.createMany(
    transaction,
    hospitalId,
    exampleDepartments.map(([code, name]) => ({ code, name })),
  );
  return new Map(created.map((department) => [department.code, department.id]));
}

const snapshot = (row: Department) => ({ code: row.code, name: row.name, active: row.active });

export class DepartmentService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly departments = repository,
  ) {}

  public list(context: StaffContext, filter: DepartmentFilter) {
    return this.departments.list(this.database, context.tenant.hospitalId, filter);
  }

  public async get(context: StaffContext, id: string) {
    const department = await this.departments.findById(
      this.database,
      context.tenant.hospitalId,
      id,
    );
    if (!department) {
      throw new NotFoundError();
    }
    return department;
  }

  public create(context: StaffContext, input: CreateDepartmentInput, requestId: string) {
    return this.database.$transaction(async (transaction) => {
      const department = await this.departments.create(
        transaction,
        context.tenant.hospitalId,
        input,
      );
      await recordStaffAudit(transaction, context, requestId, {
        action: 'department.create',
        targetType: 'Department',
        targetId: department.id,
        metadata: { after: snapshot(department) },
      });
      return department;
    });
  }

  public update(
    context: StaffContext,
    id: string,
    input: UpdateDepartmentInput,
    requestId: string,
  ) {
    const hospitalId = context.tenant.hospitalId;
    return this.database.$transaction(
      async (transaction) => {
        const before = await this.departments.findById(transaction, hospitalId, id);
        if (!before) {
          throw new NotFoundError();
        }
        const after = await this.departments.update(transaction, hospitalId, id, {
          ...(input.code !== undefined ? { code: input.code } : {}),
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
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

  public async remove(context: StaffContext, id: string, requestId: string): Promise<void> {
    const hospitalId = context.tenant.hospitalId;
    await this.database.$transaction(async (transaction) => {
      const before = await this.departments.findById(transaction, hospitalId, id);
      if (!before) {
        throw new NotFoundError();
      }
      if ((await this.departments.countUses(transaction, hospitalId, id)) > 0) {
        throw new ConflictError(
          'This department has staff, shifts, or services. Deactivate it instead.',
        );
      }
      await this.departments.delete(transaction, hospitalId, id);
      await recordStaffAudit(transaction, context, requestId, {
        action: 'department.delete',
        targetType: 'Department',
        targetId: id,
        metadata: { before: snapshot(before) },
      });
    });
  }
}
