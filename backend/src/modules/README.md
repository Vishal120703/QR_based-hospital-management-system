# Backend module boundaries

CARE QR uses a modular monolith. A module is created only when its planned phase begins. Keep each module flat until its size requires more structure:

```text
<module>/
├── <module>.service.ts   Use cases and persistence operations
├── <module>.routes.ts    HTTP validation and routing
└── <helper>.ts           Focused domain helpers, only when used
```

Planned domain modules are `auth`, `tenancy`, `users`, `roles`, `hospitals`, `locations`, `qr`, `bed-sessions`, `departments`, `staff`, `services`, `routing`, `requests`, `assignments`, `sla`, `notifications`, `feedback`, `audit`, and `analytics`.

`locations` owns the whole Building → Floor → Ward → Room → Bed hierarchy, including beds, because its invariants span levels (see [`docs/architecture/location-hierarchy.md`](../../../docs/architecture/location-hierarchy.md)). `audit` currently provides `recordStaffAudit`, which must run inside the transaction of the change it records.

Rules:

- Controllers call application use cases and never Prisma directly.
- A module owns access to its persistence model and business invariants.
- Cross-module use goes through the target module's exported application interface.
- Asynchronous side effects use typed events emitted only after the source transaction commits.
- Shared code is technical or contract-level code, not displaced domain logic.
- `hospitalId` is passed through trusted tenant context for every tenant-owned operation.
- Administrative routers are mounted under `/admin`, which authenticates the staff session once. Routers declare paths relative to `/admin` and check permissions per route.
- Every handler validates its params, query, and body with strict Zod schemas. Commands (`POST`, `PATCH`, `DELETE`) never accept query parameters; this is also enforced globally.
- A module may be extracted later, but no in-process module behaves like a network service in V1.
