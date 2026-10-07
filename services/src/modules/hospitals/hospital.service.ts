import { type PrismaClient } from '@prisma/client';
import { NotFoundError } from '../../common/errors/app-error.js';
import { recordStaffAudit } from '../audit/index.js';
import { type StaffContext } from '../auth/index.js';
import { HospitalRepository } from './hospital.repository.js';
import { type UpdateHospitalInput } from './hospital.schemas.js';
import { logoUrl, storeLogo } from './logo.js';

// The signed-in staff member's own hospital: its profile and logo.
export class HospitalService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly hospitals = new HospitalRepository(),
  ) {}

  public async getCurrent(context: StaffContext) {
    const hospital = await this.hospitals.findProfile(this.database, context.tenant.hospitalId);
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
      if ((await this.hospitals.deleteLogo(transaction, hospitalId)) === 0) {
        throw new NotFoundError('This hospital has no logo.');
      }
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
    return this.hospitals.findLogo(this.database, publicId);
  }

  public async updateCurrent(context: StaffContext, input: UpdateHospitalInput, requestId: string) {
    const hospitalId = context.tenant.hospitalId;
    return this.database.$transaction(
      async (transaction) => {
        const before = await this.hospitals.findActive(transaction, hospitalId);
        if (!before) {
          throw new NotFoundError();
        }
        const after = await this.hospitals.updateProfile(transaction, hospitalId, {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
        });
        await recordStaffAudit(transaction, context, requestId, {
          action: 'hospital.update',
          targetType: 'Hospital',
          targetId: hospitalId,
          metadata: {
            before: { name: before.name, timezone: before.timezone },
            after: { name: after.name, timezone: after.timezone },
          },
        });
        return after;
      },
      { isolationLevel: 'Serializable' },
    );
  }
}
