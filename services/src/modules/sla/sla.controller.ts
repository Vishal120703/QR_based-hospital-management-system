import { CrudController } from '../../http/crud.js';
import { type EscalationPolicyService } from './escalation-policy.service.js';
import { type SlaPolicyService } from './sla-policy.service.js';
import {
  createEscalationPolicySchema,
  createSlaPolicySchema,
  slaFilterSchema,
  updateEscalationPolicySchema,
  updateSlaPolicySchema,
} from './sla.schemas.js';

// Response-time targets and escalation policies, both standard resources.
export class SlaController {
  public readonly policies;
  public readonly escalations;

  public constructor(slaPolicies: SlaPolicyService, escalationPolicies: EscalationPolicyService) {
    this.policies = new CrudController(
      {
        list: (context) => slaPolicies.list(context),
        get: (context, id) => slaPolicies.get(context, id),
        create: (context, input, requestId) => slaPolicies.create(context, input, requestId),
        update: (context, id, input, requestId) =>
          slaPolicies.update(context, id, input, requestId),
        remove: (context, id, requestId) => slaPolicies.remove(context, id, requestId),
      },
      { singular: 'slaPolicy', plural: 'slaPolicies' },
      { filter: slaFilterSchema, create: createSlaPolicySchema, update: updateSlaPolicySchema },
    );
    this.escalations = new CrudController(
      {
        list: (context) => escalationPolicies.list(context),
        get: (context, id) => escalationPolicies.get(context, id),
        create: (context, input, requestId) => escalationPolicies.create(context, input, requestId),
        update: (context, id, input, requestId) =>
          escalationPolicies.update(context, id, input, requestId),
        remove: (context, id, requestId) => escalationPolicies.remove(context, id, requestId),
      },
      { singular: 'escalationPolicy', plural: 'escalationPolicies' },
      {
        filter: slaFilterSchema,
        create: createEscalationPolicySchema,
        update: updateEscalationPolicySchema,
      },
    );
  }
}
