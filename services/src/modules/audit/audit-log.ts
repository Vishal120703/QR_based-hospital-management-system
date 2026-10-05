import { type Prisma } from '@prisma/client';
import { type StaffContext } from '../auth/auth.service.js';

export interface StaffAuditEntry {
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly metadata: Prisma.InputJsonObject;
}

// Must run inside the same transaction as the change it records.
export async function recordStaffAudit(
  transaction: Prisma.TransactionClient,
  context: StaffContext,
  requestId: string,
  entry: StaffAuditEntry,
): Promise<void> {
  await transaction.auditLog.create({
    data: {
      hospitalId: context.tenant.hospitalId,
      actorType: 'STAFF',
      actorMembershipId: context.membershipId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      metadata: entry.metadata,
      requestId,
    },
  });
}
