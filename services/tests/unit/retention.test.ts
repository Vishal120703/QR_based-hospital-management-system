import { afterEach, describe, expect, it, vi } from 'vitest';
import { type PrismaClient } from '@prisma/client';
import { createLogger } from '../../src/config/logger.js';
import {
  RetentionService,
  startRetentionWorker,
} from '../../src/modules/retention/retention.service.js';

const count = (value: number) => vi.fn().mockResolvedValue({ count: value });

function database() {
  return {
    staffSession: { deleteMany: count(1) },
    platformSession: { deleteMany: count(2) },
    guestSession: { deleteMany: count(3) },
    staffNotification: { deleteMany: count(4) },
    notificationDispatch: { deleteMany: count(5) },
    auditLog: { deleteMany: count(6) },
  } as unknown as PrismaClient;
}

afterEach(() => vi.useRealTimers());

describe('retention', () => {
  it('uses separate session, notification, and explicit audit cutoffs', async () => {
    const db = database();
    const service = new RetentionService(db, {
      sessionDays: 30,
      notificationDays: 180,
      auditDays: 365,
    });
    const now = new Date('2026-10-21T12:00:00.000Z');

    await expect(service.run(now)).resolves.toEqual({
      staffSessions: 1,
      platformSessions: 2,
      guestSessions: 3,
      notifications: 4,
      dispatchReceipts: 5,
      auditLogs: 6,
    });
    expect(db.staffNotification.deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: new Date('2026-04-24T12:00:00.000Z') } },
    });
    expect(db.auditLog.deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: new Date('2025-10-21T12:00:00.000Z') } },
    });
  });

  it('does not delete audit history until a policy is chosen', async () => {
    const db = database();
    await new RetentionService(db, {
      sessionDays: 30,
      notificationDays: 180,
      auditDays: null,
    }).run();
    expect(db.auditLog.deleteMany).not.toHaveBeenCalled();
  });

  it('runs immediately, never overlaps, retries later, and stops cleanly', async () => {
    vi.useFakeTimers();
    let finish: () => void = () => undefined;
    const run = vi
      .fn<() => Promise<Awaited<ReturnType<RetentionService['run']>>>>()
      .mockImplementationOnce(
        () =>
          new Promise(
            (resolve) =>
              (finish = () =>
                resolve({
                  staffSessions: 0,
                  platformSessions: 0,
                  guestSessions: 0,
                  notifications: 0,
                  dispatchReceipts: 0,
                  auditLogs: 0,
                })),
          ),
      )
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValue({
        staffSessions: 1,
        platformSessions: 0,
        guestSessions: 0,
        notifications: 0,
        dispatchReceipts: 0,
        auditLogs: 0,
      });
    const worker = startRetentionWorker(
      { run } as unknown as RetentionService,
      createLogger('silent'),
      1_000,
    );
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(run).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run).toHaveBeenCalledTimes(3);
    await worker.stop();
  });
});
