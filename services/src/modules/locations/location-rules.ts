import { type Prisma, type PrismaClient } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../common/errors/app-error.js';

// Rules every level of the Building → Floor → Ward → Room → Bed hierarchy shares.

export function found<T>(row: T | null): T {
  if (!row) {
    throw new NotFoundError();
  }
  return row;
}

// Invariant: an active location always has active ancestors.
export function requireActiveParent(parent: { active: boolean } | null, label: string): void {
  if (!parent) {
    throw new NotFoundError(`The referenced ${label} was not found.`);
  }
  if (!parent.active) {
    throw new ConflictError(`The ${label} is inactive.`);
  }
}

export function requireNoActiveChildren(count: number, label: string): void {
  if (count > 0) {
    throw new ConflictError(`Deactivate the active locations inside this ${label} first.`);
  }
}

export function requireNoChildren(count: number, label: string): void {
  if (count > 0) {
    throw new ConflictError(`Delete the locations inside this ${label} first.`);
  }
}

export function requireNoRoleScopes(count: number, label: string): void {
  if (count > 0) {
    throw new ConflictError(
      `This ${label} is still used by a role assignment. Remove that assignment first.`,
    );
  }
}

// The code, name, and active fields every level can change.
export function locationChanges(input: {
  code?: string | undefined;
  name?: string | undefined;
  active?: boolean | undefined;
}) {
  return {
    ...(input.code !== undefined ? { code: input.code } : {}),
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.active !== undefined ? { active: input.active } : {}),
  };
}

// Every change runs here. Serializable isolation keeps the parent/child
// "active" checks race-free: a concurrent deactivate-parent and create-child
// cannot both commit.
export function writeSerializable<T>(
  database: PrismaClient,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return database.$transaction(operation, { isolationLevel: 'Serializable' });
}
