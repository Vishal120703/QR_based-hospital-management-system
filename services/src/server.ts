import { createServer } from 'node:http';
import { createApp } from './app.js';
import { loadConfig } from './config/env.js';
import { createLogger } from './config/logger.js';
import { checkDatabaseConnection, createPrismaClient } from './database/prisma.js';
import { checkRedisConnection, createRedisClient } from './database/redis.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const prisma = createPrismaClient(config.databaseUrl);
  const redis = createRedisClient(config.redisUrl, logger);

  await prisma.$connect();
  await redis.connect();

  const application = createApp({
    logger,
    database: prisma,
    publicAppUrl: config.publicAppUrl,
    guestSessionTtlMinutes: config.guestSessionTtlMinutes,
    readinessProbes: [
      {
        name: 'postgresql',
        check: () => checkDatabaseConnection(() => prisma.$queryRaw`SELECT 1`),
      },
      {
        name: 'redis',
        check: () => checkRedisConnection(() => redis.ping()),
      },
    ],
  });
  const server = createServer(application);

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    logger.info({ signal }, 'Shutting down API');
    server.close();
    await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
  };

  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  server.listen(config.port, config.host, () => {
    logger.info({ host: config.host, port: config.port }, 'CARE QR API listening');
  });
}

main().catch((error: unknown) => {
  const fallbackLogger = createLogger('error');
  fallbackLogger.fatal({ err: error }, 'API failed to start');
  process.exitCode = 1;
});
