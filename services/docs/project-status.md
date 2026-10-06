# CARE QR project status

Last reviewed: 2026-10-06

Phases **0–8 are implemented**: nine phases when the architecture phase is counted. Implementation is not the same as production acceptance; each phase must pass its verification gates. The next planned phase is **Phase 9 — Manual Routing**.

## Implemented phases

| Phase | What is available |
|---|---|
| 0 — Architecture freeze | Modular monolith, tenant boundary, authentication domains, request states, QR/session rules, and SLA definitions documented. |
| 1 — Engineering foundation | Express/TypeScript backend, Prisma, environment validation, safe errors, request IDs, structured logging, health/readiness endpoints, linting, formatting, and tests. |
| 2 — Tenancy and hospital foundation | Hospital bootstrap/settings, staff authentication, memberships, roles, permissions, authorization scopes, tenant-isolated APIs, and administrative audit records. |
| 3 — Locations | Building → Floor → Ward → Room → Bed administration, optional buildings/rooms, tenant-safe relationships, and protected hierarchy changes. |
| 4 — Secure QR and sessions | Hashed opaque QR tokens, generation/rotation/revocation, bed occupancy sessions, short-lived guest sessions, scanning, and initial frontend administration. |
| 5 — Staff and departments | Editable departments, staff memberships, roles, coverage, duty status, shifts, and the shared eligibility check. |
| 6 — Catalog and SLA | Editable service categories/items, patient catalog preview, versioned SLA timings, escalation policy configuration, and a request snapshot helper. |
| 7 — Request core and state machine | Tenant-scoped ServiceRequest and append-only RequestEvent persistence, immutable catalog/SLA snapshots, duplicate-active-request protection, manual assignment commands, guarded transitions, and concurrency/rollback tests. |
| 8 — Public patient request flow | Guest-authenticated submission, tracking, and early cancellation; active duplicate submissions return the existing request. The patient screen includes request history/status, a language choice, and retry/error handling. |

The frontend can administer earlier features and now submit, track, and cancel patient requests. Operational routing, manager and staff request dashboards, realtime updates, and notifications are not implemented yet. A new request stays `SUBMITTED` until staff process it through the existing command API or later workflow screens.

## Pending phases

| Phase | Planned work |
|---|---|
| 9 | Manual routing |
| 10 | Manager dashboard |
| 11 | Staff request workflow |
| 12 | Pool routing |
| 13 | SLA worker and escalation execution |
| 14 | Realtime updates |
| 15 | Notifications |
| 16 | Feedback and complaints |
| 17 | Audit access and reporting |
| 18 | Analytics |
| 19 | Security hardening |
| 20 | Complete integration testing |
| 21 | Failure testing |
| 22 | Load testing |
| 23 | Deployment pipeline |
| 24 | Staging acceptance |
| 25 | Pilot ward |

Administrative audit writes and security checks already exist; their presence does not mark the dedicated later audit and hardening phases complete.

## Where code belongs

The repository has only two application folders:

- `frontend/`: one React app, with staff administration and patient routes in `src/pages`; shared API calls and UI components stay in `src`.
- `services/`: one backend service. Domain behavior lives in `src/modules/<domain>`, technical infrastructure in `src/common`, `src/config`, `src/database`, and `src/middleware`, and database history in `prisma/migrations`.

Each module keeps routes, services, and necessary helpers together. Routes validate transport inputs and call services. Modules own their business rules and writes; cross-module writes use the owner's exported functions, while tenant-scoped validation/display reads are allowed. Add a folder only when real functionality needs it. No microservices or additional frontend apps are required for V1.

## Verification requirements

Before moving to the next phase, run the backend format check, lint, typecheck, unit tests, integration tests, build, Prisma validation, and migration status. Run the frontend format check, lint, typecheck, and build, plus relevant browser interaction checks. The exact commands are in the root README.

Integration tests must use `TEST_DATABASE_URL` pointing at a disposable PostgreSQL database with all migrations applied. Do not use a production database. Confirm tenant isolation, permission checks, audit coupling, and important concurrency rules for any changed behavior. A failed gate must be fixed or reported before the next phase starts.

Phase 7 verification: backend format, lint, typecheck, unit tests (8), integration tests (74, serial), build, Prisma validation, migration application, and schema-drift check passed against a disposable PostgreSQL 18 database. Frontend format, lint, typecheck, tests (23), and build also passed. One parallel integration run hit a transient serializable conflict in the unchanged Phase 5 staff suite; its isolated rerun and the full serial run passed.

Phase 8 verification: backend format, lint, typecheck, unit tests (8), integration tests (83, serial), build, Prisma validation, and migration status passed against a disposable PostgreSQL 18 database. Frontend format, lint, typecheck, interaction tests (29), and build passed. Guest request tests cover duplicate races, cross-bed and cross-hospital isolation, cancellation concurrency, expiry, closure, and QR rotation.

Demo-seed/documentation verification on 2026-10-06: using Node 24.19.0 and a temporary, isolated PostgreSQL 18 cluster, all six migrations applied; `seed:demo` created one hospital, seven departments, four services, two beds, one active bed session, and five memberships (admin plus four staff). A second seed run correctly refused to overwrite it. Backend format/lint/typecheck, 8 unit tests, 83 integration tests, build, and Prisma validation passed; frontend format/lint/typecheck, 29 tests, and build passed. The temporary database was removed afterward. This did **not** verify normal live Redis startup or the current user's browser session; follow the [manual test plan](./manual-test-plan-phases-0-8.md) for those checks.

## Important limitations

- Phase 8 uses the request core to store real patient submissions. Routing is not automatic yet, so a request can remain `SUBMITTED` until staff use the command API or later dashboard.
- Escalation policies are configuration only; no SLA worker executes them yet.
- A shift does not automatically switch a staff member on or off duty.
- QR resolution rate limits are per backend process; shared limits and reverse-proxy configuration remain part of hardening.
- Live Redis connectivity has not been verified by this audit. Current dependency tests use test doubles, and the server requires Redis at startup.
- Passing development checks does not establish production readiness. Deployment, failure/load tests, staging acceptance, and the pilot are still pending.
