# API module boundaries

CARE QR uses a modular monolith. A module is created only when its planned phase begins, using this internal shape where applicable:

```text
<module>/
├── application/       Use cases, commands, queries, and public module interface
├── domain/            Entities, value objects, policies, and domain events
├── infrastructure/    Prisma repositories and infrastructure adapters
├── transport/         HTTP schemas/controllers and event consumers
└── index.ts            Deliberate public exports only
```

Planned domain modules are `auth`, `tenancy`, `users`, `roles`, `hospitals`, `locations`, `beds`, `qr`, `bed-sessions`, `departments`, `staff`, `services`, `routing`, `requests`, `assignments`, `sla`, `notifications`, `feedback`, `audit`, and `analytics`.

Rules:

- Controllers call application use cases and never Prisma directly.
- A module owns access to its persistence model and business invariants.
- Cross-module use goes through the target module's exported application interface.
- Asynchronous side effects use typed events emitted only after the source transaction commits.
- Shared code is technical or contract-level code, not displaced domain logic.
- `hospitalId` is passed through trusted tenant context for every tenant-owned operation.
- A module may be extracted later, but no in-process module behaves like a network service in V1.
