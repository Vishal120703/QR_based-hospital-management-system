import { type Prisma, type PrismaClient } from '@prisma/client';
import {
  AppError,
  ConflictError,
  ForbiddenError,
  InvalidInputError,
  NotFoundError,
} from '../../common/errors/app-error.js';
import { recordStaffAudit } from '../audit/index.js';
import { hashPassword, type StaffContext } from '../auth/index.js';
import { grantRole, resolveRoleGrant } from '../roles/index.js';
import { createStaffAccount } from './staff-account.js';
import type { StaffRepository, StaffRow } from './staff.repository.js';
import type { BulkCreateStaffInput, CoverageInput } from './staff.schemas.js';

type Transaction = Prisma.TransactionClient;

// Imports one reviewed spreadsheet as one transaction. A bad row rolls the
// whole upload back, so administrators never have to untangle half-created
// accounts. Password hashes are prepared before opening the transaction.
export async function createStaffInBulk(
  database: PrismaClient,
  staff: StaffRepository,
  context: StaffContext,
  input: BulkCreateStaffInput,
  requestId: string,
): Promise<StaffRow[]> {
  if (
    input.rows.some((row) => row.roleId !== undefined) &&
    !context.hospitalPermissions.has('role.manage')
  ) {
    throw new ForbiddenError();
  }
  const passwordHashes: string[] = [];
  for (const row of input.rows) passwordHashes.push(await hashPassword(row.password));

  const hospitalId = context.tenant.hospitalId;
  return database.$transaction(
    async (transaction) => {
      const membershipIds: string[] = [];
      for (const [index, row] of input.rows.entries()) {
        try {
          const roleGrant = row.roleId
            ? await resolveRoleGrant(transaction, context, row.roleId, row.roleScopeId)
            : null;

          for (const departmentId of row.departmentIds) {
            const department = await staff.findDepartment(transaction, hospitalId, departmentId);
            if (!department) throw new NotFoundError('A selected department was not found.');
            if (!department.active) throw new ConflictError('A selected department is inactive.');
          }
          await validateCoverage(transaction, staff, hospitalId, row.coverage);

          const created = await createStaffAccount(transaction, {
            hospitalId,
            email: row.email,
            displayName: row.displayName,
            passwordHash: passwordHashes[index]!,
          });
          membershipIds.push(created.membershipId);
          await configureDepartments(
            transaction,
            staff,
            context,
            requestId,
            created.membershipId,
            row.departmentIds,
          );
          await configureCoverage(
            transaction,
            staff,
            context,
            requestId,
            created.membershipId,
            row.coverage,
          );
          if (roleGrant) {
            await grantRole(transaction, {
              hospitalId,
              membershipId: created.membershipId,
              ...roleGrant,
            });
            await recordStaffAudit(transaction, context, requestId, {
              action: 'role.assign',
              targetType: 'HospitalMembership',
              targetId: created.membershipId,
              metadata: { ...roleGrant, source: 'bulk_import' },
            });
          }
          await recordStaffAudit(transaction, context, requestId, {
            action: 'staff.create',
            targetType: 'HospitalMembership',
            targetId: created.membershipId,
            metadata: {
              userId: created.userId,
              email: row.email.trim().toLowerCase(),
              displayName: row.displayName,
              source: 'bulk_import',
            },
          });
        } catch (cause) {
          if (cause instanceof AppError) {
            throw new AppError(cause.statusCode, cause.code, `Row ${index + 2}: ${cause.message}`);
          }
          throw cause;
        }
      }
      const created: StaffRow[] = [];
      for (const id of membershipIds) {
        const member = await staff.findMember(transaction, hospitalId, id);
        if (!member) throw new NotFoundError();
        created.push(member);
      }
      return created;
    },
    { isolationLevel: 'Serializable', timeout: 30_000 },
  );
}

async function configureDepartments(
  transaction: Transaction,
  staff: StaffRepository,
  context: StaffContext,
  requestId: string,
  membershipId: string,
  departmentIds: readonly string[],
) {
  for (const departmentId of departmentIds) {
    await staff.addDepartment(transaction, context.tenant.hospitalId, membershipId, departmentId);
    await recordStaffAudit(transaction, context, requestId, {
      action: 'staff.department.add',
      targetType: 'HospitalMembership',
      targetId: membershipId,
      metadata: { departmentId, source: 'bulk_import' },
    });
  }
}

async function configureCoverage(
  transaction: Transaction,
  staff: StaffRepository,
  context: StaffContext,
  requestId: string,
  membershipId: string,
  coverage: readonly CoverageInput[],
) {
  for (const input of coverage) {
    const scope = await staff.addCoverage(transaction, {
      hospitalId: context.tenant.hospitalId,
      membershipId,
      scopeType: input.scopeType,
      floorId: input.scopeType === 'FLOOR' ? input.floorId : null,
      wardId: input.scopeType === 'WARD' ? input.wardId : null,
    });
    await recordStaffAudit(transaction, context, requestId, {
      action: 'staff.coverage.add',
      targetType: 'HospitalMembership',
      targetId: membershipId,
      metadata: {
        coverageId: scope.id,
        scopeType: scope.scopeType,
        floorId: scope.floorId,
        wardId: scope.wardId,
        source: 'bulk_import',
      },
    });
  }
}

async function validateCoverage(
  transaction: Transaction,
  staff: StaffRepository,
  hospitalId: string,
  coverage: readonly CoverageInput[],
): Promise<void> {
  const seen = new Set<string>();
  for (const scope of coverage) {
    const key =
      scope.scopeType === 'HOSPITAL'
        ? 'HOSPITAL'
        : `${scope.scopeType}:${scope.scopeType === 'FLOOR' ? scope.floorId : scope.wardId}`;
    if (seen.has(key)) throw new InvalidInputError('Coverage entries must be unique.');
    seen.add(key);
    if (scope.scopeType === 'FLOOR') {
      requireActiveLocation(await staff.findFloor(transaction, hospitalId, scope.floorId), 'floor');
    }
    if (scope.scopeType === 'WARD') {
      requireActiveLocation(await staff.findWard(transaction, hospitalId, scope.wardId), 'ward');
    }
  }
}

function requireActiveLocation(location: { active: boolean } | null, label: string): void {
  if (!location) throw new NotFoundError(`The referenced ${label} was not found.`);
  if (!location.active) throw new ConflictError(`The ${label} is inactive.`);
}
