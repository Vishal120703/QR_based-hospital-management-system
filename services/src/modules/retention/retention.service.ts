import { type PrismaClient } from '@prisma/client';
import { type Logger } from 'pino';
import { RetentionRepository } from './retention.repository.js';

const dayMs = 86_400_000;

export interface RetentionPolicy {
  readonly sessionDays: number;
  readonly notificationDays: number;
  readonly auditDays: number | null;
}

export interface RetentionResult {
  readonly staffSessions: number;
  readonly platformSessions: number;
  readonly guestSessions: number;
  readonly notifications: number;
  readonly dispatchReceipts: number;
  readonly auditLogs: number;
}

export class RetentionService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly policy: RetentionPolicy,
    private readonly repository = new RetentionRepository(),
  ) {}

  public async run(now = new Date()): Promise<RetentionResult> {
    const sessionCutoff = new Date(now.getTime() - this.policy.sessionDays * dayMs);
    const notificationCutoff = new Date(now.getTime() - this.policy.notificationDays * dayMs);
    const auditCutoff = this.policy.auditDays
      ? new Date(now.getTime() - this.policy.auditDays * dayMs)
      : null;
    const [staff, platform, guest, notifications, dispatch, audit] = await Promise.all([
      this.repository.deleteStaffSessions(this.database, sessionCutoff),
      this.repository.deletePlatformSessions(this.database, sessionCutoff),
      this.repository.deleteGuestSessions(this.database, sessionCutoff),
      this.repository.deleteNotifications(this.database, notificationCutoff),
      this.repository.deleteDispatchReceipts(this.database, notificationCutoff),
      auditCutoff
        ? this.repository.deleteAuditLogs(this.database, auditCutoff)
        : Promise.resolve({ count: 0 }),
    ]);
    return {
      staffSessions: staff.count,
      platformSessions: platform.count,
      guestSessions: guest.count,
      notifications: notifications.count,
      dispatchReceipts: dispatch.count,
      auditLogs: audit.count,
    };
  }
}

export function startRetentionWorker(
  service: RetentionService,
  logger: Logger,
  intervalMs: number,
): { stop(): Promise<void> } {
  let running: Promise<void> | null = null;
  const tick = () => {
    if (running) return;
    running = service
      .run()
      .then((removed) => {
        const total =
          removed.staffSessions +
          removed.platformSessions +
          removed.guestSessions +
          removed.notifications +
          removed.dispatchReceipts +
          removed.auditLogs;
        if (total > 0) logger.info({ removed }, 'Expired operational records removed');
      })
      .catch((error: unknown) => {
        logger.error({ err: error }, 'Retention run failed; it will be retried');
      })
      .finally(() => {
        running = null;
      });
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  tick();
  return {
    async stop() {
      clearInterval(timer);
      await running;
    },
  };
}
