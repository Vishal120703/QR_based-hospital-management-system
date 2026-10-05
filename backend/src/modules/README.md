# Backend module boundaries

CARE QR uses a modular monolith. A module is created only when its planned phase begins. Keep each module flat until its size requires more structure:

```text
<module>/
├── <module>.service.ts   Use cases and persistence operations
├── <module>.routes.ts    HTTP validation and routing
└── <helper>.ts           Focused domain helpers, only when used
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
