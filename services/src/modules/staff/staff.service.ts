import {
  type DutyStatus,
  type MembershipStatus,
  type Prisma,
  type PrismaClient,
} from '@prisma/client';
import { ConflictError, ForbiddenError, NotFoundError } from '../../common/errors/app-error.js';
import { type Db } from '../../database/client.js';
import { recordStaffAudit } from '../audit/index.js';
import {
  canAccessLocation,
  hashPassword,
  resetStaffPassword,
  revokeStaffSessions,
  type StaffContext,
} from '../auth/index.js';
import { lockedRoleKey } from '../roles/index.js';
import { createStaffInBulk } from './bulk-staff.js';
import { findEligibleStaff } from './eligibility.js';
import { createStaffAccount } from './staff-account.js';
import { StaffRepository, type StaffRow } from './staff.repository.js';
import {
  type BulkCreateStaffInput,
  type CoverageInput,
  type CreateStaffInput,
  type StaffFilter,
} from './staff.schemas.js';

type Transaction = Prisma.TransactionClient;
const repository = new StaffRepository();

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

export class StaffService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly staff = repository,
  ) {}

  public async list(context: StaffContext, filter: StaffFilter) {
    const [rows, total] = await Promise.all([
      this.staff.list(this.database, context.tenant.hospitalId, filter),
      this.staff.count(this.database, context.tenant.hospitalId, filter),
    ]);
    return {
      items: rows.map(toView),
      page: filter.page,
      pageSize: filter.pageSize,
      total,
    };
  }

  public async get(context: StaffContext, id: string) {
    return toView(await this.requireMember(this.database, context, id));
  }

  public async eligible(context: StaffContext, query: { bedId: string; departmentId: string }) {
    const hospitalId = context.tenant.hospitalId;
    const bed = await this.staff.findBedPlace(this.database, hospitalId, query.bedId);
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
  public async create(context: StaffContext, input: CreateStaffInput, requestId: string) {
    const hospitalId = context.tenant.hospitalId;
    const passwordHash = await hashPassword(input.password);
    return this.database.$transaction(async (transaction) => {
      const created = await createStaffAccount(transaction, {
        hospitalId,
        email: input.email,
        displayName: input.displayName,
        passwordHash,
      });
      await recordStaffAudit(transaction, context, requestId, {
        action: 'staff.create',
        targetType: 'HospitalMembership',
        targetId: created.membershipId,
        metadata: {
          userId: created.userId,
          email: input.email.trim().toLowerCase(),
          displayName: input.displayName,
        },
      });
      return toView(await this.requireMember(transaction, context, created.membershipId));
    });
  }

  public async bulkCreate(context: StaffContext, input: BulkCreateStaffInput, requestId: string) {
    return (await createStaffInBulk(this.database, this.staff, context, input, requestId)).map(
      toView,
    );
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
        if (status !== before.status) {
          await this.requireSafeStatusChange(
            transaction,
            context,
            id,
            deactivating && before.status === 'ACTIVE',
          );
        }
        await this.staff.updateMembership(transaction, hospitalId, id, {
          status,
          // Staff who are not active cannot be on duty or keep signed-in sessions.
          ...(deactivating && before.dutyStatus === 'ON_DUTY'
            ? { dutyStatus: 'OFF_DUTY' as const, dutyChangedAt: new Date() }
            : {}),
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
        await this.staff.updateMembership(transaction, hospitalId, id, {
          dutyStatus,
          dutyChangedAt: new Date(),
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
      const department = await this.staff.findDepartment(transaction, hospitalId, departmentId);
      if (!department) {
        throw new NotFoundError('The referenced department was not found.');
      }
      if (!department.active) {
        throw new ConflictError('The department is inactive.');
      }
      // A duplicate fails on the unique key and returns 409.
      await this.staff.addDepartment(transaction, hospitalId, id, departmentId);
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
      if ((await this.staff.removeDepartment(transaction, hospitalId, id, departmentId)) !== 1) {
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
        requireActiveLocation(
          await this.staff.findFloor(transaction, hospitalId, input.floorId),
          'floor',
        );
      }
      if (input.scopeType === 'WARD') {
        requireActiveLocation(
          await this.staff.findWard(transaction, hospitalId, input.wardId),
          'ward',
        );
      }
      // Duplicates fail on the unique keys (or the HOSPITAL partial index): 409.
      const scope = await this.staff.addCoverage(transaction, {
        hospitalId,
        membershipId: id,
        scopeType: input.scopeType,
        floorId: input.scopeType === 'FLOOR' ? input.floorId : null,
        wardId: input.scopeType === 'WARD' ? input.wardId : null,
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
      if ((await this.staff.removeCoverage(transaction, hospitalId, id, coverageId)) !== 1) {
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

  // A staff manager gives someone who forgot their password a temporary one,
  // to tell them in person. Every session of theirs ends and they must choose
  // their own at the next sign-in. Only for someone whose permissions the
  // manager holds (or they could sign in with more power), never oneself
  // (use Change password), and never an account also used outside this
  // hospital. The audit entry records the reset, never the password.
  public async resetPassword(
    context: StaffContext,
    id: string,
    temporaryPassword: string,
    requestId: string,
  ) {
    if (id === context.membershipId) {
      throw new ConflictError('Use Change password to change your own password.');
    }
    const hospitalId = context.tenant.hospitalId;
    const passwordHash = await hashPassword(temporaryPassword);
    return this.database.$transaction(async (transaction) => {
      const member = await this.requireMember(transaction, context, id);
      await this.requireNoGreaterPowers(transaction, context, id);
      const reset = await resetStaffPassword(
        transaction,
        { hospitalId, membershipId: id, userId: member.user.id },
        passwordHash,
      );
      if (!reset.allowed) {
        throw new ConflictError(
          'This account also signs in outside this hospital, so its password cannot be reset here.',
        );
      }
      await recordStaffAudit(transaction, context, requestId, {
        action: 'staff.password.reset',
        targetType: 'HospitalMembership',
        targetId: id,
        metadata: { sessionsEnded: reset.sessionsEnded },
      });
      return toView(member);
    });
  }

  // A staff manager may act on someone only if they hold every permission
  // that person has.
  private async requireNoGreaterPowers(
    transaction: Transaction,
    context: StaffContext,
    membershipId: string,
  ) {
    const roles = await this.staff.findActiveRoles(
      transaction,
      context.tenant.hospitalId,
      membershipId,
    );
    const held = roles.flatMap(({ role }) =>
      role.rolePermissions.map((item) => item.permissionKey),
    );
    if (held.some((key) => !context.hospitalPermissions.has(key))) throw new ForbiddenError();
    return roles;
  }

  // A staff manager may only change the status of someone whose permissions they
  // hold themselves, and a hospital must keep at least one active Hospital Manager.
  private async requireSafeStatusChange(
    transaction: Transaction,
    context: StaffContext,
    membershipId: string,
    deactivating: boolean,
  ): Promise<void> {
    const hospitalId = context.tenant.hospitalId;
    const roles = await this.requireNoGreaterPowers(transaction, context, membershipId);
    if (!deactivating || !roles.some(({ role }) => role.systemKey === lockedRoleKey)) return;
    const others = await this.staff.countOtherActiveHolders(
      transaction,
      hospitalId,
      lockedRoleKey,
      membershipId,
    );
    if (others === 0) {
      throw new ConflictError('A hospital must keep at least one active Hospital Manager.');
    }
  }

  private async requireMember(db: Db, context: StaffContext, id: string): Promise<StaffRow> {
    const member = await this.staff.findMember(db, context.tenant.hospitalId, id);
    if (!member) {
      throw new NotFoundError();
    }
    return member;
  }
}

function requireActiveLocation(location: { active: boolean } | null, label: string): void {
  if (!location) {
    throw new NotFoundError(`The referenced ${label} was not found.`);
  }
  if (!location.active) {
    throw new ConflictError(`The ${label} is inactive.`);
  }
}
