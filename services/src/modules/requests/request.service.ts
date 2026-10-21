import { type PrismaClient } from '@prisma/client';
import { EscalationRepository } from './escalation.repository.js';
import { PatientRequestService } from './patient-request.service.js';
import { RequestCommandService } from './request-command.service.js';
import { RequestQueryService } from './request-query.service.js';
import { RequestRepository } from './request.repository.js';

// The patient request lifecycle, in three parts: what staff read (queries),
// what patients do with their own requests (patients), and how staff move a
// request along (commands). Every change is version-checked and adds one
// append-only event; the state machine is in request-transitions.ts.
export class RequestService {
  public readonly queries: RequestQueryService;
  public readonly patients: PatientRequestService;
  public readonly commands: RequestCommandService;

  public constructor(
    database: PrismaClient,
    requests = new RequestRepository(),
    escalationSteps = new EscalationRepository(),
  ) {
    this.queries = new RequestQueryService(database, requests, escalationSteps);
    this.patients = new PatientRequestService(database, requests);
    this.commands = new RequestCommandService(database, requests);
  }
}
