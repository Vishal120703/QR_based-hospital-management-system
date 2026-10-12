# CARE QR project status

Last reviewed: 2026-10-12

Phases **0–8 passed their earlier verification gates**. Since then, the codebase has added manual routing, an overview dashboard, a staff request workflow, platform administration, scoped roles, richer hospital locations, branding, printable QR-label batches, request reports (hospital-wide and per person, with spreadsheet and PDF downloads, in the hospital's time zone), a hospital audit screen, staff password change and reset, a paged request queue, an SLA escalation worker with staff alerts, web security headers, and deployment configuration for Render and Vercel. These newer features are implemented but have not all passed full browser/manual acceptance gates. Automatic routing is the next major workflow area.

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

The current frontend lets a manager assign a submitted request to eligible staff; staff accept, start, and complete it; and a manager closes it. Requests remain `SUBMITTED` until someone assigns them. The overview and request board refresh periodically. A persistent personal staff inbox now uses authenticated Socket.IO wake-ups and polling recovery; see the [notification implementation guide](./architecture/notifications.md).

## Implemented since the Phase 0–8 baseline

Manual assignment, the manager overview, and the staff request screens cover the intended Phase 9–11 workflows. The platform area, scoped role administration, hospital branding, richer location setup, bulk PDF QR labels, request reports with one report per staff member, and an audit-log screen are also present.

Pilot-readiness work (2026-10-12): the request queue is paged on the server (overdue first, then oldest, so no outstanding request is hidden); report days follow the hospital's time zone; staff can change their password and managers can reset a forgotten one (with a forced change); the SLA worker carries out escalation policies and staff get alerts (badge, chime, desktop notification) for new, overdue, and escalated work; the API shuts down gracefully; the web app sends security headers and a strict Content Security Policy; browser end-to-end tests cover the main workflow. The [final audit](./final-audit/00-status.md) records the verified findings and what is still unverified. Complete manual acceptance remains open; this is not a production-readiness claim.

## Pending phases

| Phase | Planned work |
|---|---|
| 12 | Pool routing |
| 13 | SLA worker and escalation execution: implemented (in the API process, once per step); acceptance on hosted infrastructure remains. |
| 14 | Authenticated Socket.IO inbox wake-ups and reconnect recovery implemented; request screens retain polling. Hosted acceptance and multi-instance realtime fanout remain. |
| 15 | Persistent scoped personal inbox, unread badge/read actions, sound and signed-in browser alerts implemented. SMS, email and push to closed browsers are deferred. |
| 16 | Feedback and complaints |
| 17 | Basic audit API/UI exists; complete acceptance, retention, and operational controls remain. |
| 18 | Request reports exist; advanced analytics and full acceptance remain. |
| 19 | Security hardening: password management, security headers, CSP, and a current code/security review exist; formal penetration testing and hosted acceptance remain. |
| 20 | Complete integration testing: API integration tests and browser end-to-end tests of the main workflow exist; full acceptance remains. |
| 21 | Failure testing |
| 22 | Load testing |
| 23 | Deployment pipeline: Render (API) and Vercel (web) configuration, CI (including browser tests), and documented deploy order, rollback, and backups exist; staging and a tested restore remain. |
| 24 | Staging acceptance |
| 25 | Pilot ward |

Administrative audit writes, an audit screen, reports, and security checks already exist; their presence does not mark the dedicated later acceptance and hardening phases complete.

## Where code belongs

The repository has only two application folders:

- `frontend/`: one React app, with page groups in `src/features/<area>`, shared API calls in `src/api`, shared UI in `src/components`, and helpers in `src/lib`.
- `services/`: one backend service. Domain behavior lives in `src/modules/<domain>` with routes, controllers, schemas, services, repositories, and a public `index.ts`; composition is in `src/container.ts`, technical infrastructure in `src/common`, `src/config`, `src/database`, `src/http`, and `src/middleware`, and database history in `prisma/migrations`.
- `docs/`: the [documentation index](./README.md), architecture and data-flow diagrams, generated ER model, guides (including the full testing guide), and the deployment guide.

Routes declare permissions, controllers validate transport input, services own business rules and transactions, and repositories own Prisma queries. Cross-module work uses the owner's public `index.ts`. Add a folder only when real functionality needs it. No microservices or additional frontend apps are required for V1. See [how to add a feature](./adding-a-feature.md).

## Verification requirements

Before moving to the next phase, run the backend format check, lint, typecheck, unit tests, integration tests, build, Prisma validation, and migration status. Run the frontend format check, lint, typecheck, and build, plus relevant browser interaction checks. The exact commands are in the root README.

Integration tests must use `TEST_DATABASE_URL` pointing at a disposable PostgreSQL database with all migrations applied. Do not use a production database. Confirm tenant isolation, permission checks, audit coupling, and important concurrency rules for any changed behavior. A failed gate must be fixed or reported before the next phase starts.

Latest verification on 2026-10-12: against an isolated test PostgreSQL database (not the development database), all 16 migrations applied with no schema drift, and backend formatting, lint, typecheck, 37 unit tests, 171 integration tests across 19 files, the build, and the ER-diagram check passed. Frontend formatting, lint, typecheck, 127 interaction tests across 21 files, and the build passed. Seventeen browser tests (Playwright, Chromium, production build with production headers) passed, including the care workflow, notification inbox/read persistence, and a 70-view responsive hospital navigation tour. Both dependency audits reported zero known vulnerabilities. The [current platform review](./final-audit/14-current-platform-review.md) records the security, race-condition, responsive-layout, startup, and schema fixes. The earlier final audit's independent probe passed 94 of 94 checks; it was not rerun in this review. These automated checks do not replace the role-by-role browser and actual-phone checks in the [full testing guide](./guides/full-testing-guide.md), nor do they establish production readiness.

## Important limitations

- Routing is still manual. A request can remain `SUBMITTED` until a manager assigns it in the Requests screen.
- The SLA and notification workers run inside the API: on a sleeping free Render instance they pause with the API. Escalations reach scoped staff through the persistent inbox and signed-in alerts; there is no SMS, email or closed-browser phone push.
- Staff sign-in tokens are kept in the browser's localStorage. The Content Security Policy limits the main risk; moving to httpOnly cookies needs the web app and API on one site (a custom domain).
- Forgotten passwords are reset by a staff manager in person; there is no self-service email reset (the app sends no email). A platform operator's own password cannot yet be changed in the app.
- A shift does not automatically switch a staff member on or off duty.
- Sign-in and QR-scan rate limits are counted inside each backend process, which is right for the single V1 backend; several instances would need a shared store. Behind a proxy, set `TRUST_PROXY` (3 on Render).
- Redis is optional: nothing uses it yet, and the backend starts without it when `REDIS_URL` is empty.
- Backups depend on the database provider's plan; the [deployment guide](./deployment.md#backups-and-restore) gives a plan-independent backup and restore test that someone must actually run and schedule. No uptime monitor is configured by this repository.
- Passing development checks does not establish production readiness. Failure and load tests, staging acceptance, and the pilot are still pending.
