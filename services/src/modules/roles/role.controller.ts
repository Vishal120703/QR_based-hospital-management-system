import { type RequestHandler } from 'express';
import { emptySchema, idParamsSchema } from '../../common/validation.js';
import { getRequestId } from '../../middleware/request-id.js';
import { getStaffContext } from '../../middleware/staff-auth.js';
import {
  assignRoleSchema,
  createRoleSchema,
  unassignRoleParamsSchema,
  updateRoleSchema,
} from './role.schemas.js';
import { type RoleService } from './role.service.js';

export class RoleController {
  public constructor(private readonly roles: RoleService) {}

  public readonly list: RequestHandler = async (request, response) => {
    emptySchema.parse(request.query);
    response.status(200).json({ roles: await this.roles.list(getStaffContext(request)) });
  };

  public readonly get: RequestHandler = async (request, response) => {
    const { id } = idParamsSchema.parse(request.params);
    emptySchema.parse(request.query);
    response.status(200).json({ role: await this.roles.get(getStaffContext(request), id) });
  };

  public readonly create: RequestHandler = async (request, response) => {
    const input = createRoleSchema.parse(request.body);
    const role = await this.roles.create(getStaffContext(request), input, getRequestId(response));
    response.status(201).json({ role });
  };

  public readonly update: RequestHandler = async (request, response) => {
    const { id } = idParamsSchema.parse(request.params);
    const input = updateRoleSchema.parse(request.body);
    const role = await this.roles.update(
      getStaffContext(request),
      id,
      input,
      getRequestId(response),
    );
    response.status(200).json({ role });
  };

  public readonly remove: RequestHandler = async (request, response) => {
    const { id } = idParamsSchema.parse(request.params);
    emptySchema.parse(request.body ?? {});
    await this.roles.remove(getStaffContext(request), id, getRequestId(response));
    response.status(204).send();
  };

  public readonly assign: RequestHandler = async (request, response) => {
    const { id } = idParamsSchema.parse(request.params);
    const { roleId, scopeId } = assignRoleSchema.parse(request.body);
    const assignment = await this.roles.assignToMembership(
      getStaffContext(request),
      id,
      roleId,
      scopeId,
      getRequestId(response),
    );
    response.status(201).json({ assignment });
  };

  // Removes a role everywhere, or (with a scopeId) for one place only.
  public readonly unassign: RequestHandler = async (request, response) => {
    const { id, roleId, scopeId } = unassignRoleParamsSchema.parse(request.params);
    emptySchema.parse(request.body ?? {});
    await this.roles.unassignFromMembership(
      getStaffContext(request),
      id,
      roleId,
      scopeId,
      getRequestId(response),
    );
    response.status(204).send();
  };
}
