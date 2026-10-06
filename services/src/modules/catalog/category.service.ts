import { type PrismaClient, type ServiceCategory } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../common/errors/app-error.js';
import { recordStaffAudit } from '../audit/audit-log.js';
import { type StaffContext } from '../auth/auth.service.js';

export interface CategoryInput {
  readonly name?: string | undefined;
  readonly description?: string | null | undefined;
  readonly sortOrder?: number | undefined;
  readonly emergencyNotice?: boolean | undefined;
  readonly active?: boolean | undefined;
}

const snapshot = (row: ServiceCategory) => ({
  name: row.name,
  description: row.description,
  sortOrder: row.sortOrder,
  emergencyNotice: row.emergencyNotice,
  active: row.active,
});

function changes(input: CategoryInput) {
  return {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    ...(input.emergencyNotice !== undefined ? { emergencyNotice: input.emergencyNotice } : {}),
    ...(input.active !== undefined ? { active: input.active } : {}),
  };
}

export class CategoryService {
  public constructor(private readonly database: PrismaClient) {}

  public list(context: StaffContext, filter: { active?: boolean | undefined }) {
    return this.database.serviceCategory.findMany({
      where: {
        hospitalId: context.tenant.hospitalId,
        ...(filter.active !== undefined ? { active: filter.active } : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  public async get(context: StaffContext, id: string) {
    const category = await this.database.serviceCategory.findUnique({
      where: { hospitalId_id: { hospitalId: context.tenant.hospitalId, id } },
    });
    if (!category) {
      throw new NotFoundError();
    }
    return category;
  }

  public create(context: StaffContext, input: CategoryInput & { name: string }, requestId: string) {
    return this.database.$transaction(async (transaction) => {
      const category = await transaction.serviceCategory.create({
        data: { hospitalId: context.tenant.hospitalId, ...changes(input), name: input.name },
      });
      await recordStaffAudit(transaction, context, requestId, {
        action: 'serviceCategory.create',
        targetType: 'ServiceCategory',
        targetId: category.id,
        metadata: { after: snapshot(category) },
      });
      return category;
    });
  }

  public update(context: StaffContext, id: string, input: CategoryInput, requestId: string) {
    const where = { hospitalId_id: { hospitalId: context.tenant.hospitalId, id } };
    return this.database.$transaction(
      async (transaction) => {
        const before = await transaction.serviceCategory.findUnique({ where });
        if (!before) {
          throw new NotFoundError();
        }
        const after = await transaction.serviceCategory.update({ where, data: changes(input) });
        await recordStaffAudit(transaction, context, requestId, {
          action: 'serviceCategory.update',
          targetType: 'ServiceCategory',
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
      const before = await transaction.serviceCategory.findUnique({
        where: { hospitalId_id: { hospitalId, id } },
      });
      if (!before) {
        throw new NotFoundError();
      }
      if ((await transaction.serviceItem.count({ where: { hospitalId, categoryId: id } })) > 0) {
        throw new ConflictError('This category has services. Move or delete them first.');
      }
      await transaction.serviceCategory.delete({ where: { hospitalId_id: { hospitalId, id } } });
      await recordStaffAudit(transaction, context, requestId, {
        action: 'serviceCategory.delete',
        targetType: 'ServiceCategory',
        targetId: id,
        metadata: { before: snapshot(before) },
      });
    });
  }
}
