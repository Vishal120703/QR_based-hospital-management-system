# Backend modules

CARE QR is one deployable backend with domain modules. The [architecture guide](../../../docs/architecture/README.md) explains the system and the [module catalog](../../../docs/architecture/modules.md) names each module's responsibility.

Each module is flat and contains only files it needs:

```text
modules/departments/
├── index.ts                    Public interface for the container and other modules
├── department.routes.ts        Paths and permission guards
├── department.controller.ts    HTTP input/output and Zod parsing
├── department.schemas.ts       Input schemas and inferred types
├── department.service.ts       Business rules and transaction boundaries
└── department.repository.ts    Prisma queries
```

Larger modules have multiple entities (for example `staff.*` and `shift.*`), split a large service by job (`locations` has one service per level; `requests` has query, patient, and command services composed by `request.service.ts`), or keep small pure helpers (`request-transitions.ts`, `report-metrics.ts`). `reports` is read-only, while `audit` records changes in the caller's transaction. Do not create empty placeholder files or folders merely to match a template. The [code map](../../../docs/architecture/code-map.md) follows three real requests through these files.

When a module grows, keep its service readable as a list of use cases. Extract a
named helper only when it has one clear reason to change:

- `*-rules.ts` holds reusable authorization or domain invariants, with direct unit tests.
- `*-view.ts` maps repository rows to stable API responses or small audit snapshots.
- A specific workflow gets its own descriptive file (`bulk-staff.ts`, `qr-batch.ts`) instead of a generic `utils.ts`.
- Security mechanics such as QR token hashing/encryption stay behind a narrow object (`QrTokenCodec`) so orchestration code cannot accidentally implement them differently.

Shared transport-neutral patterns live in `src/common/`; for example `pagination.ts` supplies the offset calculation and standard page response used by simple list endpoints. Keep a rule inside its owning module until at least two unrelated modules genuinely need it.

## Boundary rules

- A route declares an HTTP method, URL, and permission guard; a controller parses transport input and calls a service.
- Services own business decisions, tenant/scope checks, and transactions. Repositories own Prisma queries and accept the shared client or an existing transaction.
- A service method should read top-to-bottom as one use case: load/validate, change state, audit, return a view. Move mapping and reusable rules to the named helpers above rather than growing a long private-method section.
- A module imports another module only through its `index.ts`. Repositories stay private: `index.ts` never exports one, so cross-module reads and writes use the owner module's exported service or helper.
- Input rules shared by several modules (codes, names, emails, passwords, date ranges) come from `src/common/validation.ts`; validation errors are turned into plain messages by `src/common/validation-errors.ts`.
- Hospital-owned records are selected with server-derived `hospitalId`; never accept it as authority from the browser.
- Administrative routes mount under `/admin` after staff authentication. Guest routes mount under `/public` and apply guest authentication only where needed.
- `src/container.ts` creates services/controllers. `src/routes/index.ts` mounts every module's routes in their groups. `src/app.ts` owns shared HTTP middleware.
- Service ESLint rules enforce import and repository boundaries; run lint, types, unit tests, integration tests with a disposable database, and build after changing a module.

The `notifications` module owns the persistent staff inbox, recipient resolution, durable event processing, and authenticated Socket.IO delivery; see [notification architecture](../../../docs/architecture/notifications.md).

See [how to add a feature](../../../docs/adding-a-feature.md) for a concrete checklist. Planned future concerns (automatic routing, feedback) do not get modules until implemented.
