import { type Prisma } from '@prisma/client';
import { ConflictError } from '../../common/errors/app-error.js';
import { StaffRepository } from './staff.repository.js';

const repository = new StaffRepository();

// Creates a person's account and their membership in a hospital, inside the
// caller's transaction. Used by staff creation, hospital setup, and the super
// admin. Fails if the email already has an account.
export async function createStaffAccount(
  transaction: Prisma.TransactionClient,
  input: {
    readonly hospitalId: string;
    readonly email: string;
    readonly displayName: string;
    readonly passwordHash: string;
  },
): Promise<{ userId: string; membershipId: string }> {
  const email = input.email.trim().toLowerCase();
  if (await repository.findUserByEmail(transaction, email)) {
    throw new ConflictError('A user with this email already exists.');
  }
  const user = await repository.createUser(transaction, {
    email,
    displayName: input.displayName.trim(),
    passwordHash: input.passwordHash,
  });
  const membership = await repository.createMembership(transaction, {
    hospitalId: input.hospitalId,
    userId: user.id,
  });
  return { userId: user.id, membershipId: membership.id };
}
