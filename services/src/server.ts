import { createServer } from 'node:http';
import { ZodError } from 'zod';
import { createApp } from './app.js';
import { loadConfig } from './config/env.js';
import { createLogger } from './config/logger.js';
import { checkDatabaseConnection, createPrismaClient } from './database/prisma.js';
import { checkRedisConnection, createRedisClient } from './database/redis.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const prisma = createPrismaClient(config.databaseUrl);
  // Redis is optional until a feature needs it; when configured it must work.
  const redis = config.redisUrl ? createRedisClient(config.redisUrl, logger) : null;

  await prisma.$connect();
  await redis?.connect();

  const application = createApp({
    logger,
    database: prisma,
    publicAppUrl: config.publicAppUrl,
    guestSessionTtlMinutes: config.guestSessionTtlMinutes,
    corsOrigins: config.corsOrigins,
    trustProxy: config.trustProxy,
    readinessProbes: [
      {
        name: 'postgresql',
        check: () => checkDatabaseConnection(() => prisma.$queryRaw`SELECT 1`),
      },
      ...(redis ? [{ name: 'redis', check: () => checkRedisConnection(() => redis.ping()) }] : []),
    ],
  });
  const server = createServer(application);

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    logger.info({ signal }, 'Shutting down API');
    server.close();
    await Promise.allSettled([prisma.$disconnect(), redis?.quit()]);
  };

  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  server.listen(config.port, config.host, () => {
    logger.info(
      {
        host: config.host,
        port: config.port,
        publicAppUrl: config.publicAppUrl,
        corsOrigins: config.corsOrigins,
        redis: Boolean(redis),
      },
      'CARE QR API listening',
    );
  });
}

main().catch((error: unknown) => {
  const fallbackLogger = createLogger('error');
  if (error instanceof ZodError) {
    // A missing or invalid environment variable: name each one plainly.
    const problems = error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    fallbackLogger.fatal({ problems }, 'API failed to start: check the environment variables');
  } else {
    fallbackLogger.fatal({ err: error }, 'API failed to start');
  }
  process.exitCode = 1;
});
