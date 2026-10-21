import { type Prisma, type PrismaClient, type ServiceRequest } from '@prisma/client';
import {
  ConflictError,
  ForbiddenError,
  InvalidInputError,
  NotFoundError,
} from '../../common/errors/app-error.js';
import { recordStaffAudit } from '../audit/index.js';
import { canAccessLocation, type StaffContext } from '../auth/index.js';
import { findEligibleStaff } from '../staff/index.js';
import { commandPermissions, transitions, type CommandInput } from './request-transitions.js';
import { type RequestRepository } from './request.repository.js';
import { type RequestCommand } from './request.schemas.js';

// Staff moving a request through its lifecycle: assign, accept, start,
// complete, close, cancel, turn down (reject), and hand over (transfer).
export class RequestCommandService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly requests: RequestRepository,
  ) {}

  // One transaction per command: check permission and area, the version the
  // screen was based on, the transition, and eligibility; then update the
  // request only if it is unchanged, add its event, and audit the changes
  // that matter. A stale screen or a concurrent change gets a conflict.
  public async run(
    context: StaffContext,
    id: string,
    action: RequestCommand,
    input: CommandInput,
    correlationId: string,
  ): Promise<ServiceRequest> {
    if (!context.permissions.has(commandPermissions[action])) throw new ForbiddenError();
    const hospitalId = context.tenant.hospitalId;
    return this.database.$transaction(async (transaction) => {
      const current = await this.requests.findWithPlace(transaction, hospitalId, id);
      if (
        !current ||
        !canAccessLocation(context, commandPermissions[action], {
          wardId: current.bed.wardId,
          floorId: current.bed.ward.floorId,
          departmentId: current.departmentId,
        })
      ) {
        throw new NotFoundError();
      }
      if (
        current.version !== input.expectedVersion ||
        !transitions[action].from.includes(current.status)
      ) {
        throw new ConflictError('The request has changed or this transition is not allowed.');
      }
      if (current.assignmentMode !== 'MANUAL') {
        throw new ConflictError('This assignment mode is not available yet.');
      }
      if (
        ['accept', 'start', 'complete', 'reject'].includes(action) &&
        current.assigneeId !== context.membershipId
      ) {
        throw new ForbiddenError();
      }
      if (
        (action === 'reject' || action === 'cancel' || action === 'transfer') &&
        !input.reason?.trim()
      ) {
        throw new InvalidInputError('A reason is required.');
      }
      if (action === 'assign' || action === 'transfer') {
        if (!input.assigneeId) throw new InvalidInputError('An assignee is required.');
        if (action === 'transfer' && input.assigneeId === current.assigneeId) {
          throw new InvalidInputError('Transfer requires a different assignee.');
        }
        const eligible = await findEligibleStaff(transaction, hospitalId, {
          bedId: current.bedId,
          departmentId: current.departmentId,
        });
        if (!eligible.some((staff) => staff.membershipId === input.assigneeId)) {
          throw new InvalidInputError(
            'The selected staff member is not eligible for this request.',
          );
        }
      }
      if (action === 'accept') {
        const eligible = await findEligibleStaff(transaction, hospitalId, {
          bedId: current.bedId,
          departmentId: current.departmentId,
        });
        if (!eligible.some((staff) => staff.membershipId === context.membershipId)) {
          throw new ForbiddenError();
        }
      }
      const now = new Date();
      const data: Prisma.ServiceRequestUncheckedUpdateManyInput = {
        status: transitions[action].to,
        version: { increment: 1 },
      };
      if (action === 'assign' || action === 'transfer') {
        data.assigneeId = input.assigneeId ?? null;
        data.assignedAt = now;
      }
      if (action === 'accept') data.acceptedAt = current.acceptedAt ?? now;
      if (action === 'start') data.startedAt = current.startedAt ?? now;
      if (action === 'complete') data.completedAt = now;
      // A new deadline applies (or none): earlier escalations no longer do.
      // The SLA worker marks it again if this deadline is missed too.
      if (action !== 'assign' && action !== 'start') {
        data.isEscalated = false;
        data.escalationLevel = 0;
      }
      if (action === 'close') data.closedAt = now;
      if (action === 'cancel') data.cancelledAt = now;
      if (action === 'reject') data.rejectedAt = now;

      const updated = await this.requests.updateIfUnchanged(
        transaction,
        hospitalId,
        id,
        current,
        data,
      );
      if (updated !== 1) throw new ConflictError('The request changed during this command.');

      const metadata: Prisma.InputJsonObject = {
        ...(action === 'assign' || action === 'transfer'
          ? { assigneeId: input.assigneeId ?? null }
          : {}),
        ...(action === 'transfer' ? { previousAssigneeId: current.assigneeId } : {}),
      };
      await this.requests.addEvent(transaction, {
        hospitalId,
        requestId: id,
        type: transitions[action].event,
        previousStatus: current.status,
        resultingStatus: transitions[action].to,
        actorType: 'STAFF',
        actorId: context.membershipId,
        occurredAt: now,
        reason: input.reason?.trim() || null,
        metadata,
        requestVersion: current.version + 1,
        correlationId,
      });
      if (['assign', 'transfer', 'cancel', 'reject'].includes(action)) {
        await recordStaffAudit(transaction, context, correlationId, {
          action: `request.${action}`,
          targetType: 'ServiceRequest',
          targetId: id,
          metadata: {
            previousStatus: current.status,
            status: transitions[action].to,
            ...metadata,
            ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}),
          },
        });
      }
      return this.requests.findById(transaction, hospitalId, id);
    });
  }
}
