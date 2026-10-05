import { Router } from 'express';
import { z } from 'zod';
import { UnauthorizedError } from '../../common/errors/app-error.js';
import { requirePermission } from '../../middleware/staff-auth.js';
import type { RoleService } from './role.service.js';

const idSchema = z.object({ id: z.string().uuid() }).strict();
const membershipIdSchema = z.object({ id: z.string().uuid() }).strict();
const createRoleSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    description: z.string().trim().max(500).nullable().optional(),
    active: z.boolean().optional(),
    permissionKeys: z.array(z.string().min(1)).max(100).optional(),
  })
  .strict();
const updateRoleSchema = createRoleSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required.' });
const assignRoleSchema = z.object({ roleId: z.string().uuid() }).strict();
const emptyBodySchema = z.object({}).strict();

export function createRoleRouter(roles: RoleService): Router {
  const router = Router();

  router.get('/roles', requirePermission('role.read'), async (request, response) => {
    const context = request.staff;
    if (!context) throw new UnauthorizedError();
    z.object({}).strict().parse(request.query);
    response.status(200).json({ roles: await roles.list(context) });
  });

  router.get('/roles/:id', requirePermission('role.read'), async (request, response) => {
    const context = request.staff;
    if (!context) throw new UnauthorizedError();
    const { id } = idSchema.parse(request.params);
    z.object({}).strict().parse(request.query);
    response.status(200).json({ role: await roles.get(context, id) });
  });

  router.post('/roles', requirePermission('role.manage'), async (request, response) => {
    const context = request.staff;
    if (!context) throw new UnauthorizedError();
    const input = createRoleSchema.parse(request.body);
    const requestId = String(response.getHeader('x-request-id'));
    response.status(201).json({ role: await roles.create(context, input, requestId) });
  });

  router.patch('/roles/:id', requirePermission('role.manage'), async (request, response) => {
    const context = request.staff;
    if (!context) throw new UnauthorizedError();
    const { id } = idSchema.parse(request.params);
    const input = updateRoleSchema.parse(request.body);
    const requestId = String(response.getHeader('x-request-id'));
    response.status(200).json({ role: await roles.update(context, id, input, requestId) });
  });

  router.delete('/roles/:id', requirePermission('role.manage'), async (request, response) => {
    const context = request.staff;
    if (!context) throw new UnauthorizedError();
    const { id } = idSchema.parse(request.params);
    emptyBodySchema.parse(request.body ?? {});
    await roles.delete(context, id, String(response.getHeader('x-request-id')));
    response.status(204).send();
  });

  router.post(
    '/memberships/:id/roles',
    requirePermission('staff.manage'),
    requirePermission('role.manage'),
    async (request, response) => {
      const context = request.staff;
      if (!context) throw new UnauthorizedError();
      const { id } = membershipIdSchema.parse(request.params);
      const { roleId } = assignRoleSchema.parse(request.body);
      const assignment = await roles.assignToMembership(
        context,
        id,
        roleId,
        String(response.getHeader('x-request-id')),
      );
      response.status(201).json({ assignment });
    },
  );

  router.delete(
    '/memberships/:id/roles/:roleId',
    requirePermission('staff.manage'),
    requirePermission('role.manage'),
    async (request, response) => {
      const context = request.staff;
      if (!context) throw new UnauthorizedError();
      const { id, roleId } = z
        .object({ id: z.string().uuid(), roleId: z.string().uuid() })
        .strict()
        .parse(request.params);
      emptyBodySchema.parse(request.body ?? {});
      await roles.unassignFromMembership(
        context,
        id,
        roleId,
        String(response.getHeader('x-request-id')),
      );
      response.status(204).send();
    },
  );

  return router;
}
