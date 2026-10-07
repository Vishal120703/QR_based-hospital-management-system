# Add a feature without making another app

CARE QR stays one backend and one frontend. Extend an existing domain module if it already owns the data; create a new `services/src/modules/<name>/` only for a genuinely new responsibility. The [module catalog](./architecture/modules.md) lists current owners.

## Backend checklist

1. Write the behavior, tenant boundary, permission, and request/response shape. If data changes, edit `services/prisma/schema.prisma`, add a reviewed migration, run `npm run prisma:generate` in `services/`, and regenerate the [ER diagram](./database/er-diagram.md) with `npm run docs:er`. Never edit a deployed migration in place.
2. Put strict Zod input schemas in `*.schemas.ts`. Put URLs and permission guards in `*.routes.ts`; HTTP parsing and responses in `*.controller.ts`; decisions and transactions in `*.service.ts`; Prisma reads/writes in `*.repository.ts`.
3. Export only the public service/helper/controller/route interface from `index.ts`. Other modules import that file, never another module's internals. Pass the current transaction into exported cross-module write functions when both changes must commit together.
4. Wire the new controller/routes in `services/src/container.ts`. Shared middleware belongs in `src/middleware/` only if several modules need it; do not add a second server or network call between in-process modules.
5. Add unit tests for pure rules and integration tests for success, denied permission, wrong hospital/scope, invalid input, rollback, and concurrency where relevant. Integration tests require a separate disposable `TEST_DATABASE_URL` with migrations applied.

Flow: `HTTP → middleware → route → controller/Zod → service → repository → PostgreSQL`. See [data flow](./architecture/data-flow.md) and [tenant rules](./architecture/tenant-rules.md).

## Frontend checklist

1. Put page-specific UI in `frontend/src/features/<area>/`; add a new feature folder only if no existing area owns it. Shared, genuinely reused UI belongs in `components/`; non-UI helpers in `lib/`.
2. Put endpoint calls in the matching `frontend/src/api/` file and export through `api/index.ts`. Keep server authorization authoritative; hiding a control by permission is only a usability aid.
3. Add the route in `frontend/src/main.tsx`; add staff navigation in `features/workspace/AdminLayout.tsx` only when the page is actually available to that role. Check phone and desktop widths, loading/error/empty states, keyboard focus, and patient access without login where applicable.
4. Add interaction tests in `frontend/tests/` and update the plain-language guide if the workflow changed.

## Verify before handoff

Run `format:check`, `lint`, `typecheck`, tests, and `build` in both apps. In `services/`, also run `prisma:validate`, `docs:er:check`, and database integration tests against the isolated test database. Check local documentation links and the [full manual testing guide](./guides/full-testing-guide.md) for the affected role. Do not call a phase complete from compilation alone.
