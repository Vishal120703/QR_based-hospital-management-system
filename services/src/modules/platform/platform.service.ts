import { type HospitalStatus, type Prisma, type PrismaClient } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../common/errors/app-error.js';
import { hashPassword } from '../auth/password.js';
import { bootstrapHospital } from '../hospitals/bootstrap.js';
import { logoUrl, storeLogo } from '../hospitals/logo.js';
import { lockedRoleKey } from '../roles/built-in-roles.js';
import { type PlatformContext } from './platform-auth.service.js';

type Transaction = Prisma.TransactionClient;

export interface NewHospitalInput {
  readonly name: string;
  readonly code: string;
  readonly timezone: string;
  readonly managerName: string;
  readonly managerEmail: string;
  readonly managerPassword: string;
}

export interface HospitalUpdate {
  readonly name?: string | undefined;
  readonly timezone?: string | undefined;
  readonly status?: Extract<HospitalStatus, 'ACTIVE' | 'SUSPENDED'> | undefined;
}

// Platform actions are audited in the hospital they change.
async function recordPlatformAudit(
  transaction: Transaction,
  context: PlatformContext,
  requestId: string,
  hospitalId: string,
  action: string,
  metadata: Prisma.InputJsonObject,
): Promise<void> {
  await transaction.auditLog.create({
    data: {
      hospitalId,
      actorType: 'PLATFORM',
      actorPlatformUserId: context.userId,
      action,
      targetType: 'Hospital',
      targetId: hospitalId,
      metadata,
      requestId,
    },
  });
}

// Manages client hospitals for the SaaS operator. It never reads patients,
// requests, or other clinical data beyond simple counts.
export class PlatformService {
  public constructor(private readonly database: PrismaClient) {}

  public async listHospitals() {
    const [hospitals, beds, staff, openRequests] = await Promise.all([
      this.database.hospital.findMany({
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          code: true,
          timezone: true,
          status: true,
          createdAt: true,
          logo: { select: { publicId: true } },
        },
      }),
      this.database.bed.groupBy({ by: ['hospitalId'], where: { active: true }, _count: true }),
      this.database.hospitalMembership.groupBy({
        by: ['hospitalId'],
        where: { status: 'ACTIVE' },
        _count: true,
      }),
      this.database.serviceRequest.groupBy({
        by: ['hospitalId'],
        where: { status: { in: ['SUBMITTED', 'ASSIGNED', 'ACCEPTED', 'IN_PROGRESS'] } },
        _count: true,
      }),
    ]);
    const countOf = (rows: { hospitalId: string; _count: number }[], id: string) =>
      rows.find((row) => row.hospitalId === id)?._count ?? 0;
    return hospitals.map(({ logo, ...hospital }) => ({
      ...hospital,
      logoUrl: logoUrl(logo?.publicId),
      activeBeds: countOf(beds, hospital.id),
      activeStaff: countOf(staff, hospital.id),
      openRequests: countOf(openRequests, hospital.id),
    }));
  }

  public async getHospital(id: string) {
    const hospital = await this.database.hospital.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        code: true,
        timezone: true,
        status: true,
        createdAt: true,
        logo: { select: { publicId: true } },
      },
    });
    if (!hospital) throw new NotFoundError();
    const managers = await this.database.userRole.findMany({
      where: { hospitalId: id, role: { systemKey: lockedRoleKey } },
      select: {
        membership: {
          select: {
            id: true,
            status: true,
            user: { select: { email: true, displayName: true } },
          },
        },
      },
    });
    const { logo, ...rest } = hospital;
    return {
      ...rest,
      logoUrl: logoUrl(logo?.publicId),
      managers: managers.map(({ membership }) => ({
        membershipId: membership.id,
        status: membership.status,
        email: membership.user.email,
        displayName: membership.user.displayName,
      })),
    };
  }

  // Creates a client hospital with its built-in roles, starter departments and
  // services, and its first Hospital Manager.
  public async createHospital(
    context: PlatformContext,
    input: NewHospitalInput,
    requestId: string,
  ) {
    const { hospitalId } = await bootstrapHospital(
      this.database,
      {
        name: input.name,
        code: input.code,
        timezone: input.timezone,
        adminEmail: input.managerEmail,
        adminName: input.managerName,
        adminPassword: input.managerPassword,
      },
      async (transaction, created) => {
        await recordPlatformAudit(
          transaction,
          context,
          requestId,
          created.hospitalId,
          'platform.hospital.create',
          {
            code: input.code.toUpperCase(),
            managerEmail: input.managerEmail.toLowerCase(),
          },
        );
      },
    );
    return this.getHospital(hospitalId);
  }

  public async updateHospital(
    context: PlatformContext,
    id: string,
    input: HospitalUpdate,
    requestId: string,
  ) {
    await this.database.$transaction(
      async (transaction) => {
        const before = await transaction.hospital.findUnique({ where: { id } });
        if (!before) throw new NotFoundError();
        const after = await transaction.hospital.update({
          where: { id },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
            ...(input.status !== undefined ? { status: input.status } : {}),
          },
        });
        // Suspending signs everyone out straight away; patients' QR access
        // stops too, because every guest request checks the hospital status.
        const revokedStaffSessions =
          input.status === 'SUSPENDED' && before.status !== 'SUSPENDED'
            ? (
                await transaction.staffSession.updateMany({
                  where: { hospitalId: id, revokedAt: null },
                  data: { revokedAt: new Date() },
                })
              ).count
            : 0;
        await recordPlatformAudit(transaction, context, requestId, id, 'platform.hospital.update', {
          before: { name: before.name, timezone: before.timezone, status: before.status },
          after: { name: after.name, timezone: after.timezone, status: after.status },
          revokedStaffSessions,
        });
      },
      { isolationLevel: 'Serializable' },
    );
    return this.getHospital(id);
  }

  public async setLogo(context: PlatformContext, id: string, bytes: Uint8Array, requestId: string) {
    return this.database.$transaction(async (transaction) => {
      if (!(await transaction.hospital.findUnique({ where: { id } }))) throw new NotFoundError();
      const stored = await storeLogo(transaction, id, bytes);
      await recordPlatformAudit(transaction, context, requestId, id, 'platform.hospital.logo', {
        contentType: stored.contentType,
        byteSize: stored.byteSize,
      });
      return { logoUrl: logoUrl(stored.publicId) };
    });
  }

  public async removeLogo(context: PlatformContext, id: string, requestId: string) {
    await this.database.$transaction(async (transaction) => {
      const removed = await transaction.hospitalLogo.deleteMany({ where: { hospitalId: id } });
      if (removed.count === 0) throw new NotFoundError('This hospital has no logo.');
      await recordPlatformAudit(
        transaction,
        context,
        requestId,
        id,
        'platform.hospital.logo.remove',
        {},
      );
    });
  }

  // Adds another Hospital Manager, for example when the first one leaves.
  public async addManager(
    context: PlatformContext,
    hospitalId: string,
    input: { displayName: string; email: string; password: string },
    requestId: string,
  ) {
    const email = input.email.trim().toLowerCase();
    const passwordHash = await hashPassword(input.password);
    await this.database.$transaction(
      async (transaction) => {
        const role = await transaction.role.findUnique({
          where: { hospitalId_systemKey: { hospitalId, systemKey: lockedRoleKey } },
        });
        if (!role) throw new NotFoundError();
        if (await transaction.user.findUnique({ where: { email } })) {
          throw new ConflictError('This email already has a CARE QR account.');
        }
        const user = await transaction.user.create({
          data: { email, displayName: input.displayName.trim(), passwordHash },
        });
        const membership = await transaction.hospitalMembership.create({
          data: { hospitalId, userId: user.id },
        });
        const userRole = await transaction.userRole.create({
          data: { hospitalId, membershipId: membership.id, roleId: role.id },
        });
        await transaction.scopeAssignment.create({
          data: { hospitalId, userRoleId: userRole.id, scopeType: 'HOSPITAL', scopeId: hospitalId },
        });
        await recordPlatformAudit(
          transaction,
          context,
          requestId,
          hospitalId,
          'platform.manager.add',
          {
            email,
            membershipId: membership.id,
          },
        );
      },
      { isolationLevel: 'Serializable' },
    );
    return this.getHospital(hospitalId);
  }
}
