import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '../../src/config/logger.js';
import {
  levelsReached,
  stageOf,
  startEscalationWorker,
  type EscalationService,
} from '../../src/modules/requests/escalation.service.js';

const logger = createLogger('silent');
const level = (number: number, afterMinutes: number) => ({
  level: number,
  afterMinutes,
  targetType: 'ROLE' as const,
  roleId: 'role',
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Escalation rules', () => {
  it('fires each level once its delay after the missed deadline has passed', () => {
    const due = new Date('2026-10-12T10:00:00Z');
    const levels = [level(1, 0), level(2, 30), level(3, 60)];
    const at = (iso: string) => levelsReached(levels, due, new Date(iso)).map((item) => item.level);
    expect(at('2026-10-12T09:59:59Z')).toEqual([]);
    expect(at('2026-10-12T10:00:00Z')).toEqual([1]);
    expect(at('2026-10-12T10:29:59Z')).toEqual([1]);
    expect(at('2026-10-12T10:30:00Z')).toEqual([1, 2]);
    expect(at('2026-10-12T12:00:00Z')).toEqual([1, 2, 3]);
  });

  it('knows which deadline an open request waits on', () => {
    expect(stageOf('SUBMITTED')).toBe('ACCEPT');
    expect(stageOf('ASSIGNED')).toBe('ACCEPT');
    expect(stageOf('ACCEPTED')).toBe('COMPLETE');
    expect(stageOf('IN_PROGRESS')).toBe('COMPLETE');
    for (const status of ['COMPLETED', 'CLOSED', 'CANCELLED', 'REJECTED'] as const) {
      expect(stageOf(status)).toBeNull();
    }
  });
});

describe('Escalation worker', () => {
  it('never overlaps runs, retries after a failure, and waits for a run when stopping', async () => {
    vi.useFakeTimers();
    let finish: () => void = () => undefined;
    const run = vi
      .fn<() => Promise<number>>()
      .mockImplementationOnce(() => new Promise((resolve) => (finish = () => resolve(0))))
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValue(1);
    const worker = startEscalationWorker({ run } as unknown as EscalationService, logger, 1_000);
    expect(run).toHaveBeenCalledTimes(1);

    // Still running: later ticks skip.
    await vi.advanceTimersByTimeAsync(3_000);
    expect(run).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run).toHaveBeenCalledTimes(2); // this one fails…
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run).toHaveBeenCalledTimes(3); // …and the next tick tries again.

    await worker.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledTimes(3);
  });
});
