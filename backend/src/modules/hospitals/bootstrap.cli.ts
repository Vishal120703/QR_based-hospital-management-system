import { z } from 'zod';
import { createPrismaClient } from '../../database/prisma.js';
import { bootstrapHospital } from './bootstrap.js';

const bootstrapSchema = z.object({
  DATABASE_URL: z.string().url(),
  HOSPITAL_NAME: z.string().trim().min(2),
  HOSPITAL_CODE: z
    .string()
    .trim()
    .min(2)
    .max(32)
    .regex(/^[A-Za-z0-9-]+$/),
  HOSPITAL_TIMEZONE: z.string().trim().min(1),
  ADMIN_EMAIL: z.string().trim().email(),
  ADMIN_NAME: z.string().trim().min(2),
  ADMIN_PASSWORD: z.string().min(12),
});

async function main(): Promise<void> {
  const input = bootstrapSchema.parse(process.env);
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: input.HOSPITAL_TIMEZONE });
  } catch {
    throw new Error('HOSPITAL_TIMEZONE must be a valid IANA time zone.');
  }

  const database = createPrismaClient(input.DATABASE_URL);
  try {
    const result = await bootstrapHospital(database, {
      name: input.HOSPITAL_NAME,
      code: input.HOSPITAL_CODE,
      timezone: input.HOSPITAL_TIMEZONE,
      adminEmail: input.ADMIN_EMAIL,
      adminName: input.ADMIN_NAME,
      adminPassword: input.ADMIN_PASSWORD,
    });
    process.stdout.write(`Created hospital ${result.hospitalId}\n`);
  } finally {
    await database.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Bootstrap failed'}\n`);
  process.exitCode = 1;
});
