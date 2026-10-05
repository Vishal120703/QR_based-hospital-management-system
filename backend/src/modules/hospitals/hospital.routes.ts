import { Router } from 'express';
import { z } from 'zod';
import { UnauthorizedError } from '../../common/errors/app-error.js';
import { requirePermission } from '../../middleware/staff-auth.js';
import type { HospitalService } from './hospital.service.js';

const updateHospitalSchema = z
  .object({
    name: z.string().trim().min(2).max(200).optional(),
    timezone: z
      .string()
      .refine((value) => {
        try {
          new Intl.DateTimeFormat('en-US', { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, 'Invalid IANA time zone')
      .optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required.');

export function createHospitalRouter(hospitals: HospitalService): Router {
  const router = Router();

  router.get('/hospital', requirePermission('hospital.read'), async (request, response) => {
    const context = request.staff;
    if (!context) throw new UnauthorizedError();
    z.object({}).strict().parse(request.query);
    response.status(200).json({ hospital: await hospitals.getCurrent(context) });
  });

  router.patch('/hospital', requirePermission('hospital.manage'), async (request, response) => {
    const context = request.staff;
    if (!context) throw new UnauthorizedError();
    const input = updateHospitalSchema.parse(request.body);
    const hospital = await hospitals.updateCurrent(
      context,
      input,
      String(response.getHeader('x-request-id')),
    );
    response.status(200).json({ hospital });
  });

  return router;
}
