import {
  type DutyStatus,
  type MembershipStatus,
  type Prisma,
  type PrismaClient,
} from '@prisma/client';
import { ConflictError, ForbiddenError, NotFoundError } from '../../common/errors/app-error.js';
import { recordStaffAudit } from '../audit/audit-log.js';
import { canAccessLocation, revokeStaffSessions, type StaffContext } from '../auth/auth.service.js';
import { hashPassword } from '../auth/password.js';
import { lockedRoleKey } from '../roles/built-in-roles.js';
import { findEligibleStaff } from './eligibility.js';

// A staff member is a HospitalMembership; the User is the global identity.
const staffSelect = {
  id: true,
  status: true,
  dutyStatus: true,
  dutyChangedAt: true,
  createdAt: true,
  user: { select: { id: true, email: true, displayName: true, status: true } },
  departments: { select: { departmentId: true }, orderBy: { createdAt: 'asc' } },
  locationScopes: {
    select: { id: true, scopeType: true, floorId: true, wardId: true },
    orderBy: { createdAt: 'asc' },
  },
  userRoles: {
    select: { roleId: true, scopes: { select: { scopeType: true, scopeId: true } } },
  },
} satisfies Prisma.HospitalMembershipSelect;

type StaffRow = Prisma.HospitalMembershipGetPayload<{ select: typeof staffSelect }>;

function toView(row: StaffRow) {
  return {
    id: row.id,
    userId: row.user.id,
    email: row.user.email,
    displayName: row.user.displayName,
    userStatus: row.user.status,
    status: row.status,
    dutyStatus: row.dutyStatus,
    dutyChangedAt: row.dutyChangedAt,
    createdAt: row.createdAt,
    departmentIds: row.departments.map((item) => item.departmentId),
    coverage: row.locationScopes,
    roleIds: row.userRoles.map((item) => item.roleId),
    // Where each role applies: the hospital, or specific floors, wards, or departments.
    roleAssignments: row.userRoles.map((item) => ({
      roleId: item.roleId,
      scopes: item.scopes.map((scope) => ({ type: scope.scopeType, id: scope.scopeId })),
    })),
  };
}

export type CoverageInput =
  | { readonly scopeType: 'HOSPITAL' }
  | { readonly scopeType: 'FLOOR'; readonly floorId: string }
  | { readonly scopeType: 'WARD'; readonly wardId: string };

export interface StaffFilter {
  readonly status?: MembershipStatus | undefined;
  readonly dutyStatus?: DutyStatus | undefined;
  readonly departmentId?: string | undefined;
}

// Only a Hospital Manager may deactivate another Hospital Manager, and the
// hospital must keep at least one active one.
async function requireManagerSafeToDeactivate(
  transaction: Prisma.TransactionClient,
  context: StaffContext,
  membershipId: string,
): Promise<void> {
  const hospitalId = context.tenant.hospitalId;
  const managerRole = { hospitalId, role: { systemKey: lockedRoleKey } };
  const isManager = await transaction.userRole.count({
    where: { ...managerRole, membershipId },
  });
  if (isManager === 0) return;
  if (!context.hospitalPermissions.has('role.manage')) throw new ForbiddenError();
  const others = await transaction.userRole.count({
    where: {
      ...managerRole,
      membershipId: { not: membershipId },
      membership: { status: 'ACTIVE' },
    },
  });
  if (others === 0) {
    throw new ConflictError('A hospital must keep at least one active Hospital Manager.');
  }
}

export class StaffService {
  public constructor(private readonly database: PrismaClient) {}

  public async list(context: StaffContext, filter: StaffFilter) {
    const rows = await this.database.hospitalMembership.findMany({
      where: {
        hospitalId: context.tenant.hospitalId,
        ...(filter.status !== undefined ? { status: filter.status } : {}),
        ...(filter.dutyStatus !== undefined ? { dutyStatus: filter.dutyStatus } : {}),
        ...(filter.departmentId !== undefined
          ? { departments: { some: { departmentId: filter.departmentId } } }
          : {}),
      },
      select: staffSelect,
      orderBy: { user: { displayName: 'asc' } },
    });
    return rows.map(toView);
  }

  public async get(context: StaffContext, id: string) {
    return toView(await this.requireMember(this.database, context, id));
  }

  public async eligible(context: StaffContext, query: { bedId: string; departmentId: string }) {
    const hospitalId = context.tenant.hospitalId;
    const bed = await this.database.bed.findUnique({
      where: { hospitalId_id: { hospitalId, id: query.bedId } },
      select: { wardId: true, ward: { select: { floorId: true } } },
    });
    if (
      !bed ||
      !canAccessLocation(context, 'staff.read', {
        wardId: bed.wardId,
        floorId: bed.ward.floorId,
        departmentId: query.departmentId,
      })
    ) {
      throw new NotFoundError();
    }
    return findEligibleStaff(this.database, hospitalId, query);
  }

  // Creates a new person and their membership in this hospital. Linking an
  // existing user from another hospital needs a platform-level flow (deferred).
  public async create(
    context: StaffContext,
    input: { email: string; displayName: string; password: string },
    requestId: string,
  ) {
    const hospitalId = context.tenant.hospitalId;
    const email = input.email.trim().toLowerCase();
    const passwordHash = await hashPassword(input.password);
    return this.database.$transaction(async (transaction) => {
      if (await transaction.user.findUnique({ where: { email } })) {
        throw new ConflictError('A user with this email already exists.');
      }
      const user = await transaction.user.create({
        data: { email, displayName: input.displayName, passwordHash },
      });
      const membership = await transaction.hospitalMembership.create({
        data: { hospitalId, userId: user.id },
      });
      await recordStaffAudit(transaction, context, requestId, {
        action: 'staff.create',
        targetType: 'HospitalMembership',
        targetId: membership.id,
        metadata: { userId: user.id, email, displayName: input.displayName },
      });
      return toView(await this.requireMember(transaction, context, membership.id));
    });
  }

  public setStatus(context: StaffContext, id: string, status: MembershipStatus, requestId: string) {
    if (id === context.membershipId) {
      throw new ConflictError('You cannot change your own status.');
    }
    const hospitalId = context.tenant.hospitalId;
    return this.database.$transaction(
      async (transaction) => {
        const before = await this.requireMember(transaction, context, id);
        const deactivating = status !== 'ACTIVE';
        if (deactivating && before.status === 'ACTIVE') {
          await requireManagerSafeToDeactivate(transaction, context, id);
        }
        await transaction.hospitalMembership.update({
          where: { hospitalId_id: { hospitalId, id } },
          data: {
            status,
            // Staff who are not active cannot be on duty or keep signed-in sessions.
            ...(deactivating && before.dutyStatus === 'ON_DUTY'
              ? { dutyStatus: 'OFF_DUTY', dutyChangedAt: new Date() }
              : {}),
          },
        });
        const revokedSessions = deactivating
          ? await revokeStaffSessions(transaction, hospitalId, id)
          : 0;
        await recordStaffAudit(transaction, context, requestId, {
          action: 'staff.status',
          targetType: 'HospitalMembership',
          targetId: id,
          metadata: { from: before.status, to: status, revokedSessions },
        });
        return toView(await this.requireMember(transaction, context, id));
      },
      { isolationLevel: 'Serializable' },
    );
  }

  public setDuty(context: StaffContext, id: string, dutyStatus: DutyStatus, requestId: string) {
    const hospitalId = context.tenant.hospitalId;
    return this.database.$transaction(
      async (transaction) => {
        const before = await this.requireMember(transaction, context, id);
        if (before.dutyStatus === dutyStatus) {
          return toView(before);
        }
        if (
          dutyStatus === 'ON_DUTY' &&
          (before.status !== 'ACTIVE' || before.user.status !== 'ACTIVE')
        ) {
          throw new ConflictError('Only active staff can go on duty.');
        }
        await transaction.hospitalMembership.update({
          where: { hospitalId_id: { hospitalId, id } },
          data: { dutyStatus, dutyChangedAt: new Date() },
        });
        await recordStaffAudit(transaction, context, requestId, {
          action: 'staff.duty',
          targetType: 'HospitalMembership',
          targetId: id,
          metadata: { from: before.dutyStatus, to: dutyStatus },
        });
        return toView(await this.requireMember(transaction, context, id));
      },
      { isolationLevel: 'Serializable' },
    );
  }

  public addDepartment(context: StaffContext, id: string, departmentId: string, requestId: string) {
    const hospitalId = context.tenant.hospitalId;
    return this.database.$transaction(async (transaction) => {
      await this.requireMember(transaction, context, id);
      const department = await transaction.department.findUnique({
        where: { hospitalId_id: { hospitalId, id: departmentId } },
      });
      if (!department) {
        throw new NotFoundError('The referenced department was not found.');
      }
      if (!department.active) {
        throw new ConflictError('The department is inactive.');
      }
      // A duplicate fails on the unique key and returns 409.
      await transaction.staffDepartment.create({
        data: { hospitalId, membershipId: id, departmentId },
      });
      await recordStaffAudit(transaction, context, requestId, {
        action: 'staff.department.add',
        targetType: 'HospitalMembership',
        targetId: id,
        metadata: { departmentId },
      });
      return toView(await this.requireMember(transaction, context, id));
    });
  }

  public removeDepartment(
    context: StaffContext,
    id: string,
    departmentId: string,
    requestId: string,
  ) {
    const hospitalId = context.tenant.hospitalId;
    return this.database.$transaction(async (transaction) => {
      await this.requireMember(transaction, context, id);
      const removed = await transaction.staffDepartment.deleteMany({
        where: { hospitalId, membershipId: id, departmentId },
      });
      if (removed.count !== 1) {
        throw new NotFoundError();
      }
      await recordStaffAudit(transaction, context, requestId, {
        action: 'staff.department.remove',
        targetType: 'HospitalMembership',
        targetId: id,
        metadata: { departmentId },
      });
      return toView(await this.requireMember(transaction, context, id));
    });
  }

  public addCoverage(context: StaffContext, id: string, input: CoverageInput, requestId: string) {
    const hospitalId = context.tenant.hospitalId;
    return this.database.$transaction(async (transaction) => {
      await this.requireMember(transaction, context, id);
      if (input.scopeType === 'FLOOR') {
        await requireActiveLocation(
          transaction.floor.findUnique({
            where: { hospitalId_id: { hospitalId, id: input.floorId } },
          }),
          'floor',
        );
      }
      if (input.scopeType === 'WARD') {
        await requireActiveLocation(
          transaction.ward.findUnique({
            where: { hospitalId_id: { hospitalId, id: input.wardId } },
          }),
          'ward',
        );
      }
      // Duplicates fail on the unique keys (or the HOSPITAL partial index): 409.
      const scope = await transaction.staffLocationScope.create({
        data: {
          hospitalId,
          membershipId: id,
          scopeType: input.scopeType,
          floorId: input.scopeType === 'FLOOR' ? input.floorId : null,
          wardId: input.scopeType === 'WARD' ? input.wardId : null,
        },
      });
      await recordStaffAudit(transaction, context, requestId, {
        action: 'staff.coverage.add',
        targetType: 'HospitalMembership',
        targetId: id,
        metadata: {
          coverageId: scope.id,
          scopeType: scope.scopeType,
          floorId: scope.floorId,
          wardId: scope.wardId,
        },
      });
      return toView(await this.requireMember(transaction, context, id));
    });
  }

  public removeCoverage(context: StaffContext, id: string, coverageId: string, requestId: string) {
    const hospitalId = context.tenant.hospitalId;
    return this.database.$transaction(async (transaction) => {
      await this.requireMember(transaction, context, id);
      const removed = await transaction.staffLocationScope.deleteMany({
        where: { hospitalId, membershipId: id, id: coverageId },
      });
      if (removed.count !== 1) {
        throw new NotFoundError();
      }
      await recordStaffAudit(transaction, context, requestId, {
        action: 'staff.coverage.remove',
        targetType: 'HospitalMembership',
        targetId: id,
        metadata: { coverageId },
      });
      return toView(await this.requireMember(transaction, context, id));
    });
  }

  private async requireMember(
    client: PrismaClient | Prisma.TransactionClient,
    context: StaffContext,
    id: string,
  ): Promise<StaffRow> {
    const member = await client.hospitalMembership.findUnique({
      where: { hospitalId_id: { hospitalId: context.tenant.hospitalId, id } },
      select: staffSelect,
    });
    if (!member) {
      throw new NotFoundError();
    }
    return member;
  }
}

async function requireActiveLocation(
  lookup: Promise<{ active: boolean } | null>,
  label: string,
): Promise<void> {
  const location = await lookup;
  if (!location) {
    throw new NotFoundError(`The referenced ${label} was not found.`);
  }
  if (!location.active) {
    throw new ConflictError(`The ${label} is inactive.`);
  }
}
