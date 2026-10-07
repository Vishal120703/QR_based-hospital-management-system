import {
  type ClientStatus,
  type HospitalStatus,
  type Prisma,
  type PrismaClient,
} from '@prisma/client';
import { ConflictError, NotFoundError } from '../../common/errors/app-error.js';
import { hashPassword } from '../auth/password.js';
import { bootstrapHospital, type NewClientInput } from '../hospitals/bootstrap.js';
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
  // Either an existing client, or a new client to create with the hospital.
  // Without both, the hospital becomes its own new client.
  readonly clientId?: string | undefined;
  readonly client?: NewClientInput | undefined;
}

export interface ClientUpdate {
  readonly name?: string | undefined;
  readonly contactName?: string | null | undefined;
  readonly contactEmail?: string | null | undefined;
  readonly contactPhone?: string | null | undefined;
  readonly status?: ClientStatus | undefined;
}

export interface HospitalUpdate {
  readonly name?: string | undefined;
  readonly timezone?: string | undefined;
  readonly status?: Extract<HospitalStatus, 'ACTIVE' | 'SUSPENDED'> | undefined;
  // Moves the hospital to another client (for example after an acquisition).
  readonly clientId?: string | undefined;
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

function withTotals<T extends object>(
  client: T,
  hospitals: readonly { activeBeds: number; activeStaff: number; openRequests: number }[],
) {
  const sum = (pick: (hospital: (typeof hospitals)[number]) => number) =>
    hospitals.reduce((total, hospital) => total + pick(hospital), 0);
  return {
    ...client,
    hospitalCount: hospitals.length,
    activeBeds: sum((hospital) => hospital.activeBeds),
    activeStaff: sum((hospital) => hospital.activeStaff),
    openRequests: sum((hospital) => hospital.openRequests),
  };
}

// The super admin's work: clients (customers) and their hospitals. It never
// reads patients, requests, or other clinical data beyond simple counts.
export class PlatformService {
  public constructor(private readonly database: PrismaClient) {}

  // Hospitals with their client and simple size counts, never clinical data.
  private async hospitalSummaries(where: Prisma.HospitalWhereInput = {}) {
    const hospitals = await this.database.hospital.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        code: true,
        timezone: true,
        status: true,
        createdAt: true,
        logo: { select: { publicId: true } },
        client: { select: { id: true, name: true, code: true, status: true } },
      },
    });
    const ids = hospitals.map((hospital) => hospital.id);
    const [beds, staff, openRequests] = await Promise.all([
      this.database.bed.groupBy({
        by: ['hospitalId'],
        where: { hospitalId: { in: ids }, active: true },
        _count: true,
      }),
      this.database.hospitalMembership.groupBy({
        by: ['hospitalId'],
        where: { hospitalId: { in: ids }, status: 'ACTIVE' },
        _count: true,
      }),
      this.database.serviceRequest.groupBy({
        by: ['hospitalId'],
        where: {
          hospitalId: { in: ids },
          status: { in: ['SUBMITTED', 'ASSIGNED', 'ACCEPTED', 'IN_PROGRESS'] },
        },
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

  public async listHospitals() {
    return this.hospitalSummaries();
  }

  // Clients with how many hospitals, beds, staff, and open requests they have.
  public async listClients() {
    const [clients, hospitals] = await Promise.all([
      this.database.client.findMany({ orderBy: { createdAt: 'desc' } }),
      this.hospitalSummaries(),
    ]);
    return clients.map((client) =>
      withTotals(
        client,
        hospitals.filter((hospital) => hospital.client.id === client.id),
      ),
    );
  }

  public async getClient(id: string) {
    const client = await this.database.client.findUnique({ where: { id } });
    if (!client) throw new NotFoundError();
    const hospitals = await this.hospitalSummaries({ clientId: id });
    return { ...withTotals(client, hospitals), hospitals };
  }

  // Changes a client's details or status. Suspending a client closes all its
  // hospitals at once (staff are signed out, QR codes stop) without changing
  // each hospital's own status, so reactivating restores exactly what was there.
  public async updateClient(
    context: PlatformContext,
    id: string,
    input: ClientUpdate,
    requestId: string,
  ) {
    await this.database.$transaction(
      async (transaction) => {
        const before = await transaction.client.findUnique({
          where: { id },
          include: { hospitals: { select: { id: true } } },
        });
        if (!before) throw new NotFoundError();
        const after = await transaction.client.update({
          where: { id },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.contactName !== undefined ? { contactName: input.contactName } : {}),
            ...(input.contactEmail !== undefined
              ? { contactEmail: input.contactEmail?.toLowerCase() ?? null }
              : {}),
            ...(input.contactPhone !== undefined ? { contactPhone: input.contactPhone } : {}),
            ...(input.status !== undefined ? { status: input.status } : {}),
          },
        });
        const hospitalIds = before.hospitals.map((hospital) => hospital.id);
        const revokedStaffSessions =
          input.status === 'SUSPENDED' && before.status !== 'SUSPENDED'
            ? (
                await transaction.staffSession.updateMany({
                  where: { hospitalId: { in: hospitalIds }, revokedAt: null },
                  data: { revokedAt: new Date() },
                })
              ).count
            : 0;
        const view = (client: typeof after) => ({
          name: client.name,
          status: client.status,
          contactName: client.contactName,
          contactEmail: client.contactEmail,
          contactPhone: client.contactPhone,
        });
        // Recorded in each hospital's audit log, where its managers can see it.
        for (const hospitalId of hospitalIds) {
          await recordPlatformAudit(
            transaction,
            context,
            requestId,
            hospitalId,
            'platform.client.update',
            { clientId: id, before: view(before), after: view(after), revokedStaffSessions },
          );
        }
      },
      { isolationLevel: 'Serializable' },
    );
    return this.getClient(id);
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
        client: { select: { id: true, name: true, code: true, status: true } },
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
        ...(input.clientId
          ? { client: { id: input.clientId } }
          : input.client
            ? { client: input.client }
            : {}),
      },
      async (transaction, created) => {
        if (created.newClient) {
          await recordPlatformAudit(
            transaction,
            context,
            requestId,
            created.hospitalId,
            'platform.client.create',
            { clientId: created.clientId, name: input.client?.name ?? input.name },
          );
        }
        await recordPlatformAudit(
          transaction,
          context,
          requestId,
          created.hospitalId,
          'platform.hospital.create',
          {
            code: input.code.toUpperCase(),
            managerEmail: input.managerEmail.toLowerCase(),
            clientId: created.clientId,
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
        if (input.clientId !== undefined && input.clientId !== before.clientId) {
          const target = await transaction.client.findUnique({ where: { id: input.clientId } });
          if (!target) throw new NotFoundError('The client was not found.');
          if (target.status !== 'ACTIVE') {
            throw new ConflictError('Reactivate that client before moving a hospital to it.');
          }
        }
        const after = await transaction.hospital.update({
          where: { id },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
            ...(input.status !== undefined ? { status: input.status } : {}),
            ...(input.clientId !== undefined ? { clientId: input.clientId } : {}),
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
          before: {
            name: before.name,
            timezone: before.timezone,
            status: before.status,
            clientId: before.clientId,
          },
          after: {
            name: after.name,
            timezone: after.timezone,
            status: after.status,
            clientId: after.clientId,
          },
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
