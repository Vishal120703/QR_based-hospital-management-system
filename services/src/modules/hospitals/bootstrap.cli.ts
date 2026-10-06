import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { createPrismaClient } from '../../database/prisma.js';
import { bootstrapHospital } from './bootstrap.js';
import { detectLogoType, maxLogoBytes, storeLogo } from './logo.js';

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
  // Optional: a PNG, JPEG, or WebP logo for this client hospital.
  HOSPITAL_LOGO_PATH: z.string().trim().min(1).optional(),
});

async function main(): Promise<void> {
  const input = bootstrapSchema.parse(process.env);
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: input.HOSPITAL_TIMEZONE });
  } catch {
    throw new Error('HOSPITAL_TIMEZONE must be a valid IANA time zone.');
  }

  // Check the logo before creating anything, so a bad file creates nothing.
  const logo = input.HOSPITAL_LOGO_PATH ? await readFile(input.HOSPITAL_LOGO_PATH) : null;
  if (logo && (!detectLogoType(logo) || logo.length > maxLogoBytes)) {
    throw new Error('HOSPITAL_LOGO_PATH must be a PNG, JPEG, or WebP image of up to 1 MB.');
  }

  const database = createPrismaClient(input.DATABASE_URL);
  try {
    const result = await bootstrapHospital(
      database,
      {
        name: input.HOSPITAL_NAME,
        code: input.HOSPITAL_CODE,
        timezone: input.HOSPITAL_TIMEZONE,
        adminEmail: input.ADMIN_EMAIL,
        adminName: input.ADMIN_NAME,
        adminPassword: input.ADMIN_PASSWORD,
      },
      logo
        ? async (transaction, created) => {
            await storeLogo(transaction, created.hospitalId, logo);
          }
        : undefined,
    );
    process.stdout.write(`Created hospital ${result.hospitalId}${logo ? ' with its logo' : ''}\n`);
  } finally {
    await database.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Bootstrap failed'}\n`);
  process.exitCode = 1;
});
