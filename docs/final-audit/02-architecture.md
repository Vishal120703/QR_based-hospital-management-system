# Architecture evidence — stages 1–2

Current app is a modular monolith: one Express/Prisma backend and one React/Vite frontend. app.ts adds shared middleware and mounts the routes; container.ts is the composition root and routes/index.ts groups STAFF, PLATFORM and patient/public routes. Domain modules contain route/controller/schema/service/repository layers and expose public index.ts interfaces. The current architecture diagrams are in ../architecture/README.md and ../architecture/data-flow.md; the ER freshness check passed.

Hospital is the tenant; Client owns one or more hospitals. Hospital staff, platform operators, and guests resolve tokens using separate session tables. Staff permissions are derived from active persisted roles/scopes, not submitted UI values. Hospital-wide guards check hospitalPermissions; scoped guards check permissions and rely on service-level target filtering. RequestAreaWhere, visibleRequestsWhere, areaFilters and canAccessLocation enforce distinct read/command areas. The report person fallback omits that target-area step (AUD-001).

Reviewed assembly paths: services/src/app.ts, container.ts, server route configuration, all module routes and generic CRUD registration. The optional configureRoutes hook is used for tests; no configured production route hook was found. Public health/readiness, logins, QR exchange and logo routes are intentional.

This is sufficient architecture context for the route/isolation audit. Complete database-trigger review, transaction/state-machine review, deployment architecture, inactive/future code classification, and real-time/queue safeguards are deferred to their later stages.
