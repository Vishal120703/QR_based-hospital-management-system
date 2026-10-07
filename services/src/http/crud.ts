import { type RequestHandler, type Router } from 'express';
import { type z } from 'zod';
import { emptySchema, idParamsSchema } from '../common/validation.js';
import { getRequestId } from '../middleware/request-id.js';
import { getStaffContext } from '../middleware/staff-auth.js';
import { type StaffContext } from '../modules/auth/index.js';

// The five operations of a tenant-owned resource, as a service offers them.
export interface CrudOperations<Filter, Create, Update> {
  list(context: StaffContext, filter: Filter): Promise<unknown>;
  get(context: StaffContext, id: string): Promise<unknown>;
  create(context: StaffContext, input: Create, requestId: string): Promise<unknown>;
  update(context: StaffContext, id: string, input: Update, requestId: string): Promise<unknown>;
  remove(context: StaffContext, id: string, requestId: string): Promise<void>;
}

export interface CrudSchemas<Filter, Create, Update> {
  readonly filter: z.ZodType<Filter, z.ZodTypeDef, unknown>;
  readonly create: z.ZodType<Create, z.ZodTypeDef, unknown>;
  readonly update: z.ZodType<Update, z.ZodTypeDef, unknown>;
}

// Generic HTTP handlers for list, get, create, update, and delete. A module's
// controller extends this when its resource follows the standard shape, and
// adds its own handlers for anything else.
export class CrudController<Filter, Create, Update> {
  public constructor(
    private readonly operations: CrudOperations<Filter, Create, Update>,
    private readonly names: { readonly singular: string; readonly plural: string },
    private readonly schemas: CrudSchemas<Filter, Create, Update>,
  ) {}

  public readonly list: RequestHandler = async (request, response) => {
    const filter = this.schemas.filter.parse(request.query);
    const items = await this.operations.list(getStaffContext(request), filter);
    response.status(200).json({ [this.names.plural]: items });
  };

  public readonly get: RequestHandler = async (request, response) => {
    const { id } = idParamsSchema.parse(request.params);
    emptySchema.parse(request.query);
    const item = await this.operations.get(getStaffContext(request), id);
    response.status(200).json({ [this.names.singular]: item });
  };

  public readonly create: RequestHandler = async (request, response) => {
    const input = this.schemas.create.parse(request.body);
    const item = await this.operations.create(
      getStaffContext(request),
      input,
      getRequestId(response),
    );
    response.status(201).json({ [this.names.singular]: item });
  };

  public readonly update: RequestHandler = async (request, response) => {
    const { id } = idParamsSchema.parse(request.params);
    const input = this.schemas.update.parse(request.body);
    const item = await this.operations.update(
      getStaffContext(request),
      id,
      input,
      getRequestId(response),
    );
    response.status(200).json({ [this.names.singular]: item });
  };

  public readonly remove: RequestHandler = async (request, response) => {
    const { id } = idParamsSchema.parse(request.params);
    emptySchema.parse(request.body ?? {});
    await this.operations.remove(getStaffContext(request), id, getRequestId(response));
    response.status(204).send();
  };
}

// Registers the five standard routes: reads need `read`, changes need `manage`.
export function registerCrudRoutes(
  router: Router,
  path: string,
  controller: CrudHandlers,
  guards: { readonly read: RequestHandler; readonly manage: RequestHandler },
): void {
  const item = `${path}/:id`;
  router.get(path, guards.read, controller.list);
  router.get(item, guards.read, controller.get);
  router.post(path, guards.manage, controller.create);
  router.patch(item, guards.manage, controller.update);
  router.delete(item, guards.manage, controller.remove);
}

export type CrudHandlers = Pick<
  CrudController<unknown, unknown, unknown>,
  'list' | 'get' | 'create' | 'update' | 'remove'
>;
