import {
  type Prisma,
  type PrismaClient,
  type RequestPriority,
  type ServiceItem,
} from '@prisma/client';
import { ConflictError, NotFoundError } from '../../common/errors/app-error.js';
import { recordStaffAudit } from '../audit/audit-log.js';
import { type StaffContext } from '../auth/auth.service.js';
import { type GuestContext } from '../bed-sessions/guest-session.service.js';

export interface ServiceItemInput {
  readonly categoryId?: string | undefined;
  readonly departmentId?: string | undefined;
  readonly slaPolicyId?: string | undefined;
  readonly escalationPolicyId?: string | null | undefined;
  readonly name?: string | undefined;
  readonly description?: string | null | undefined;
  readonly priority?: RequestPriority | undefined;
  readonly sortOrder?: number | undefined;
  readonly active?: boolean | undefined;
}

export type ServiceItemCreate = ServiceItemInput & {
  readonly categoryId: string;
  readonly departmentId: string;
  readonly slaPolicyId: string;
  readonly name: string;
};

export interface ServiceItemFilter {
  readonly categoryId?: string | undefined;
  readonly departmentId?: string | undefined;
  readonly active?: boolean | undefined;
}

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
  public constructor(private readonly database: PrismaClient) {}

  public list(context: StaffContext, filter: ServiceItemFilter) {
    return this.database.serviceItem.findMany({
      where: {
        hospitalId: context.tenant.hospitalId,
        ...(filter.categoryId !== undefined ? { categoryId: filter.categoryId } : {}),
        ...(filter.departmentId !== undefined ? { departmentId: filter.departmentId } : {}),
        ...(filter.active !== undefined ? { active: filter.active } : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  public async get(context: StaffContext, id: string) {
    const item = await this.database.serviceItem.findUnique({
      where: { hospitalId_id: { hospitalId: context.tenant.hospitalId, id } },
    });
    if (!item) {
      throw new NotFoundError();
    }
    return item;
  }

  public create(context: StaffContext, input: ServiceItemCreate, requestId: string) {
    const hospitalId = context.tenant.hospitalId;
    return this.database.$transaction(async (transaction) => {
      await requireReferences(transaction, hospitalId, input);
      const item = await transaction.serviceItem.create({
        data: {
          hospitalId,
          ...changes(input),
          categoryId: input.categoryId,
          departmentId: input.departmentId,
          slaPolicyId: input.slaPolicyId,
          name: input.name,
        },
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
    const where = { hospitalId_id: { hospitalId, id } };
    return this.database.$transaction(
      async (transaction) => {
        const before = await transaction.serviceItem.findUnique({ where });
        if (!before) {
          throw new NotFoundError();
        }
        await requireReferences(transaction, hospitalId, input);
        const after = await transaction.serviceItem.update({ where, data: changes(input) });
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

  public async delete(context: StaffContext, id: string, requestId: string): Promise<void> {
    const hospitalId = context.tenant.hospitalId;
    await this.database.$transaction(async (transaction) => {
      const before = await transaction.serviceItem.findUnique({
        where: { hospitalId_id: { hospitalId, id } },
      });
      if (!before) {
        throw new NotFoundError();
      }
      // Requests (a later phase) reference services through RESTRICT foreign
      // keys, so a used service is protected from deletion automatically.
      await transaction.serviceItem.delete({ where: { hospitalId_id: { hospitalId, id } } });
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
    const categories = await this.database.serviceCategory.findMany({
      where: { hospitalId: guest.hospitalId, active: true },
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
  const key = (id: string) => ({ hospitalId_id: { hospitalId, id } });
  if (input.categoryId !== undefined) {
    const category = await transaction.serviceCategory.findUnique({
      where: key(input.categoryId),
    });
    requireActive(category, 'category');
  }
  if (input.departmentId !== undefined) {
    const department = await transaction.department.findUnique({
      where: key(input.departmentId),
    });
    requireActive(department, 'department');
  }
  if (input.slaPolicyId !== undefined) {
    if (!(await transaction.slaPolicy.findUnique({ where: key(input.slaPolicyId) }))) {
      throw new NotFoundError('The referenced SLA policy was not found.');
    }
  }
  if (input.escalationPolicyId) {
    if (
      !(await transaction.escalationPolicy.findUnique({ where: key(input.escalationPolicyId) }))
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
