import { type PrismaClient } from '@prisma/client';
import { NotFoundError } from '../../common/errors/app-error.js';
import { type StaffContext } from '../auth/auth.service.js';

export class HospitalService {
  public constructor(private readonly database: PrismaClient) {}

  public async getCurrent(context: StaffContext) {
    const hospital = await this.database.hospital.findFirst({
      where: { id: context.tenant.hospitalId },
      select: {
        id: true,
        name: true,
        code: true,
        timezone: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!hospital) {
      throw new NotFoundError();
    }
    return hospital;
  }

  public async updateCurrent(
    context: StaffContext,
    input: { name?: string | undefined; timezone?: string | undefined },
    requestId: string,
  ) {
    const hospitalId = context.tenant.hospitalId;
    return this.database.$transaction(
      async (transaction) => {
        const before = await transaction.hospital.findFirst({
          where: { id: hospitalId, status: 'ACTIVE' },
        });
        if (!before) {
          throw new NotFoundError();
        }
        const after = await transaction.hospital.update({
          where: { id: hospitalId },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
          },
        });
        await transaction.auditLog.create({
          data: {
            hospitalId,
            actorType: 'STAFF',
            actorMembershipId: context.membershipId,
            action: 'hospital.update',
            targetType: 'Hospital',
            targetId: hospitalId,
            metadata: {
              before: { name: before.name, timezone: before.timezone },
              after: { name: after.name, timezone: after.timezone },
            },
            requestId,
          },
        });
        return after;
      },
      { isolationLevel: 'Serializable' },
    );
  }
}
