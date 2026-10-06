import { type PrismaClient } from '@prisma/client';
import { NotFoundError } from '../../common/errors/app-error.js';
import { recordStaffAudit } from '../audit/audit-log.js';
import { type StaffContext } from '../auth/auth.service.js';
import { logoUrl, storeLogo } from './logo.js';

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
        logo: { select: { publicId: true, byteSize: true, updatedAt: true } },
      },
    });
    if (!hospital) {
      throw new NotFoundError();
    }
    const { logo, ...rest } = hospital;
    return {
      ...rest,
      logoUrl: logoUrl(logo?.publicId),
      logoUpdatedAt: logo?.updatedAt ?? null,
    };
  }

  public setLogo(context: StaffContext, bytes: Uint8Array, requestId: string) {
    const hospitalId = context.tenant.hospitalId;
    return this.database.$transaction(async (transaction) => {
      const stored = await storeLogo(transaction, hospitalId, bytes);
      await recordStaffAudit(transaction, context, requestId, {
        action: 'hospital.logo.update',
        targetType: 'Hospital',
        targetId: hospitalId,
        metadata: { contentType: stored.contentType, byteSize: stored.byteSize },
      });
      return { logoUrl: logoUrl(stored.publicId) };
    });
  }

  public removeLogo(context: StaffContext, requestId: string) {
    const hospitalId = context.tenant.hospitalId;
    return this.database.$transaction(async (transaction) => {
      const removed = await transaction.hospitalLogo.deleteMany({ where: { hospitalId } });
      if (removed.count === 0) throw new NotFoundError('This hospital has no logo.');
      await recordStaffAudit(transaction, context, requestId, {
        action: 'hospital.logo.remove',
        targetType: 'Hospital',
        targetId: hospitalId,
        metadata: {},
      });
    });
  }

  // Public read by the unguessable per-upload id; no tenant context needed.
  public readLogo(publicId: string) {
    return this.database.hospitalLogo.findUnique({
      where: { publicId },
      select: { contentType: true, data: true },
    });
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
