import { PrismaClient } from '@prisma/client';

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
