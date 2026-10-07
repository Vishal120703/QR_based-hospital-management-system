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

Larger modules have multiple entities (for example `staff.*` and `shift.*`) or small pure helpers. `reports` is read-only, while `audit` records changes in the caller's transaction. Do not create empty placeholder files or folders merely to match a template.

## Boundary rules

- A route declares an HTTP method, URL, and permission guard; a controller parses transport input and calls a service.
- Services own business decisions, tenant/scope checks, and transactions. Repositories own Prisma queries and accept the shared client or an existing transaction.
- A module imports another module only through its `index.ts`. Repositories stay private: `index.ts` never exports one, so cross-module reads and writes use the owner module's exported service or helper.
- Input rules shared by several modules (codes, names, emails, passwords, date ranges) come from `src/common/validation.ts`; validation errors are turned into plain messages by `src/common/validation-errors.ts`.
- Hospital-owned records are selected with server-derived `hospitalId`; never accept it as authority from the browser.
- Administrative routes mount under `/admin` after staff authentication. Guest routes mount under `/public` and apply guest authentication only where needed.
- `src/container.ts` creates services/controllers and wires the route groups. `src/app.ts` owns shared HTTP middleware.
- Service ESLint rules enforce import and repository boundaries; run lint, types, unit tests, integration tests with a disposable database, and build after changing a module.

See [how to add a feature](../../../docs/adding-a-feature.md) for a concrete checklist. Planned future concerns (automatic routing, notifications, feedback) do not get modules until implemented.
