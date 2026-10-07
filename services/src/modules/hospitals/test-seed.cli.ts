import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { createPrismaClient } from '../../database/prisma.js';
import { requireLocalDatabase, SeedInputError } from './seed-guards.js';
import { seedTestHospitals } from './test-seed.js';

const inputSchema = z.object({
  DATABASE_URL: z.string().url(),
  NODE_ENV: z.enum(['development', 'test']).default('development'),
  // Every account in the test hospitals uses this local-only password.
  DEMO_STAFF_PASSWORD: z.string().min(12),
  DEMO_PLATFORM_PASSWORD: z.string().min(12).optional(),
});

async function main(): Promise<void> {
  const parsed = inputSchema.safeParse(process.env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new SeedInputError(`Missing or invalid test seed environment fields: ${fields}.`);
  }
  const input = parsed.data;
  requireLocalDatabase(input.DATABASE_URL);

  const database = createPrismaClient(input.DATABASE_URL);
  try {
    const result = await seedTestHospitals(database, {
      password: input.DEMO_STAFF_PASSWORD,
      platformPassword: input.DEMO_PLATFORM_PASSWORD,
    });
    for (const code of result.skipped) {
      process.stdout.write(`${code} already exists: left unchanged.\n`);
    }
    for (const hospital of result.created) {
      process.stdout.write(
        `\nCreated ${hospital.name} (hospital code ${hospital.code}) for client ${hospital.client}\n`,
      );
      for (const account of hospital.accounts) {
        process.stdout.write(`  ${account.email.padEnd(36)} ${account.name} - ${account.roles}\n`);
      }
    }
    if (result.platformEmail) {
      process.stdout.write(
        `\nPlatform admin: ${result.platformEmail} (sign in at /platform/login)\n`,
      );
    }
    process.stdout.write(
      '\nStaff accounts use the DEMO_STAFF_PASSWORD from services/.env. Passwords and QR links are never printed.\n' +
        'Testing guide: services/docs/full-testing-guide.md\n',
    );
  } finally {
    await database.$disconnect();
  }
}

main().catch((error: unknown) => {
  if (error instanceof SeedInputError) {
    process.stderr.write(`${error.message}\n`);
  } else if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    process.stderr.write(
      'Test seed refused: one of its login emails already exists. Nothing was changed for that hospital.\n',
    );
  } else if (error instanceof Error && error.message.startsWith('Test ')) {
    // A mistake in test-seed-data.ts; safe to show.
    process.stderr.write(`${error.message}\n`);
  } else {
    // Do not print raw database errors: they can contain connection details.
    const code =
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof error.code === 'string' &&
      /^P\d{4}$/.test(error.code)
        ? ` (${error.code})`
        : '';
    process.stderr.write(
      `Test seed failed${code}. Check services/.env, that PostgreSQL is running, and that migrations are applied.\n`,
    );
  }
  process.exitCode = 1;
});
