import { describe, expect, it, vi } from 'vitest';
import { checkDatabaseConnection } from '../../src/database/prisma.js';
import { checkRedisConnection } from '../../src/database/redis.js';

describe('dependency connection checks', () => {
  it('executes the PostgreSQL connection probe', async () => {
    const probe = vi.fn().mockResolvedValue([{ '?column?': 1 }]);

    await checkDatabaseConnection(probe);

    expect(probe).toHaveBeenCalledOnce();
  });

  it('accepts a valid Redis PING response', async () => {
    const ping = vi.fn().mockResolvedValue('PONG');

    await checkRedisConnection(ping);

    expect(ping).toHaveBeenCalledOnce();
  });

  it('rejects an invalid Redis PING response', async () => {
    await expect(checkRedisConnection(() => Promise.resolve('NOT_PONG'))).rejects.toThrow(
      'Unexpected Redis PING response',
    );
  });
});
