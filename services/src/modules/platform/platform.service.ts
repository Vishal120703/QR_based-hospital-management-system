import { type Prisma, type PrismaClient } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../common/errors/app-error.js';
import { pageResult, pageWindow } from '../../common/pagination.js';
import { recordPlatformAudit } from '../audit/index.js';
import { hashPassword, revokeHospitalSessions } from '../auth/index.js';
import { bootstrapHospital, logoUrl, removeLogo, storeLogo } from '../hospitals/index.js';
import { grantRole, lockedRoleKey } from '../roles/index.js';
import { createStaffAccount } from '../staff/index.js';
import { type PlatformContext } from './platform-auth.service.js';
import { PlatformRepository } from './platform.repository.js';
import {
  type AddManagerInput,
  type CreateHospitalInput,
  type UpdateClientInput,
  type UpdateHospitalInput,
  type PlatformListQuery,
} from './platform.schemas.js';
import {
  clientAuditSnapshot,
  countsByHospital,
  hospitalAuditSnapshot,
  withClientTotals,
} from './platform-view.js';

type Transaction = Prisma.TransactionClient;

// The super admin's work: clients (customers) and their hospitals. It never
// reads patients, requests, or other clinical data beyond simple counts.
export class PlatformService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly platform = new PlatformRepository(),
  ) {}

  // Platform actions are audited in the hospital they change.
  private audit(
    transaction: Transaction,
    context: PlatformContext,
    requestId: string,
    hospitalId: string,
    action: string,
    metadata: Prisma.InputJsonObject,
  ): Promise<void> {
    return recordPlatformAudit(transaction, {
      platformUserId: context.userId,
      hospitalId,
      requestId,
      action,
      metadata,
    });
  }

  // Hospitals with their client and simple size counts, never clinical data.
  private async hospitalSummaries(
    where: Prisma.HospitalWhereInput = {},
    page = { skip: 0, take: 100 },
  ) {
    const hospitals = await this.platform.listHospitals(this.database, where, page);
    const [beds, staff, openRequests] = await this.platform.countByHospital(
      this.database,
      hospitals.map((hospital) => hospital.id),
    );
    const bedCounts = countsByHospital(beds);
    const staffCounts = countsByHospital(staff);
    const requestCounts = countsByHospital(openRequests);
    return hospitals.map(({ logo, ...hospital }) => ({
      ...hospital,
      logoUrl: logoUrl(logo?.publicId),
      activeBeds: bedCounts.get(hospital.id) ?? 0,
      activeStaff: staffCounts.get(hospital.id) ?? 0,
      openRequests: requestCounts.get(hospital.id) ?? 0,
    }));
  }

  public async listHospitals(query: PlatformListQuery) {
    const where: Prisma.HospitalWhereInput = query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { code: { contains: query.search, mode: 'insensitive' } },
            { client: { name: { contains: query.search, mode: 'insensitive' } } },
          ],
        }
      : {};
    const [items, total] = await Promise.all([
      this.hospitalSummaries(where, pageWindow(query)),
      this.platform.countHospitals(this.database, where),
    ]);
    return pageResult(items, query, total);
  }

  // Clients with how many hospitals, beds, staff, and open requests they have.
  public async listClients(query: PlatformListQuery) {
    const where: Prisma.ClientWhereInput = query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { code: { contains: query.search, mode: 'insensitive' } },
            { contactName: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {};
    const [clients, total] = await Promise.all([
      this.platform.listClients(this.database, where, pageWindow(query)),
      this.platform.countClients(this.database, where),
    ]);
    const hospitals = await this.hospitalSummaries(
      { clientId: { in: clients.map((client) => client.id) } },
      { skip: 0, take: 1_000 },
    );
    const items = clients.map((client) =>
      withClientTotals(
        client,
        hospitals.filter((hospital) => hospital.client.id === client.id),
      ),
    );
    return pageResult(items, query, total);
  }

  public async getClient(id: string) {
    const client = await this.platform.findClient(this.database, id);
    if (!client) throw new NotFoundError();
    const hospitals = await this.hospitalSummaries({ clientId: id }, { skip: 0, take: 1_000 });
    return { ...withClientTotals(client, hospitals), hospitals };
  }

  // Changes a client's details or status. Suspending a client closes all its
  // hospitals at once (staff are signed out, QR codes stop) without changing
  // each hospital's own status, so reactivating restores exactly what was there.
  public async updateClient(
    context: PlatformContext,
    id: string,
    input: UpdateClientInput,
    requestId: string,
  ) {
    await this.database.$transaction(
      async (transaction) => {
        const before = await this.platform.findClientWithHospitals(transaction, id);
        if (!before) throw new NotFoundError();
        const after = await this.platform.updateClient(transaction, id, {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.contactName !== undefined ? { contactName: input.contactName } : {}),
          ...(input.contactEmail !== undefined
            ? { contactEmail: input.contactEmail?.toLowerCase() ?? null }
            : {}),
          ...(input.contactPhone !== undefined ? { contactPhone: input.contactPhone } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        });
        const hospitalIds = before.hospitals.map((hospital) => hospital.id);
        const revokedStaffSessions =
          input.status === 'SUSPENDED' && before.status !== 'SUSPENDED'
            ? await revokeHospitalSessions(transaction, hospitalIds)
            : 0;
        // Recorded in each hospital's audit log, where its managers can see it.
        for (const hospitalId of hospitalIds) {
          await this.audit(transaction, context, requestId, hospitalId, 'platform.client.update', {
            clientId: id,
            before: clientAuditSnapshot(before),
            after: clientAuditSnapshot(after),
            revokedStaffSessions,
          });
        }
      },
      { isolationLevel: 'Serializable' },
    );
    return this.getClient(id);
  }

  public async getHospital(id: string) {
    const hospital = await this.platform.findHospitalDetail(this.database, id);
    if (!hospital) throw new NotFoundError();
    const managers = await this.platform.findRoleHolders(this.database, id, lockedRoleKey);
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

  // Creates a hospital with its built-in roles, starter departments and
  // services, and its first Hospital Manager, for a new or existing client.
  public async createHospital(
    context: PlatformContext,
    input: CreateHospitalInput,
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
          await this.audit(
            transaction,
            context,
            requestId,
            created.hospitalId,
            'platform.client.create',
            { clientId: created.clientId, name: input.client?.name ?? input.name },
          );
        }
        await this.audit(
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
    input: UpdateHospitalInput,
    requestId: string,
  ) {
    await this.database.$transaction(
      async (transaction) => {
        const before = await this.platform.findHospital(transaction, id);
        if (!before) throw new NotFoundError();
        if (input.clientId !== undefined && input.clientId !== before.clientId) {
          const target = await this.platform.findClient(transaction, input.clientId);
          if (!target) throw new NotFoundError('The client was not found.');
          if (target.status !== 'ACTIVE') {
            throw new ConflictError('Reactivate that client before moving a hospital to it.');
          }
        }
        const after = await this.platform.updateHospital(transaction, id, {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.clientId !== undefined ? { clientId: input.clientId } : {}),
        });
        // Suspending signs everyone out straight away; patients' QR access
        // stops too, because every guest request checks the hospital status.
        const revokedStaffSessions =
          input.status === 'SUSPENDED' && before.status !== 'SUSPENDED'
            ? await revokeHospitalSessions(transaction, [id])
            : 0;
        await this.audit(transaction, context, requestId, id, 'platform.hospital.update', {
          before: hospitalAuditSnapshot(before),
          after: hospitalAuditSnapshot(after),
          revokedStaffSessions,
        });
      },
      { isolationLevel: 'Serializable' },
    );
    return this.getHospital(id);
  }

  public async setLogo(context: PlatformContext, id: string, bytes: Uint8Array, requestId: string) {
    return this.database.$transaction(async (transaction) => {
      if (!(await this.platform.findHospital(transaction, id))) throw new NotFoundError();
      const stored = await storeLogo(transaction, id, bytes);
      await this.audit(transaction, context, requestId, id, 'platform.hospital.logo', {
        contentType: stored.contentType,
        byteSize: stored.byteSize,
      });
      return { logoUrl: logoUrl(stored.publicId) };
    });
  }

  public async removeLogo(context: PlatformContext, id: string, requestId: string) {
    await this.database.$transaction(async (transaction) => {
      if (!(await removeLogo(transaction, id))) {
        throw new NotFoundError('This hospital has no logo.');
      }
      await this.audit(transaction, context, requestId, id, 'platform.hospital.logo.remove', {});
    });
  }

  // Adds another Hospital Manager, for example when the first one leaves.
  public async addManager(
    context: PlatformContext,
    hospitalId: string,
    input: AddManagerInput,
    requestId: string,
  ) {
    const passwordHash = await hashPassword(input.password);
    await this.database.$transaction(
      async (transaction) => {
        const role = await this.platform.findRoleBySystemKey(
          transaction,
          hospitalId,
          lockedRoleKey,
        );
        if (!role) throw new NotFoundError();
        const account = await createStaffAccount(transaction, {
          hospitalId,
          email: input.email,
          displayName: input.displayName,
          passwordHash,
        });
        await grantRole(transaction, {
          hospitalId,
          membershipId: account.membershipId,
          roleId: role.id,
          scopeType: 'HOSPITAL',
          scopeId: hospitalId,
        });
        await this.audit(transaction, context, requestId, hospitalId, 'platform.manager.add', {
          email: input.email.trim().toLowerCase(),
          membershipId: account.membershipId,
        });
      },
      { isolationLevel: 'Serializable' },
    );
    return this.getHospital(hospitalId);
  }
}
