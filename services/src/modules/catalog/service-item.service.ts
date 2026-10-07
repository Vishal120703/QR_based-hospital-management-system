import { type Prisma, type PrismaClient, type ServiceItem } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../common/errors/app-error.js';
import { recordStaffAudit } from '../audit/index.js';
import { type StaffContext } from '../auth/index.js';
import { type GuestContext } from '../bed-sessions/index.js';
import {
  type CreateServiceItemInput,
  type ServiceItemFilter,
  type UpdateServiceItemInput,
} from './catalog.schemas.js';
import { ServiceItemRepository } from './service-item.repository.js';

type ServiceItemInput = UpdateServiceItemInput;
const repository = new ServiceItemRepository();

const snapshot = (row: ServiceItem) => ({
  categoryId: row.categoryId,
  departmentId: row.departmentId,
  slaPolicyId: row.slaPolicyId,
  escalationPolicyId: row.escalationPolicyId,
  name: row.name,
  description: row.description,
  priority: row.priority,
  sortOrder: row.sortOrder,
  active: row.active,
});

function changes(input: ServiceItemInput) {
  return {
    ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
    ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
    ...(input.slaPolicyId !== undefined ? { slaPolicyId: input.slaPolicyId } : {}),
    ...(input.escalationPolicyId !== undefined
      ? { escalationPolicyId: input.escalationPolicyId }
      : {}),
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.priority !== undefined ? { priority: input.priority } : {}),
    ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    ...(input.active !== undefined ? { active: input.active } : {}),
  };
}

export class ServiceItemService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly services = repository,
  ) {}

  public list(context: StaffContext, filter: ServiceItemFilter) {
    return this.services.list(this.database, context.tenant.hospitalId, filter);
  }

  public async get(context: StaffContext, id: string) {
    const item = await this.services.findById(this.database, context.tenant.hospitalId, id);
    if (!item) {
      throw new NotFoundError();
    }
    return item;
  }

  public create(context: StaffContext, input: CreateServiceItemInput, requestId: string) {
    const hospitalId = context.tenant.hospitalId;
    return this.database.$transaction(async (transaction) => {
      await requireReferences(transaction, hospitalId, input);
      const item = await this.services.create(transaction, {
        hospitalId,
        ...changes(input),
        categoryId: input.categoryId,
        departmentId: input.departmentId,
        slaPolicyId: input.slaPolicyId,
        name: input.name,
      });
      await recordStaffAudit(transaction, context, requestId, {
        action: 'service.create',
        targetType: 'ServiceItem',
        targetId: item.id,
        metadata: { after: snapshot(item) },
      });
      return item;
    });
  }

  // Edits affect only future requests: each request snapshots its service.
  public update(context: StaffContext, id: string, input: ServiceItemInput, requestId: string) {
    const hospitalId = context.tenant.hospitalId;
    return this.database.$transaction(
      async (transaction) => {
        const before = await this.services.findById(transaction, hospitalId, id);
        if (!before) {
          throw new NotFoundError();
        }
        await requireReferences(transaction, hospitalId, input);
        const after = await this.services.update(transaction, hospitalId, id, changes(input));
        await recordStaffAudit(transaction, context, requestId, {
          action: 'service.update',
          targetType: 'ServiceItem',
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
      const before = await this.services.findById(transaction, hospitalId, id);
      if (!before) {
        throw new NotFoundError();
      }
      // Requests (a later phase) reference services through RESTRICT foreign
      // keys, so a used service is protected from deletion automatically.
      await this.services.delete(transaction, hospitalId, id);
      await recordStaffAudit(transaction, context, requestId, {
        action: 'service.delete',
        targetType: 'ServiceItem',
        targetId: id,
        metadata: { before: snapshot(before) },
      });
    });
  }

  // What a patient sees: active services whose category and department are
  // active, grouped by category. Internal routing and SLA details are omitted.
  public async catalogFor(guest: GuestContext) {
    const categories = await this.services.findPatientCatalog(this.database, guest.hospitalId);
    return categories
      .filter((category) => category.items.length > 0)
      .map(({ items, ...category }) => ({ ...category, services: items }));
  }
}

// Every reference must exist in this hospital; new links must be active.
async function requireReferences(
  transaction: Prisma.TransactionClient,
  hospitalId: string,
  input: ServiceItemInput,
): Promise<void> {
  if (input.categoryId !== undefined) {
    requireActive(
      await repository.findCategory(transaction, hospitalId, input.categoryId),
      'category',
    );
  }
  if (input.departmentId !== undefined) {
    requireActive(
      await repository.findDepartment(transaction, hospitalId, input.departmentId),
      'department',
    );
  }
  if (input.slaPolicyId !== undefined) {
    if (!(await repository.findSlaPolicy(transaction, hospitalId, input.slaPolicyId))) {
      throw new NotFoundError('The referenced SLA policy was not found.');
    }
  }
  if (input.escalationPolicyId) {
    if (
      !(await repository.findEscalationPolicy(transaction, hospitalId, input.escalationPolicyId))
    ) {
      throw new NotFoundError('The referenced escalation policy was not found.');
    }
  }
}

function requireActive(row: { active: boolean } | null, label: string): void {
  if (!row) {
    throw new NotFoundError(`The referenced ${label} was not found.`);
  }
  if (!row.active) {
    throw new ConflictError(`The ${label} is inactive.`);
  }
}
