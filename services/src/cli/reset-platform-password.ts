import { z } from 'zod';
import { newPasswordSchema } from '../common/validation.js';
import { createPrismaClient } from '../database/prisma.js';
import { hashPassword, lockCredentialAccount } from '../modules/auth/index.js';

const inputSchema = z.object({
  DATABASE_URL: z.string().url(),
  PLATFORM_ADMIN_EMAIL: z.string().trim().email(),
  PLATFORM_ADMIN_PASSWORD: newPasswordSchema,
});

async function main(): Promise<void> {
  const input = inputSchema.parse(process.env);
  const email = input.PLATFORM_ADMIN_EMAIL.toLowerCase();
  const database = createPrismaClient(input.DATABASE_URL);
  try {
    const user = await database.user.findUnique({
      where: { email },
      include: { platformAdmin: true },
    });
    if (!user?.platformAdmin) throw new Error('That platform administrator was not found.');
    const passwordHash = await hashPassword(input.PLATFORM_ADMIN_PASSWORD);
    const sessionsEnded = await database.$transaction(async (transaction) => {
      await lockCredentialAccount(transaction, user.id);
      const current = await transaction.user.findUnique({
        where: { id: user.id },
        include: { platformAdmin: true },
      });
      if (!current?.platformAdmin) throw new Error('That platform administrator was not found.');
      await transaction.user.update({
        where: { id: user.id },
        data: { passwordHash, mustChangePassword: false },
      });
      const [platform, staff] = await Promise.all([
        transaction.platformSession.updateMany({
          where: { userId: user.id, revokedAt: null },
          data: { revokedAt: new Date() },
        }),
        transaction.staffSession.updateMany({
          where: { membership: { userId: user.id }, revokedAt: null },
          data: { revokedAt: new Date() },
        }),
      ]);
      return platform.count + staff.count;
    });
    process.stdout.write(
      `Reset the password for ${email}; ended ${sessionsEnded} active session(s).\n`,
    );
  } finally {
    await database.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Password reset failed'}\n`);
  process.exitCode = 1;
});
