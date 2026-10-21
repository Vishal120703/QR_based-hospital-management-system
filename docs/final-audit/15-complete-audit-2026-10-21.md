# Complete project audit — 2026-10-21

Audit branch: `codex/full-audit-2026-10-21`

Audited commit: `47761c5` (`main` before this report)

Runtime used for verification: Node 24.19.0, npm 11.17.0, PostgreSQL 18 in a disposable local cluster, Chromium through Playwright 1.63.0

Production decision: **NOT READY for hospital production**

This report supersedes pass/fail counts in the older October 9–12 audit documents for the current commit. It does not erase their historical evidence. No application code, dependency, schema, production data, deployment, or remote service was changed during this audit.

## 1. Executive summary

The project is a coherent feature-based modular monolith with unusually strong automated coverage for its stage. The current source passes formatting, linting, strict TypeScript, builds, 46 backend unit tests, 178 backend integration tests, 147 frontend tests, 18 Chromium end-to-end tests, all 18 migrations on a fresh database, Prisma validation, migration status/drift, and the generated ER check.

Authentication domains, tenant-scoped foreign keys, request-state concurrency, patient QR revocation, scoped reporting, safe error responses, log redaction, CORS, CSP, graceful shutdown, and responsive UI behavior all have executable evidence. No cross-hospital data leak or invalid request transition was reproduced in the tested boundaries.

Production sign-off is nevertheless blocked. The audit confirmed an externally reachable resource-exhaustion weakness in the rate limiter, distributed password guesses are not limited per account, deleting a scoped location can orphan an authorization assignment, the configured free host sleeps while SLA/notification workers live in the API process, and backups/restore/monitoring/staging have not been operationally verified. Current npm registry data also reports three Vite 8.3.2 command-injection advisories (one high) in build/development tooling.

Confirmed finding count: **3 P1, 7 P2, 3 P3, 0 P0**. P1 here means high-risk or release-blocking, not proof of active exploitation.

## 2. Verification ledger

| Area / command | Result | Evidence or limitation |
|---|---:|---|
| Backend format | VERIFIED | `npm run format:check` passed |
| Backend lint | VERIFIED | `npm run lint` passed with zero warnings |
| Backend typecheck | VERIFIED | `npm run typecheck` passed |
| Backend unit tests | VERIFIED | 10 files, 46/46 tests passed |
| Backend integration tests | VERIFIED | 20 files, 178/178 tests passed against disposable PostgreSQL |
| Backend build | VERIFIED | Prisma generate + production TypeScript build passed |
| Prisma schema | VERIFIED | validate passed; 18/18 migrations applied; status current; no drift |
| Generated ER diagram | VERIFIED | `docs:er:check` passed |
| Frontend format/lint/typecheck | VERIFIED | all passed |
| Frontend tests | VERIFIED | 24 files, 147/147 tests passed |
| Frontend production build | VERIFIED | Vite build passed |
| Browser end-to-end | VERIFIED | 18/18 Chromium tests passed in 1.6 minutes |
| Responsive render | VERIFIED, bounded | Browser tour covered 1440, 1024, 768, 390, and 360 px; representative screenshots were visually inspected |
| Dependency audit | FAILED | Both lockfiles resolve Vite 8.3.2; npm reports three current advisories, aggregate high |
| Secret scan | PARTIALLY TESTED | No tracked key/token/private-key filename or common signature hit; not a full entropy/history scanner |
| Local bounded load | PARTIALLY TESTED | Warm localhost only: `/health` 500 requests, c=20, 0 failures, p95 3.80 ms; `/ready` 200 requests, c=20, 0 failures, p95 3.44 ms |
| Coverage percentage | NOT TESTED | No coverage provider/script is configured; passing behavior tests are reported instead |
| PostgreSQL 17 | NOT TESTED locally | CI targets PostgreSQL 17; this audit used installed PostgreSQL 18 |
| Live hosting / proxy / TLS | NOT TESTED | No production or staging access was used |
| Backup restore | NOT TESTED | Documentation exists; no backup artifact or isolated restore was supplied |
| Physical phone, camera, printer, sound | NOT TESTED | Browser automation cannot establish real-device acceptance |
| Screen reader, automated contrast, full keyboard tour | PARTIALLY TESTED | Semantic role-driven E2E and Escape behavior pass; no axe/screen-reader audit |
| Destructive security testing | NOT APPLICABLE | Deliberately not run; all probes were bounded and isolated |

The first test attempt resolved Node 20 (and one child process Node 18) and therefore failed before valid execution. Every recorded application result above is from an explicit Node 24.19.0 `PATH`. Three lifecycle tests also initially hit sandbox `EPERM` on loopback bind; the authorized local rerun passed 46/46.

## 3. Architecture and dependency map

Repository inventory:

- `services/`: one Express 5 / TypeScript API, 172 TypeScript source files, 15 domain modules, Prisma 6.19, 38 models, 18 migrations.
- `frontend/`: one React 19 / TypeScript / Vite app, 88 TypeScript/TSX source files.
- `docs/`: architecture, request flows, schema, deployment, operating guides, and earlier audit evidence.
- `.github/workflows/ci.yml`: backend, frontend, and Chromium E2E jobs on Node 24.19 and PostgreSQL 17.

Runtime flow:

```text
React feature/page
  -> frontend/src/api/*
  -> Express shared middleware (headers, CORS, request ID, safe logging, JSON limit)
  -> route + authentication + permission guard
  -> controller + strict Zod parsing
  -> service + tenant/area/business rules + transaction
  -> repository + Prisma / tagged SQL
  -> PostgreSQL
  -> safe response DTO
```

Composition is centralized in `services/src/container.ts` and `services/src/routes/index.ts`. The backend modules are `audit`, `auth`, `bed-sessions`, `catalog`, `departments`, `hospitals`, `locations`, `notifications`, `platform`, `qr`, `reports`, `requests`, `roles`, `sla`, and `staff`. Cross-module imports are lint-restricted to public `index.ts` boundaries; repositories are lint-restricted to their owning modules.

Critical traces were checked against source and tests:

1. Floor creation: location form -> staff API -> `/admin/floors` -> staff auth -> generic CRUD controller -> `FloorService` serializable transaction -> tenant-scoped repository -> audit row.
2. Request assignment: request card -> `/admin/requests/:id/assign` -> scoped permission -> command schema -> `RequestCommandService` -> area, version, transition, and eligibility checks -> guarded update + event + audit in one transaction.
3. Patient request: QR token -> `/public/qr/resolve` -> hashed lookup and row lock -> guest session -> `/public/requests` -> locked stay/session -> service/SLA snapshot -> request + append-only event.
4. Report: browser period in hospital time zone -> `/admin/reports/*` -> analytics scope -> tenant and area predicate -> request/event facts -> pure metric functions -> bounded result with explicit truncation.
5. Realtime notification: staff token handshake -> server-derived tenant/member room -> durable inbox worker -> authentication recheck before every socket emission -> polling recovery.

The detailed endpoint inventory is in [16-api-inventory-2026-10-21.md](./16-api-inventory-2026-10-21.md). Existing diagrams and line-level request maps remain in [code-map.md](../architecture/code-map.md) and [data-flow.md](../architecture/data-flow.md).

## 4. Security, authentication, authorization, and tenancy

### Verified controls

- Staff, platform, and guest credentials are separate opaque 256-bit bearer-token domains; only SHA-256 hashes are stored.
- Staff sessions expire after eight hours and are revoked on logout, password reset, account/hospital/client suspension, and other-session password change.
- Passwords use salted Node `scrypt`; verification performs a dummy hash for missing users to reduce account timing disclosure.
- New passwords are 12–200 characters; login accepts up to 1,024 for backward compatibility.
- Staff permissions are persisted role permissions plus HOSPITAL/FLOOR/WARD/DEPARTMENT scopes. Admin APIs derive hospital identity from the authenticated session, not body or route input.
- Composite tenant foreign keys protect the main hospital-owned graph. Existing tests and current E2E cover direct-ID cross-tenant access, same-named hospitals, role boundaries, report scope, and guest/staff/platform credential separation.
- Public QR resolution returns one indistinguishable unavailable response. QR and session tokens are hashed; active QR reprint copies are encrypted and the key is mandatory in production.
- JSON is limited to 1 MB; logo uploads are limited to 1 MB and detected by file signature, not claimed content type.
- CORS is an exact origin allowlist without cookies. CSRF is therefore NOT APPLICABLE to the current bearer-token design.
- React has no `dangerouslySetInnerHTML`, raw DOM HTML insertion, `eval`, or external backend fetch sink in source. SQL is Prisma-generated or tagged `Prisma.sql`; no unsafe raw-query API was found.
- API errors use consistent safe envelopes with request IDs. HTTP logs omit bodies, query values, authorization, cookies, and referrers.
- Frontend production CSP forbids inline/evaluated scripts and limits connections to self plus the configured API/WebSocket; framing and referrers are restricted.

### Security result

Tenant isolation is **VERIFIED for automated tested paths**, not certified for all future code or live infrastructure. Authentication/session security is **PARTIAL** because of CQ-002, CQ-003, CQ-005, CQ-006, and CQ-010. OWASP API4 resource consumption and API8 security misconfiguration remain open. No SQL injection, stored/reflected XSS, CSRF, SSRF, path traversal, open redirect, unsafe upload, mass-assignment, prototype-pollution, or cross-tenant exploit was reproduced.

## 5. Database integrity and concurrency

### Verified

- Fresh deployment of all 18 migrations succeeds and matches the Prisma schema.
- Composite foreign keys bind locations, staff relationships, catalog/SLA, beds/stays, requests, assignees, and notifications to one hospital.
- Partial unique indexes enforce one active bed stay and one open request per stay/service.
- Request events are append-only by database trigger; SLA versions are immutable by trigger.
- Status/timestamp/version/SLA/check constraints exist in migration SQL.
- Location writes use serializable transactions for parent/child active-state rules.
- Request commands use optimistic version + status predicates and atomically append events/audits.
- Patient submission locks the stay and guest session and handles duplicate races.
- Worker deduplication and escalation concurrency have integration coverage.

### Failed / partial

- CQ-004 proves that a polymorphic `ScopeAssignment.scopeId` has no location FK or deletion lifecycle enforcement. An API-created floor-scoped role survived deletion of its floor as an orphan row.
- Actor/history UUID columns intentionally preserve snapshots but several lack tenant-scoped FKs. No API corruption was reproduced, but database-only writes are less protected than core resource relationships.
- CQ-009: expired/revoked sessions, notifications, dispatch receipts, and audit data have no implemented retention/purge process.
- Restore behavior, rollback under a real provider, deadlocks under sustained load, and migration execution through production poolers are NOT TESTED.

## 6. Business workflow matrix

| Workflow | Status | Evidence / boundary |
|---|---|---|
| Client/hospital creation and manager onboarding | VERIFIED | Platform integration + E2E |
| Hospital/client suspend/reactivate and session denial | VERIFIED | Platform integration |
| Buildings/floors/wards/rooms/beds CRUD and parent checks | VERIFIED except CQ-004 | Location integration; orphan-scope probe failed |
| Duplicate location prevention | VERIFIED | DB uniqueness + integration |
| Admission/discharge and optional QR-only occupancy | VERIFIED | Integration + E2E |
| QR generate/print/rotate/revoke/invalid scan | VERIFIED | Integration + E2E |
| Guest expiry/revocation and patient-safe output | VERIFIED | Integration + E2E |
| Patient create/list/cancel/deduplicate | VERIFIED | Integration |
| Assign/accept/start/complete/close | VERIFIED | Integration + real browser flow |
| Reject/transfer/staff cancel and invalid transitions | VERIFIED | Integration |
| Concurrent request actions / duplicate submissions | VERIFIED | Integration |
| Request audit/event trail | VERIFIED | Integration |
| Notification inbox/read/reconnect/retry | VERIFIED locally | Integration + E2E; multi-instance fanout NOT TESTED |
| SLA escalation | VERIFIED locally | Unit/integration; sleeping-host behavior remains P1 |
| Automatic routing | NOT APPLICABLE | Not implemented; explicitly deferred |
| Feedback/complaints | NOT APPLICABLE | Not implemented; explicitly deferred |

## 7. API contract and consistency

The API exposes about 130 concrete method/path combinations after expanding generic CRUD and dynamic request commands: 3 health, 17 root auth/platform, 103 staff-admin, and 7 public-patient operations. All request bodies and known queries inspected are strict Zod schemas; non-GET query strings are rejected globally. Reads generally return 200, creates 201, idempotent/action updates 200 or 204, validation 400, auth 401, permission 403, hidden/unknown resources 404, conflicts 409, throttling 429, and unexpected errors 500.

Compatibility with the current frontend is VERIFIED by 147 interaction tests and 18 production-build browser tests. No arbitrary request-status PATCH exists; lifecycle commands are explicit. Patient DTOs omit internal IDs and internal staff data.

Remaining consistency/scalability gaps:

- CQ-011: platform hospital/client, staff, roles, catalog, location, and several other configuration lists are unpaginated; request queues use offset pagination up to page 100,000. This is acceptable for small pilots but not demonstrated at SaaS scale.
- CQ-013: there is no OpenAPI/JSON Schema contract or generated contract-drift test. The source and tests are the contract.
- Delete operations intentionally vary between 204 (resource removed) and 200 (relationship removed with refreshed staff); this is consistent by behavior but should be documented in a formal contract.

## 8. Frontend quality, UX, and accessibility

The feature layout is clear (`features/<area>`, shared API, components, and helpers), route chunks are lazy-built, API errors and loading/empty states are tested, sessions redirect correctly, permission-based navigation is enforced by both UI and API, and notification recovery combines realtime hints with polling.

All 18 E2E tests passed. The hospital navigation tour visited 15 staff screens at five viewport widths and asserted no runtime/API errors, no main/document overflow, no stuck loading states, and visible sign-out. Patient and platform mobile flows also passed. Visual inspection of overview desktop, request queue mobile, patient service mobile, and platform hospital mobile screenshots found no obvious clipping, unreadable density, or navigation break.

Accessibility is only **PARTIALLY TESTED**. Tests rely heavily on accessible roles/names and exercise Escape in dialogs, but there is no axe run, contrast report, screen-reader acceptance, complete tab-order test, zoom/reflow acceptance, or physical camera/PDF-print validation. CQ-012 tracks large UI modules that raise maintainability risk.

## 9. Report and data accuracy

Report periods are interpreted in the hospital's configured IANA time zone. Deterministic unit/integration fixtures exercise metrics, period boundaries, audit filtering, same-day browser reporting from another browser time zone, scoped person reports, cancellations/rejections, and request history. The current known scope leak from the older audit is fixed and its logic is present in `ReportService.personReport`.

Status: **VERIFIED for existing deterministic test datasets; PARTIAL at large volume and DST diversity**. Reports intentionally cap source requests at 20,000 and log rows at 2,000, return `truncated`, and display an exactness warning. No production-sized export comparison or independent database-vs-CSV/PDF reconciliation was run in this audit.

## 10. Performance and reliability

The bounded warm-local probe had no failures and low millisecond latency for health/readiness. It is useful only as a smoke baseline, not capacity evidence. Request lists, audit, notifications, bed stays, and shifts are bounded/paginated; report queries are capped. The database has relevant tenant/status/time indexes and guarded worker batches. Graceful shutdown, readiness timeout, worker cleanup, reconnect recovery, and worker retries have tests.

Status: **PARTIALLY TESTED**. There is no realistic authenticated workflow load test, soak test, memory profile, production query plan, connection-pool tuning evidence, network-failure chaos test, multi-instance Socket.IO adapter, or restart test on the target host. CQ-002, CQ-007, CQ-008, CQ-009, and CQ-011 prevent a production reliability verdict.

## 11. Readability and maintainability

Backend boundaries are strong and conventional: routes authorize, controllers parse, services own rules/transactions, repositories query, and lint rules enforce those responsibilities. Strict compiler settings include unused code, unchecked indexes, exact optional properties, implicit returns, and fallthrough checks. No TODO/FIXME marker or evidence-backed dead source file was found.

The backend's largest non-seed service is under 400 lines. Frontend complexity is less even: `BedManagementPage.tsx` (735), `BedsPage.tsx` (643), `StaffDialog.tsx` (584), `PersonReportPage.tsx` (565), `SlaPage.tsx` (548), and `report-format.ts` (527) are refactor candidates (CQ-012). This is not authorization to rewrite them; split only around stable, tested responsibilities.

## 12. Production-readiness checklist

| Item | Status |
|---|---|
| Environment validation | VERIFIED, except HTTPS/TLS policy CQ-006 |
| No common tracked secret signatures | PARTIALLY TESTED |
| CORS / CSP / safe headers | VERIFIED in source and production-build E2E |
| Authentication / RBAC / tenant isolation | PARTIAL; tested paths pass, CQ-003/005/010 open |
| Health/readiness and graceful shutdown | VERIFIED locally |
| Migrations / schema drift | VERIFIED on fresh PostgreSQL 18 |
| CI gates | VERIFIED in workflow source; current remote run NOT TESTED |
| Dependency vulnerability scan | FAILED: CQ-001 |
| Rate limits | FAILED: CQ-002 and CQ-003 |
| Always-on workers | FAILED for checked-in free Render plan: CQ-007 |
| Monitoring / alerting | NOT CONFIGURED: CQ-008 |
| Backup and restore drill | NOT VERIFIED: CQ-008 |
| Retention / deletion rules | NOT IMPLEMENTED: CQ-009 |
| Resource limits / pool sizing | NOT VERIFIED |
| Staging acceptance / pilot | NOT TESTED |
| Rollback instructions | DOCUMENTED; live execution NOT TESTED |

## 13. Existing coverage and missing tests

Existing: 10 backend unit files, 20 backend integration files, 24 frontend test files, 4 E2E spec files. The suites cover validation, time zones, credentials, encryption, lifecycle, tenants, same-name hospitals, locations, staff/departments, roles, passwords, catalog/SLA, QR/stays, occupancy setting, request lifecycle/queue/escalation, reports/audit, platform, notifications, UI workflows, security headers, responsive routes, CSP, and the complete care flow.

Priority missing regression/acceptance work:

1. Rate-limit key-cap/eviction and distributed per-account login tests (CQ-002/003).
2. Location/department deletion with assigned authorization scopes, including concurrent delete/assign (CQ-004).
3. Production environment rejection of insecure public origins and an explicit database TLS policy (CQ-006).
4. Platform password change/recovery and session-revocation tests (CQ-010).
5. Retention worker tests with legal/operational policy fixtures (CQ-009).
6. Pagination/property tests for all list endpoints and deep-page query plans (CQ-011).
7. Accessibility automation and keyboard/screen-reader manual acceptance.
8. Authenticated request/notification/report load, soak, restart, and dependency-failure tests.
9. Backup restore drill with row-count and workflow verification.

## 14. Prioritized findings

### CQ-001 — P2 — Vite 8.3.2 has current command-injection advisories

- Module/files: `frontend/package.json:57`, `frontend/package-lock.json:4230`, `services/package-lock.json:5074`.
- Evidence: `npm audit --json` on both lockfiles reports GHSA-698v-4r3x-3vcv, GHSA-r825-w8mm-5pxw, and GHSA-587h-7wmj-h5pm; aggregate severity high. `npm ls vite --all` resolves 8.3.2 directly in frontend and through Vitest in both apps.
- Impact: a malicious project/path/editor configuration on affected development hosts may reach command execution. Vite is not in the backend runtime dependency set, so this is not evidence of a deployed API exploit.
- Recommendation: update to the patched Vite release compatible with the current plugins/Vitest, regenerate both lockfiles, rerun clean install, all gates, and E2E.
- Regression required: build, unit, E2E, CSP output, and `npm audit` zero for this advisory set.
- Status: **OPEN; no update authorized**.

### CQ-002 — P1 — rate-limit state is unbounded and becomes O(n) per new key

- Module/file: `services/src/middleware/rate-limit.ts:11-32`.
- Evidence: the map prunes only expired entries after size exceeds 10,000; it never caps live entries. Probe inserted 10,002 distinct live keys and then replayed key zero; the replay was still limited, proving all earlier live state remained. Once over the threshold, every request scans the full map.
- Impact: unauthenticated login and QR endpoints can consume growing memory and CPU through many unique address/account keys (OWASP API4). Multi-instance operation multiplies inconsistent state.
- Recommendation: use a bounded/shared rate-limit store with atomic expiry (Redis is already an optional dependency), hard cardinality protection, trusted-proxy tests, and fail-safe behavior. Keep separate address and account policies.
- Regression required: maximum key cardinality, expiry, high-cardinality CPU behavior, proxy spoof boundaries, multi-instance consistency, and normal shared-ward traffic.
- Status: **OPEN**.

### CQ-003 — P2 — “per-account” login throttling is actually account-plus-IP

- Module/file: `services/src/modules/auth/auth.routes.ts:16-45`; platform login has only one address limiter at `services/src/modules/platform/platform.routes.ts:19-20`.
- Evidence: `accountKey` starts with `request.ip`. With account max = 1, wrong-password probes from IP A and IP B both returned 401; only IP A's second attempt returned 429 (`401, 401, 429`).
- Impact: rotating addresses can continue password guesses against one staff account; platform accounts have no independent account key. Strong passwords reduce but do not remove credential-stuffing risk.
- Recommendation: add a privacy-preserving normalized account key independent of IP, retain a separate per-address limiter, use a shared store, and define lockout/alert policy without enabling account enumeration or denial-by-lockout.
- Regression required: same account across IPs, many accounts behind one ward IP, case normalization, unknown-account indistinguishability, expiry, and platform/staff parity.
- Status: **OPEN**.

### CQ-004 — P2 — deleting a location can orphan authorization scopes

- Module/files: `services/prisma/schema.prisma:401-410`, `services/src/modules/locations/floor.service.ts:103-121`, equivalent ward/department deletion paths.
- Evidence: `ScopeAssignment.scopeId` is polymorphic and has no FK. Isolated API probe: create floor 201, create floor-scoped role 201, assign 201, delete floor 204, matching scope row still present = true.
- Impact: staff retain an active role with a nonexistent area; access usually becomes empty rather than broader, but authorization state and administration views become inconsistent and future lifecycle logic can make unsafe assumptions.
- Recommendation: before location/department deletion, reject while any role scope references it or transactionally remove assignments with explicit audit and user-facing confirmation. A normalized per-scope relation is the stronger long-term database design.
- Regression required: floor, ward, department, last-scope/user-role cleanup, concurrent assign/delete, audit, and reauthentication behavior.
- Status: **OPEN**.

### CQ-005 — P2 — staff and platform bearer tokens persist in localStorage

- Module/file: `frontend/src/api/client.ts:112-118`.
- Evidence: staff and platform tokens use `localStorage`; guest tokens correctly use `sessionStorage`. The repository itself documents this limitation at `docs/project-status.md:72`.
- Impact: any successful same-origin script injection or compromised third-party build can read active privileged tokens; platform tokens have SaaS-wide management reach. Strict CSP and absence of current HTML sinks materially reduce likelihood.
- Recommendation: move privileged sessions to Secure, HttpOnly, SameSite cookies on a same-site deployment, add CSRF protection for state changes, rotate sessions, and keep CSP. If cross-site bearer tokens remain, document and threat-model the accepted risk.
- Regression required: login/logout, expiration/revocation, CSRF, CORS, refresh/navigation, multiple tabs, and XSS token-read negative tests.
- Status: **OPEN architectural risk**.

### CQ-006 — P2 — production configuration accepts insecure HTTP public origins

- Module/file: `services/src/config/env.ts:35-50,65-80,98-110`.
- Evidence: production requires `PUBLIC_APP_URL` and a QR encryption key but accepts `http:` for `PUBLIC_APP_URL` and every `CORS_ORIGINS` entry. Database URLs also have no explicit production TLS policy.
- Impact: a valid but insecure production configuration can put QR secrets and browser/API traffic on an unencrypted origin or allow an insecure caller origin. Actual Render/Vercel examples use HTTPS, so this is a misconfiguration path, not proof the live service is insecure.
- Recommendation: require HTTPS for public production origins except explicit localhost test/dev cases; document or validate provider-specific PostgreSQL TLS requirements.
- Regression required: production HTTP rejection, HTTPS acceptance, localhost development acceptance, CORS parsing, and database TLS policy cases.
- Status: **OPEN**.

### CQ-007 — P1 — checked-in production target sleeps while operational workers run in-process

- Module/files: `render.yaml:13-16`, `services/src/server.ts:57-75`, `docs/deployment.md:115`.
- Evidence: the Render blueprint selects `plan: free` and states it sleeps after 15 minutes; SLA and notification workers are timers inside that process.
- Impact: requests can wait for cold start and SLA escalation/realtime delivery stop while asleep. That is incompatible with dependable hospital operations even though the persistent inbox eventually recovers.
- Recommendation: require an always-on instance for every pilot/production environment, add an external readiness monitor, and define worker availability objectives. Consider a separately supervised worker only when scale requires it.
- Regression required: hosted cold-start, restart, missed-tick recovery, notification retry, and escalation timing acceptance.
- Status: **OPEN launch blocker**.

### CQ-008 — P1 — monitoring, backup, restore, staging, and pilot evidence is absent

- Module/files: `docs/deployment.md:104-139`, `docs/project-status.md:77-78`.
- Evidence: the repository explicitly says no uptime monitor is configured and instructs someone to schedule backups and perform a restore. No provider configuration, backup artifact, restore report, staging result, or pilot sign-off was available.
- Impact: outages or data loss may go unnoticed or be unrecoverable; local green tests cannot establish operational readiness.
- Recommendation: configure readiness alerting, encrypted backups with retention, complete and record a separate-database restore drill, define incident/rollback ownership, then run staging and one-ward pilot acceptance.
- Regression required: scheduled restore drills and documented alert/fire/recovery exercises rather than a code unit test.
- Status: **OPEN external launch blocker**.

### CQ-009 — P2 — no retention or purge lifecycle

- Module/files: session models at `services/prisma/schema.prisma:413-426,603-618`; notifications/audit models; deferred explicitly in `docs/architecture/notifications.md:104`.
- Evidence: expiry indexes exist, but no cleanup worker or retention command was found for expired/revoked sessions, notifications, dispatch receipts, or audit data.
- Impact: indefinite growth, slower maintenance, and undefined privacy/legal retention for operational records.
- Recommendation: obtain policy/legal requirements first; implement bounded, tenant-safe, auditable purge/archive jobs with protected audit retention and restore-aware operations.
- Regression required: boundary dates/time zones, batches, retries, legal hold, active-row exclusion, cross-tenant isolation, and observability.
- Status: **OPEN; policy decision required before implementation**.

### CQ-010 — P2 — platform operators cannot change or recover their own password in-app

- Module/file: routes at `services/src/modules/platform/platform.routes.ts:19-22`; documented at `docs/project-status.md:73`.
- Evidence: platform auth exposes login/me/logout only. Staff password reset intentionally refuses accounts also used by the platform.
- Impact: a forgotten/compromised super-admin credential requires an out-of-band database/bootstrap procedure; platform sessions cannot be proactively secured by a normal password change flow.
- Recommendation: add current-password change with other-session revocation and audit; define tightly controlled recovery/MFA before production.
- Regression required: current password, reuse rejection, racing login/change, all-domain revocation, recovery authorization, and secret-free audit/logs.
- Status: **OPEN**.

### CQ-011 — P3 — list scalability and deep offset pagination are inconsistent

- Module/files: `services/src/modules/platform/platform.repository.ts:20-26,86-88`, `services/src/modules/staff/staff.repository.ts:25-49`, `services/src/modules/requests/request.schemas.ts` (page up to 100,000).
- Evidence: several configuration/platform lists use unbounded `findMany`; request queue uses offset pagination. Report caps are explicit and UI-visible, so they are not included in this defect.
- Impact: large tenants/platforms can create large responses and expensive deep-offset queries.
- Recommendation: add backward-compatible optional keyset pagination and caps, starting with platform hospitals/clients and staff; preserve existing frontend behavior during migration.
- Regression required: stable ordering, duplicates/missing rows under writes, maximum limits, tenant filters, and old-client defaults.
- Status: **OPEN**.

### CQ-012 — P3 — several frontend modules remain oversized

- Module/files: `frontend/src/features/locations/BedManagementPage.tsx` (735 lines), `BedsPage.tsx` (643), `people/StaffDialog.tsx` (584), `reports/PersonReportPage.tsx` (565), `services/SlaPage.tsx` (548), `reports/report-format.ts` (527).
- Evidence: line-count inventory; tests and rendered behavior currently pass.
- Impact: slower review and higher regression risk when workflows change.
- Recommendation: after higher-risk fixes, extract tested hooks/pure formatters/subpanels at existing responsibility seams. Do not redesign or introduce new frameworks.
- Regression required: current component tests plus complete E2E tour.
- Status: **OPEN low-risk refactor**.

### CQ-013 — P3 — API contract is source/test-only

- Module/file: route composition under `services/src/routes/index.ts` and module route/schema files.
- Evidence: no OpenAPI document or generated contract check exists; the inventory had to expand generic CRUD and dynamic commands manually.
- Impact: harder external integration, backward-compatibility review, and endpoint completeness checks.
- Recommendation: generate or maintain a minimal OpenAPI 3 contract from the existing Zod/route behavior without changing responses; validate it in CI.
- Regression required: route inventory and schema/status snapshot against the running app.
- Status: **OPEN**.

## 15. Remediation sequence and branch plan

Do not combine these into one broad rewrite and do not merge automatically.

1. `codex/security-rate-limits`: CQ-002 + CQ-003, tests first; rerun backend unit/integration and bounded abuse probe.
2. `codex/dependency-vite-advisories`: CQ-001 only; update both lockfiles and rerun every gate/E2E/audit.
3. `codex/scope-lifecycle-integrity`: CQ-004; define delete-vs-cleanup product behavior, add concurrency regressions, then implement.
4. `codex/production-transport-auth`: CQ-006 + CQ-010; HTTPS/TLS validation and platform credential lifecycle.
5. `codex/production-operations`: CQ-007 + CQ-008; mostly hosting/runbook work, followed by hosted evidence.
6. `codex/data-lifecycle-pagination`: policy-approved CQ-009 then backward-compatible CQ-011.
7. `codex/frontend-component-splits`: CQ-012 only after behavior is stable.
8. `codex/api-contract`: CQ-013 without changing existing behavior.

At each milestone: targeted regression, backend/frontend full gates as applicable, integration on a fresh disposable database, E2E for behavior/dependency changes, no production migration without review, no push/merge/deploy without explicit approval.

## 16. Remaining risk and final verdict

The system is suitable for continued controlled development and a prepared staging environment. It is not yet suitable for unsupervised hospital production. The strongest parts are tenant-aware domain design, concurrency controls, automated workflow coverage, safe errors/logging, and responsive UI. The decisive blockers are rate-limit resilience, always-on operations, and absent operational recovery/monitoring evidence.

Before pilot approval, close or explicitly accept CQ-001 through CQ-010, run the missing accessibility and authenticated load/failure tests, verify PostgreSQL 17 or the exact production version, perform an encrypted backup/restore drill, validate the real proxy/TLS/WebSocket chain, test on representative phones/printers, and complete a supervised one-ward pilot with rollback ownership.

