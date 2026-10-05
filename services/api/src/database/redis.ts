import { createClient } from 'redis';
import { type Logger } from 'pino';

export function createRedisClient(redisUrl: string, logger: Logger) {
  const client = createClient({ url: redisUrl });
  client.on('error', (error: unknown) => {
    logger.error({ err: error }, 'Redis client error');
  });
  return client;
}

export async function checkRedisConnection(ping: () => Promise<string>): Promise<void> {
  const response = await ping();
  if (response !== 'PONG') {
    throw new Error('Unexpected Redis PING response');
  }
}
