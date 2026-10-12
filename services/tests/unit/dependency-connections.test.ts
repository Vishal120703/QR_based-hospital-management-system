import { describe, expect, it, vi } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { checkDatabaseConnection, checkWorkerSchema } from '../../src/database/prisma.js';
import { checkRedisConnection } from '../../src/database/redis.js';

describe('dependency connection checks', () => {
  it('explains missing worker migrations before the API starts', async () => {
    const database = new PrismaClient({
      datasources: { db: { url: 'postgresql://unused@localhost/unused' } },
    });
    vi.spyOn(database.user, 'findFirst').mockResolvedValue(null);
    vi.spyOn(database.staffNotification, 'findFirst').mockResolvedValue(null);
    vi.spyOn(database.notificationDispatch, 'findFirst').mockResolvedValue(null);
    vi.spyOn(database.requestEscalation, 'findFirst').mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('missing table', {
        code: 'P2021',
        clientVersion: '6.19.0',
      }),
    );
    await expect(checkWorkerSchema(database)).rejects.toThrow('npm run prisma:migrate');
    await database.$disconnect();
  });
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
