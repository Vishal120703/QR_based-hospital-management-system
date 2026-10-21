import { Prisma, PrismaClient } from '@prisma/client';
import { StartupError } from '../http/server-lifecycle.js';

export function createPrismaClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({
    datasources: {
      db: { url: databaseUrl },
    },
  });
}

export async function checkDatabaseConnection(runProbe: () => Promise<unknown>): Promise<void> {
  await runProbe();
}

// Fail before listening instead of logging missing-table errors every worker
// tick when a developer changes DATABASE_URL or forgets a recent migration.
export async function checkWorkerSchema(database: PrismaClient): Promise<void> {
  try {
    await Promise.all([
      database.user.findFirst({ select: { id: true, mustChangePassword: true } }),
      database.hospital.findFirst({ select: { id: true, bedOccupancyEnabled: true } }),
      database.bedQrCode.findFirst({ select: { id: true, tokenCiphertext: true } }),
      database.requestEscalation.findFirst(),
      database.staffNotification.findFirst(),
      database.notificationDispatch.findFirst(),
    ]);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      ['P2021', 'P2022'].includes(error.code)
    ) {
      throw new StartupError(
        'The database schema is out of date. From services, run npm run prisma:migrate and npm run prisma:generate against the intended DATABASE_URL, then restart.',
      );
    }
    throw error;
  }
}
