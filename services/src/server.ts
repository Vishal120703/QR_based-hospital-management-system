import { createServer } from 'node:http';
import { ZodError } from 'zod';
import { createApp } from './app.js';
import { loadConfig } from './config/env.js';
import { createLogger } from './config/logger.js';
import { checkDatabaseConnection, createPrismaClient } from './database/prisma.js';
import { checkRedisConnection, createRedisClient } from './database/redis.js';
import { gracefulShutdown, listen, runCleanups, StartupError } from './http/server-lifecycle.js';
import { EscalationService, startEscalationWorker } from './modules/requests/index.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  // What to close on the way out, latest first; filled in as start-up goes,
  // so a failure part-way still releases what was opened.
  const cleanups: { name: string; run: () => Promise<unknown> }[] = [];

  try {
    const prisma = createPrismaClient(config.databaseUrl);
    await prisma.$connect();
    cleanups.unshift({ name: 'database', run: () => prisma.$disconnect() });
    // Redis is optional until a feature needs it; when configured it must work.
    const redis = config.redisUrl ? createRedisClient(config.redisUrl, logger) : null;
    if (redis) {
      await redis.connect();
      cleanups.unshift({ name: 'redis', run: () => redis.quit() });
    }

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
        ...(redis
          ? [{ name: 'redis', check: () => checkRedisConnection(() => redis.ping()) }]
          : []),
      ],
    });
    const server = createServer(application);
    await listen(server, config.port, config.host);

    // The SLA worker escalates overdue requests from this process.
    if (config.escalationIntervalSeconds > 0) {
      const escalations = startEscalationWorker(
        new EscalationService(prisma),
        logger,
        config.escalationIntervalSeconds * 1000,
      );
      cleanups.unshift({ name: 'escalation worker', run: () => escalations.stop() });
    }

    const shutdown = gracefulShutdown({
      server,
      logger,
      timeoutMs: config.shutdownTimeoutSeconds * 1000,
      cleanups,
    });
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.on(signal, () => {
        void shutdown(signal);
      });
    }

    logger.info(
      {
        host: config.host,
        port: config.port,
        publicAppUrl: config.publicAppUrl,
        corsOrigins: config.corsOrigins,
        redis: Boolean(redis),
        escalationIntervalSeconds: config.escalationIntervalSeconds,
      },
      'CARE QR API listening',
    );
  } catch (error) {
    await runCleanups(cleanups, logger);
    throw error;
  }
}

main().catch((error: unknown) => {
  const fallbackLogger = createLogger('error');
  if (error instanceof ZodError) {
    // A missing or invalid environment variable: name each one plainly.
    const problems = error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    fallbackLogger.fatal({ problems }, 'API failed to start: check the environment variables');
  } else if (error instanceof StartupError) {
    fallbackLogger.fatal(`API failed to start: ${error.message}`);
  } else {
    fallbackLogger.fatal({ err: error }, 'API failed to start');
  }
  process.exitCode = 1;
});
