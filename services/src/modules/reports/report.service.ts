import { type Prisma, type PrismaClient } from '@prisma/client';
import { NotFoundError } from '../../common/errors/app-error.js';
import { type StaffContext } from '../auth/index.js';
import { requestAreaWhere } from '../requests/index.js';
import { personActivity } from './person-activity.js';
import { mentionedPeople, toRequestFacts, type RequestFacts } from './report-facts.js';
import {
  emptyWork,
  groupFacts,
  notCompleted,
  requestSummary,
  staffPerformance,
} from './report-metrics.js';
import { ReportRepository } from './report.repository.js';

// Request reports. This service loads the requests in the caller's report
// area and checks access; the facts and figures are computed by the pure
// functions in report-facts.ts, report-metrics.ts, and person-activity.ts.

export interface ReportRange {
  readonly from: Date;
  readonly to: Date;
}

export interface LogFilter {
  readonly outcome?: 'open' | 'completed' | 'cancelled' | 'rejected' | 'overdue' | undefined;
  readonly departmentId?: string | undefined;
  readonly membershipId?: string | undefined;
  readonly search?: string | undefined;
}

const maxRequests = 20_000;
const maxLogRows = 2_000;

export class ReportService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly reports = new ReportRepository(),
  ) {}

  // Requests submitted in the range, in the caller's report area, with their
  // full history and the names of everyone involved.
  public async requestFacts(
    context: StaffContext,
    range: ReportRange,
    now = new Date(),
  ): Promise<{ facts: RequestFacts[]; truncated: boolean }> {
    const area = requestAreaWhere(context, 'analytics.read');
    if (!area) return { facts: [], truncated: false };
    const where: Prisma.ServiceRequestWhereInput = {
      hospitalId: context.tenant.hospitalId,
      submittedAt: { gte: range.from, lt: range.to },
      ...(Object.keys(area).length > 0 ? { AND: [area] } : {}),
    };
    const rows = await this.reports.findRequestsWithHistory(this.database, where, maxRequests + 1);
    const truncated = rows.length > maxRequests;
    const requests = rows.slice(0, maxRequests);

    const people = await this.reports.findMemberNames(
      this.database,
      context.tenant.hospitalId,
      mentionedPeople(requests),
    );
    const nameOf = (id: string | null | undefined) =>
      id ? (people.find((person) => person.id === id)?.user.displayName ?? 'Former staff') : null;

    const facts = requests.map((request) => toRequestFacts(request, nameOf, now));
    return { facts, truncated };
  }

  public async requestReport(context: StaffContext, range: ReportRange, now = new Date()) {
    const { facts, truncated } = await this.requestFacts(context, range, now);
    return {
      range,
      truncated,
      summary: requestSummary(facts),
      byDepartment: groupFacts(
        facts,
        (fact) => fact.departmentId,
        (fact) => fact.departmentName,
      ),
      byService: groupFacts(
        facts,
        (fact) => fact.serviceName,
        (fact) => fact.serviceName,
      ),
      byStaff: staffPerformance(facts).rows,
      notCompleted: notCompleted(facts),
    };
  }

  public async requestLog(
    context: StaffContext,
    range: ReportRange,
    filter: LogFilter,
    now = new Date(),
  ) {
    const { facts, truncated } = await this.requestFacts(context, range, now);
    const search = filter.search?.trim().toLowerCase();
    const rows = facts.filter(
      (fact) =>
        (!filter.outcome ||
          (filter.outcome === 'overdue'
            ? fact.overdueMinutes !== null
            : fact.outcome === filter.outcome)) &&
        (!filter.departmentId || fact.departmentId === filter.departmentId) &&
        (!filter.membershipId || fact.involved.includes(filter.membershipId)) &&
        (!search ||
          `${fact.publicId} ${fact.serviceName} ${fact.location}`.toLowerCase().includes(search)),
    );
    return {
      truncated: truncated || rows.length > maxLogRows,
      requests: rows.slice(0, maxLogRows).map(({ events, involved, ...row }) => {
        void events;
        void involved;
        return row;
      }),
    };
  }

  // One person's work in the period: the same figures as their row in the
  // hospital report, the hospital-wide averages to compare with, and every
  // action they took or that was given to them, newest first.
  public async personReport(
    context: StaffContext,
    membershipId: string,
    range: ReportRange,
    now = new Date(),
  ) {
    const { facts, truncated } = await this.requestFacts(context, range, now);
    const performance = staffPerformance(facts);
    let work = performance.rows.find((row) => row.membershipId === membershipId);
    if (!work) {
      // No work in this period. Hospital-wide managers may open anyone in the
      // hospital; a floor, ward, or department manager only someone who has
      // worked on requests in their area, so an ID alone reveals nobody else.
      const area = requestAreaWhere(context, 'analytics.read');
      const [member] = area
        ? await this.reports.findMemberNames(this.database, context.tenant.hospitalId, [
            membershipId,
          ])
        : [];
      const allowed =
        member !== undefined &&
        (Object.keys(area ?? {}).length === 0 ||
          (await this.reports.findInvolvement(
            this.database,
            { hospitalId: context.tenant.hospitalId, AND: [area ?? {}] },
            membershipId,
          )) !== null);
      // The same answer for an unknown ID and for someone outside the area.
      if (!member || !allowed) {
        throw new NotFoundError('There is no report for this person in your area.');
      }
      work = emptyWork(membershipId, member.user.displayName);
    }
    return {
      range,
      truncated,
      person: { membershipId, name: work.name },
      work,
      hospital: performance.overall,
      people: performance.rows
        .map((row) => ({ membershipId: row.membershipId, name: row.name }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      activity: personActivity(facts, membershipId),
    };
  }

  // One request's full history, if it is in the caller's report area.
  public async requestTimeline(context: StaffContext, id: string, now = new Date()) {
    const area = requestAreaWhere(context, 'analytics.read');
    const request = area
      ? await this.reports.findSubmittedAt(this.database, {
          hospitalId: context.tenant.hospitalId,
          id,
          ...(Object.keys(area).length > 0 ? { AND: [area] } : {}),
        })
      : null;
    if (!request) throw new NotFoundError();
    const at = request.submittedAt;
    const { facts } = await this.requestFacts(
      context,
      { from: at, to: new Date(at.getTime() + 1) },
      now,
    );
    const fact = facts.find((item) => item.id === id);
    if (!fact) throw new NotFoundError();
    const { involved, ...rest } = fact;
    void involved;
    return rest;
  }
}
