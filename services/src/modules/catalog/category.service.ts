import { type PrismaClient, type ServiceCategory } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../common/errors/app-error.js';
import { recordStaffAudit } from '../audit/index.js';
import { type StaffContext } from '../auth/index.js';
import {
  type CategoryFilter,
  type CreateCategoryInput,
  type UpdateCategoryInput,
} from './catalog.schemas.js';
import { CategoryRepository } from './category.repository.js';

type CategoryInput = UpdateCategoryInput;

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
  public constructor(
    private readonly database: PrismaClient,
    private readonly categories = new CategoryRepository(),
  ) {}

  public list(context: StaffContext, filter: CategoryFilter) {
    return this.categories.list(this.database, context.tenant.hospitalId, filter);
  }

  public async get(context: StaffContext, id: string) {
    const category = await this.categories.findById(this.database, context.tenant.hospitalId, id);
    if (!category) {
      throw new NotFoundError();
    }
    return category;
  }

  public create(context: StaffContext, input: CreateCategoryInput, requestId: string) {
    return this.database.$transaction(async (transaction) => {
      const category = await this.categories.create(transaction, context.tenant.hospitalId, {
        ...changes(input),
        name: input.name,
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
    const hospitalId = context.tenant.hospitalId;
    return this.database.$transaction(
      async (transaction) => {
        const before = await this.categories.findById(transaction, hospitalId, id);
        if (!before) {
          throw new NotFoundError();
        }
        const after = await this.categories.update(transaction, hospitalId, id, changes(input));
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

  public async remove(context: StaffContext, id: string, requestId: string): Promise<void> {
    const hospitalId = context.tenant.hospitalId;
    await this.database.$transaction(async (transaction) => {
      const before = await this.categories.findById(transaction, hospitalId, id);
      if (!before) {
        throw new NotFoundError();
      }
      if ((await this.categories.countServices(transaction, hospitalId, id)) > 0) {
        throw new ConflictError('This category has services. Move or delete them first.');
      }
      await this.categories.delete(transaction, hospitalId, id);
      await recordStaffAudit(transaction, context, requestId, {
        action: 'serviceCategory.delete',
        targetType: 'ServiceCategory',
        targetId: id,
        metadata: { before: snapshot(before) },
      });
    });
  }
}
