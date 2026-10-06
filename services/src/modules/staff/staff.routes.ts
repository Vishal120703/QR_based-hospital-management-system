import { Router } from 'express';
import { z } from 'zod';
import { emptySchema, idParamsSchema, uuidSchema } from '../../common/validation.js';
import { getRequestId } from '../../middleware/request-id.js';
import {
  getStaffContext,
  requirePermission,
  requireScopedPermission,
} from '../../middleware/staff-auth.js';
import { type ShiftService } from './shift.service.js';
import { type StaffService } from './staff.service.js';

const maxShiftMs = 24 * 60 * 60 * 1000;

const listQuerySchema = z
  .object({
    status: z.enum(['ACTIVE', 'SUSPENDED', 'INACTIVE']).optional(),
    dutyStatus: z.enum(['ON_DUTY', 'OFF_DUTY']).optional(),
    departmentId: uuidSchema.optional(),
  })
  .strict();
const eligibleQuerySchema = z.object({ bedId: uuidSchema, departmentId: uuidSchema }).strict();
const createSchema = z
  .object({
    email: z.string().trim().email().max(320),
    displayName: z.string().trim().min(2).max(120),
    password: z.string().min(12).max(200),
  })
  .strict();
const statusSchema = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED', 'INACTIVE']) }).strict();
const dutySchema = z.object({ dutyStatus: z.enum(['ON_DUTY', 'OFF_DUTY']) }).strict();
const departmentSchema = z.object({ departmentId: uuidSchema }).strict();
const coverageSchema = z.discriminatedUnion('scopeType', [
  z.object({ scopeType: z.literal('HOSPITAL') }).strict(),
  z.object({ scopeType: z.literal('FLOOR'), floorId: uuidSchema }).strict(),
  z.object({ scopeType: z.literal('WARD'), wardId: uuidSchema }).strict(),
]);
const departmentParamsSchema = z.object({ id: uuidSchema, departmentId: uuidSchema }).strict();
const coverageParamsSchema = z.object({ id: uuidSchema, coverageId: uuidSchema }).strict();
const shiftQuerySchema = z
  .object({
    membershipId: uuidSchema.optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .strict();
const shiftSchema = z
  .object({
    membershipId: uuidSchema,
    departmentId: uuidSchema.optional(),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
  })
  .strict()
  .refine((shift) => shift.endsAt > shift.startsAt, { message: 'endsAt must be after startsAt.' })
  .refine((shift) => shift.endsAt.getTime() - shift.startsAt.getTime() <= maxShiftMs, {
    message: 'A shift can be at most 24 hours.',
  });

// Mounted under /admin.
export function createStaffRouter(staff: StaffService, shifts: ShiftService): Router {
  const router = Router();
  const canRead = requirePermission('staff.read');
  const canManage = requirePermission('staff.manage');

  router.get('/staff', canRead, async (request, response) => {
    const filter = listQuerySchema.parse(request.query);
    response.status(200).json({ staff: await staff.list(getStaffContext(request), filter) });
  });

  // Registered before /staff/:id so "eligible" is not parsed as an ID. A floor
  // or ward manager may check eligibility for beds inside their own scope.
  router.get(
    '/staff/eligible',
    requireScopedPermission('staff.read'),
    async (request, response) => {
      const query = eligibleQuerySchema.parse(request.query);
      response.status(200).json({ staff: await staff.eligible(getStaffContext(request), query) });
    },
  );

  router.get('/staff/:id', canRead, async (request, response) => {
    const { id } = idParamsSchema.parse(request.params);
    emptySchema.parse(request.query);
    response.status(200).json({ staff: await staff.get(getStaffContext(request), id) });
  });

  router.post('/staff', canManage, async (request, response) => {
    const input = createSchema.parse(request.body);
    const created = await staff.create(getStaffContext(request), input, getRequestId(response));
    response.status(201).json({ staff: created });
  });

  router.post('/staff/:id/status', canManage, async (request, response) => {
    const { id } = idParamsSchema.parse(request.params);
    const { status } = statusSchema.parse(request.body);
    const updated = await staff.setStatus(
      getStaffContext(request),
      id,
      status,
      getRequestId(response),
    );
    response.status(200).json({ staff: updated });
  });

  router.post('/staff/:id/duty', canManage, async (request, response) => {
    const { id } = idParamsSchema.parse(request.params);
    const { dutyStatus } = dutySchema.parse(request.body);
    const updated = await staff.setDuty(
      getStaffContext(request),
      id,
      dutyStatus,
      getRequestId(response),
    );
    response.status(200).json({ staff: updated });
  });

  router.post('/staff/:id/departments', canManage, async (request, response) => {
    const { id } = idParamsSchema.parse(request.params);
    const { departmentId } = departmentSchema.parse(request.body);
    const updated = await staff.addDepartment(
      getStaffContext(request),
      id,
      departmentId,
      getRequestId(response),
    );
    response.status(201).json({ staff: updated });
  });

  router.delete('/staff/:id/departments/:departmentId', canManage, async (request, response) => {
    const { id, departmentId } = departmentParamsSchema.parse(request.params);
    emptySchema.parse(request.body ?? {});
    const updated = await staff.removeDepartment(
      getStaffContext(request),
      id,
      departmentId,
      getRequestId(response),
    );
    response.status(200).json({ staff: updated });
  });

  router.post('/staff/:id/coverage', canManage, async (request, response) => {
    const { id } = idParamsSchema.parse(request.params);
    const input = coverageSchema.parse(request.body);
    const updated = await staff.addCoverage(
      getStaffContext(request),
      id,
      input,
      getRequestId(response),
    );
    response.status(201).json({ staff: updated });
  });

  router.delete('/staff/:id/coverage/:coverageId', canManage, async (request, response) => {
    const { id, coverageId } = coverageParamsSchema.parse(request.params);
    emptySchema.parse(request.body ?? {});
    const updated = await staff.removeCoverage(
      getStaffContext(request),
      id,
      coverageId,
      getRequestId(response),
    );
    response.status(200).json({ staff: updated });
  });

  router.get('/shifts', canRead, async (request, response) => {
    const filter = shiftQuerySchema.parse(request.query);
    response.status(200).json({ shifts: await shifts.list(getStaffContext(request), filter) });
  });

  router.post('/shifts', canManage, async (request, response) => {
    const input = shiftSchema.parse(request.body);
    const shift = await shifts.create(getStaffContext(request), input, getRequestId(response));
    response.status(201).json({ shift });
  });

  router.delete('/shifts/:id', canManage, async (request, response) => {
    const { id } = idParamsSchema.parse(request.params);
    emptySchema.parse(request.body ?? {});
    await shifts.delete(getStaffContext(request), id, getRequestId(response));
    response.status(204).send();
  });

  return router;
}
