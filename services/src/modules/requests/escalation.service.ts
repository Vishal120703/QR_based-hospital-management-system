import {
  type EscalationStage,
  type EscalationTarget,
  type PrismaClient,
  type RequestStatus,
} from '@prisma/client';
import { type Logger } from 'pino';
import { recordSystemAudit } from '../audit/index.js';
import { findEscalationLevels } from '../sla/index.js';
import { EscalationRepository } from './escalation.repository.js';
import { overdueWhere } from './request.service.js';

// The SLA worker: carries out each request's escalation policy once its
// current deadline (accept, then complete) is missed. A level fires when the
// deadline is `afterMinutes` past. Each step is recorded once (a unique key),
// so several API processes, restarts, or overlapping runs never repeat one.
// A request that was accepted, finished, or cancelled meanwhile is left alone.

interface Level {
  readonly level: number;
  readonly afterMinutes: number;
  readonly targetType: EscalationTarget;
  readonly roleId: string | null;
}

const stageStatuses: Record<EscalationStage, readonly RequestStatus[]> = {
  ACCEPT: ['SUBMITTED', 'ASSIGNED'],
  COMPLETE: ['ACCEPTED', 'IN_PROGRESS'],
};

// Which deadline an open request is waiting on, or null when it is not open.
export function stageOf(status: RequestStatus): EscalationStage | null {
  if (stageStatuses.ACCEPT.includes(status)) return 'ACCEPT';
  if (stageStatuses.COMPLETE.includes(status)) return 'COMPLETE';
  return null;
}

// The levels whose time has come: `afterMinutes` past the missed deadline.
export function levelsReached(levels: readonly Level[], dueAt: Date, now: Date): Level[] {
  return levels.filter((level) => dueAt.getTime() + level.afterMinutes * 60_000 <= now.getTime());
}

// Thrown inside the transaction to undo it when the request moved on.
class MovedOn extends Error {}

export class EscalationService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly escalations = new EscalationRepository(),
  ) {}

  // One pass over the most overdue requests (at most `batch`); returns how
  // many new escalation steps were taken.
  public async run(now = new Date(), batch = 500): Promise<number> {
    const due = await this.escalations.findOverdue(this.database, overdueWhere(now), batch);
    const policies = [
      ...new Map(
        due.map((request) => [
          `${request.hospitalId}:${request.escalationPolicyId}`,
          { hospitalId: request.hospitalId, id: request.escalationPolicyId! },
        ]),
      ).values(),
    ];
    const levelsOf = new Map<string, Level[]>();
    for (const level of await findEscalationLevels(this.database, policies)) {
      const key = `${level.hospitalId}:${level.escalationPolicyId}`;
      levelsOf.set(key, [...(levelsOf.get(key) ?? []), level]);
    }

    let taken = 0;
    for (const request of due) {
      const stage = stageOf(request.status);
      if (!stage) continue;
      const dueAt = stage === 'ACCEPT' ? request.acceptDueAt : request.completeDueAt;
      const levels = levelsOf.get(`${request.hospitalId}:${request.escalationPolicyId}`) ?? [];
      const reached = levelsReached(levels, dueAt, now);
      if (reached.length === 0) continue;
      const highest = Math.max(...reached.map((level) => level.level));
      if (request.isEscalated && request.escalationLevel >= highest) continue;
      taken += await this.escalate(request, stage, dueAt, reached, highest);
    }
    return taken;
  }

  private async escalate(
    request: { id: string; hospitalId: string },
    stage: EscalationStage,
    dueAt: Date,
    reached: readonly Level[],
    highest: number,
  ): Promise<number> {
    try {
      return await this.database.$transaction(async (transaction) => {
        const created = await this.escalations.create(
          transaction,
          reached.map((level) => ({
            hospitalId: request.hospitalId,
            requestId: request.id,
            stage,
            level: level.level,
            targetType: level.targetType,
            roleId: level.roleId,
            dueAt,
          })),
        );
        const marked = await this.escalations.markEscalated(
          transaction,
          request.hospitalId,
          request.id,
          stageStatuses[stage],
          highest,
        );
        if (marked === 0) throw new MovedOn();
        if (created > 0) {
          await recordSystemAudit(transaction, {
            hospitalId: request.hospitalId,
            action: 'request.escalate',
            targetType: 'ServiceRequest',
            targetId: request.id,
            metadata: {
              deadline: stage === 'ACCEPT' ? 'accept' : 'complete',
              level: highest,
            },
          });
        }
        return created;
      });
    } catch (error) {
      if (error instanceof MovedOn) return 0;
      throw error;
    }
  }
}

// Runs the SLA worker every `intervalMs` inside this API process. Runs never
// overlap; a failed run is logged and retried on the next tick. stop() waits
// for a run in progress, so shutdown can then close the database.
export function startEscalationWorker(
  service: EscalationService,
  logger: Logger,
  intervalMs: number,
): { stop(): Promise<void> } {
  let running: Promise<void> | null = null;
  const tick = () => {
    if (running) return;
    running = service
      .run()
      .then(
        (taken) => {
          if (taken > 0) logger.info({ escalations: taken }, 'Escalated overdue requests');
        },
        (error: unknown) => {
          logger.error({ err: error }, 'Escalation run failed; it will be retried');
        },
      )
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
