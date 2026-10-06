import { type Router } from 'express';
import { type z } from 'zod';
import { emptySchema, idParamsSchema } from '../common/validation.js';
import { getRequestId } from '../middleware/request-id.js';
import {
  getStaffContext,
  requirePermission,
  requireScopedPermission,
} from '../middleware/staff-auth.js';
import { type StaffContext } from '../modules/auth/auth.service.js';
import { type PermissionKey } from '../modules/roles/permissions.js';

export interface ResourceDefinition<Filter, Create, Update> {
  readonly path: string;
  readonly singular: string;
  readonly plural: string;
  readonly readPermission: PermissionKey;
  // Reads are allowed with the permission held for any floor or ward; the
  // service then returns only what that area covers.
  readonly readAnyScope?: boolean;
  readonly managePermission: PermissionKey;
  readonly filterSchema: z.ZodType<Filter, z.ZodTypeDef, unknown>;
  readonly createSchema: z.ZodType<Create, z.ZodTypeDef, unknown>;
  readonly updateSchema: z.ZodType<Update, z.ZodTypeDef, unknown>;
  list(context: StaffContext, filter: Filter): Promise<unknown>;
  get(context: StaffContext, id: string): Promise<unknown>;
  create(context: StaffContext, input: Create, requestId: string): Promise<unknown>;
  update(context: StaffContext, id: string, input: Update, requestId: string): Promise<unknown>;
  remove(context: StaffContext, id: string, requestId: string): Promise<void>;
}

// Registers list, get, create, update, and delete for a tenant-owned resource.
export function registerResource<Filter, Create, Update>(
  router: Router,
  resource: ResourceDefinition<Filter, Create, Update>,
): void {
  const itemPath = `${resource.path}/:id`;
  const canRead = resource.readAnyScope
    ? requireScopedPermission(resource.readPermission)
    : requirePermission(resource.readPermission);
  const canManage = requirePermission(resource.managePermission);

  router.get(resource.path, canRead, async (request, response) => {
    const filter = resource.filterSchema.parse(request.query);
    const items = await resource.list(getStaffContext(request), filter);
    response.status(200).json({ [resource.plural]: items });
  });

  router.get(itemPath, canRead, async (request, response) => {
    const { id } = idParamsSchema.parse(request.params);
    emptySchema.parse(request.query);
    const item = await resource.get(getStaffContext(request), id);
    response.status(200).json({ [resource.singular]: item });
  });

  router.post(resource.path, canManage, async (request, response) => {
    const input = resource.createSchema.parse(request.body);
    const item = await resource.create(getStaffContext(request), input, getRequestId(response));
    response.status(201).json({ [resource.singular]: item });
  });

  router.patch(itemPath, canManage, async (request, response) => {
    const { id } = idParamsSchema.parse(request.params);
    const input = resource.updateSchema.parse(request.body);
    const item = await resource.update(getStaffContext(request), id, input, getRequestId(response));
    response.status(200).json({ [resource.singular]: item });
  });

  router.delete(itemPath, canManage, async (request, response) => {
    const { id } = idParamsSchema.parse(request.params);
    emptySchema.parse(request.body ?? {});
    await resource.remove(getStaffContext(request), id, getRequestId(response));
    response.status(204).send();
  });
}
