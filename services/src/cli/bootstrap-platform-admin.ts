import { z } from 'zod';
import { newPasswordSchema } from '../common/validation.js';
import { createPrismaClient } from '../database/prisma.js';
import { hashPassword } from '../modules/auth/index.js';

// Creates a SaaS platform operator (super admin) who can sign in at
// /platform/login and manage client hospitals.
const inputSchema = z.object({
  DATABASE_URL: z.string().url(),
  PLATFORM_ADMIN_EMAIL: z.string().trim().email(),
  PLATFORM_ADMIN_NAME: z.string().trim().min(2),
  PLATFORM_ADMIN_PASSWORD: newPasswordSchema,
});

async function main(): Promise<void> {
  const input = inputSchema.parse(process.env);
  const email = input.PLATFORM_ADMIN_EMAIL.toLowerCase();
  const database = createPrismaClient(input.DATABASE_URL);
  try {
    const passwordHash = await hashPassword(input.PLATFORM_ADMIN_PASSWORD);
    const created = await database.$transaction(async (transaction) => {
      if (await transaction.user.findUnique({ where: { email } })) {
        throw new Error('That email already has a CARE QR account. Use a separate operator email.');
      }
      const user = await transaction.user.create({
        data: { email, displayName: input.PLATFORM_ADMIN_NAME, passwordHash },
      });
      await transaction.platformAdmin.create({ data: { userId: user.id } });
      return user;
    });
    process.stdout.write(`Created platform administrator ${created.email}\n`);
  } finally {
    await database.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Bootstrap failed'}\n`);
  process.exitCode = 1;
});
