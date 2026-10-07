import { z } from 'zod';
import { newPasswordSchema } from '../common/validation.js';
import { ConflictError } from '../common/errors/app-error.js';
import { createPrismaClient } from '../database/prisma.js';
import { demoHospital, seedDemoHospital, seedDemoPlatformAdmin } from '../seeds/demo-seed.js';
import { requireLocalDatabase, SeedInputError } from './seed-guards.js';

const inputSchema = z.object({
  DATABASE_URL: z.string().url(),
  NODE_ENV: z.enum(['development', 'test']).default('development'),
  DEMO_SEED_CONFIRM: z.literal(demoHospital.code),
  DEMO_ADMIN_PASSWORD: newPasswordSchema,
  DEMO_STAFF_PASSWORD: newPasswordSchema,
  // Optional: also create platform.demo@careqr.example as a platform admin.
  DEMO_PLATFORM_PASSWORD: newPasswordSchema.optional(),
  DEMO_SHOW_QR_TOKEN: z.enum(['yes', 'no']).default('no'),
  PUBLIC_APP_URL: z.string().url().default('http://localhost:5173'),
});

function requirePublicAppUrl(rawUrl: string): void {
  if (!['http:', 'https:'].includes(new URL(rawUrl).protocol)) {
    throw new SeedInputError('PUBLIC_APP_URL must use http or https.');
  }
}

async function main(): Promise<void> {
  const parsed = inputSchema.safeParse(process.env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new SeedInputError(`Missing or invalid demo seed environment fields: ${fields}.`);
  }
  const input = parsed.data;
  requireLocalDatabase(input.DATABASE_URL);
  requirePublicAppUrl(input.PUBLIC_APP_URL);

  const database = createPrismaClient(input.DATABASE_URL);
  try {
    const result = await seedDemoHospital(database, {
      adminPassword: input.DEMO_ADMIN_PASSWORD,
      staffPassword: input.DEMO_STAFF_PASSWORD,
      publicAppUrl: input.PUBLIC_APP_URL,
    });
    process.stdout.write(`Created ${demoHospital.name} (${result.hospitalCode})\n`);
    process.stdout.write(`Hospital ID: ${result.hospitalId}\n`);
    process.stdout.write(`Admin login email: ${result.adminEmail}\n`);
    process.stdout.write(`Floor manager login email: ${result.managerEmail}\n`);
    process.stdout.write(`Ward manager login email: ${result.wardManagerEmail}\n`);
    process.stdout.write(`Pantry supervisor login email: ${result.supervisorEmail}\n`);
    if (input.DEMO_PLATFORM_PASSWORD) {
      const platformEmail = await seedDemoPlatformAdmin(database, input.DEMO_PLATFORM_PASSWORD);
      process.stdout.write(
        `Platform admin login email: ${platformEmail} (sign in at /platform/login)\n`,
      );
    }
    for (const staff of result.staff) {
      process.stdout.write(`${staff.departmentCode} staff login email: ${staff.email}\n`);
    }
    process.stdout.write(`Occupied Bed 01 ID: ${result.occupiedBedId}\n`);
    process.stdout.write(`Active bed session ID: ${result.bedSessionId}\n`);
    process.stdout.write(`Available Bed 02 ID: ${result.availableBedId}\n`);
    if (input.DEMO_SHOW_QR_TOKEN === 'yes') {
      process.stdout.write(`QR token (bearer secret): ${result.qrToken}\n`);
      process.stdout.write(`QR URL (bearer secret): ${result.qrUrl}\n`);
    } else {
      process.stdout.write(
        'The active QR token was not printed. Log in as admin and rotate Bed 01 QR to get a new URL.\n',
      );
    }
  } finally {
    await database.$disconnect();
  }
}

main().catch((error: unknown) => {
  if (error instanceof SeedInputError) {
    process.stderr.write(`${error.message}\n`);
  } else if (error instanceof ConflictError) {
    process.stderr.write(
      'Demo seed refused: its hospital code or a demo login email already exists. No existing hospital was changed.\n',
    );
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
      `Demo seed failed${code}. Check the required environment fields, local database, and migrations.\n`,
    );
  }
  process.exitCode = 1;
});
