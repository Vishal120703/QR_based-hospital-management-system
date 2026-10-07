# CARE QR: Phase 0–8 test report

> Historical local run, not a live health check or a claim of production readiness. The temporary launcher mentioned below is not the normal startup path; normal startup requires both PostgreSQL and Redis. Re-run the [test plan](./manual-test-plan-phases-0-8.md) in your own environment before treating a phase as accepted.

Run: 6 October 2026, on a local development machine, following [the Phase 0–8 test plan](./manual-test-plan-phases-0-8.md). All data was dummy demo data (`CAREQR-DEMO`); no real patient information was used.

Environment: macOS, Node.js 20.20.2, PostgreSQL 18.6 (Postgres.app), Chromium-based browser at desktop and 375 × 812 phone size. Redis was **not installed**. The backend therefore ran through a temporary launcher that skips the Redis startup wait but keeps the real database and Redis readiness probes.

> **Update (6 October 2026, later):** Redis is now installed and `/ready` returns `ok` for PostgreSQL and Redis, so **M02 passes**. Minor UI notes 4–6 below are fixed (state badges with compact toggles in the Duty and service Status columns; Hindi times use a 24-hour clock). The staff **Requests** board, **Overview** page, and a floor-scope permission fix were added afterwards; test them with M29–M33 in the plan. Automated totals after these changes: backend 8 unit + 85 integration, frontend 46.

## Result

| | Count |
|---|---|
| Browser tests M01–M28 | **27 pass**, 1 partly blocked (M02 `/ready`, Redis not installed) |
| API checks A01–A09 | **9 pass** |
| Automated tests | Backend 8 unit + 83 integration, frontend 29 interaction: **all pass**. Format, lint, typecheck, build, Prisma validate, and migration status: **all pass** |
| Product defects found | **None blocking.** 3 minor UI notes (see Findings) |

Every feature in Phases 0–8 works as specified. Before Phase 9, install Redis and re-run M02 to clear the one blocked check.

## Features verified

| Phase | Feature | Status |
|---|---|---|
| 0 | Architecture, tenant, state-machine, and security rules documented | ✅ Complete |
| 1 | Health/readiness endpoints, safe errors with request IDs, env validation, quality gates | ✅ Complete (`/ready` needs Redis) |
| 2 | Staff sign-in/out, generic login errors, server-side session revocation, roles and permissions, tenant isolation | ✅ Complete |
| 3 | Building → Floor → Ward → Room → Bed setup with optional building/room | ✅ Complete |
| 4 | QR generate / replace / disable, bed sessions, guest sessions, non-enumerating QR errors, QR token removed from the address bar | ✅ Complete |
| 5 | Departments, staff, coverage, duty, shifts, "Who can respond?" eligibility | ✅ Complete |
| 6 | Service catalog, categories, emergency notice, versioned SLA, escalation configuration | ✅ Complete |
| 7 | Request state machine: named commands, version checks, append-only event history | ✅ Complete (API only; staff screens are Phase 10–11) |
| 8 | Patient requests: submit, track, cancel, duplicate protection, English/हिन्दी | ✅ Complete |

## Browser test results

| ID | Result | Evidence |
|---|---|---|
| M01 | PASS | Only `frontend/` and `services/`; README and status mark Phases 0–8 implemented, Phase 9 next. |
| M02 | PARTLY BLOCKED | `/health` 200 `{"status":"ok"}`. `/ready` 503 `SERVICE_UNAVAILABLE` because Redis is not installed; this is the correct, honest response. Re-test after installing Redis. |
| M03 | PASS | `/not-a-route` → 404 `NOT_FOUND` with `x-request-id`; no stack trace or internal detail. |
| M04 | PASS | Admin sign-in opened the workspace (Care locations, People, Patient services). |
| M05 | PASS | Wrong password: "Sign-in failed…". Unknown hospital, unknown email, and wrong password return byte-identical 401s. Sign-out cleared the token; the old token was rejected by the server (401); admin pages redirect to login. |
| M06 | PASS | Demo Wing → First Floor → General Ward → Room 101; Bed 01 and Bed 02 in General Ward. |
| M07 | PASS | Test Floor 2 (no building) → Test Ward 2 → Test Bed 03 created; the new bed had no session and no QR. |
| M08 | PASS | Bed 02 found by search and "No active session" filter; QR modal showed the shown-once warning, Print, Open patient view, Copy patient link; active QR count 1 → 2. |
| M09 | PASS | Scan before a session: "This QR code is not active right now…", no internal reason disclosed. |
| M10 | PASS | After Start session, the scan opened `/patient` (token removed from the address bar) for Bed 02; no patient identity requested. |
| M11 | PASS | Bed 02's patient never saw Bed 01's requests. |
| M12 | PASS | Replace QR on Bed 01 (version 2); patient view showed location, four services, routing notice, and emergency warning. |
| M13 | PASS | हिन्दी switched controls, statuses, and safety notice; stayed after reload. Service names stay as configured (expected). |
| M14 | PASS | Drinking Water → `CR-…` reference, Submitted, button changed to View request. Database: one request, one `SUBMITTED` event by `GUEST`, SLA snapshot v1 (3 / 10 min). |
| M15 | PASS | Same reference after View request, Refresh status, and reload; not visible from Bed 02. |
| M16 | PASS | Keep request changed nothing (still Submitted, one event); Yes, cancel request → Cancelled, kept in history, no cancel button. |
| M17 | PASS | New request got a new reference; the cancelled one stayed. |
| M18 | PASS | Bed 01 + Pantry → Demo Pantry Staff; + Nursing → Demo Nurse; + Billing → nobody. |
| M19 | PASS | New staff member created; Pantry and General Ward coverage added; off duty → not eligible. |
| M20 | PASS | On duty → eligible; off duty → not eligible again. |
| M21 | PASS | A shift (14:00–22:00) was saved but did not make the off-duty member eligible. |
| M22 | PASS | Deactivated Drinking Water disappeared from patient choices (with its empty category); existing requests kept their name. Reactivated afterwards. |
| M23 | PASS | Test Comfort / Extra Blanket appeared for patients; deactivating the category hid it; reactivating restored it. |
| M24 | PASS | Quick response saved as v2 (4 / 12); v1 (3 / 10) kept in history. |
| M25 | PASS | 15 / 10 rejected inline ("Completion time must be at least the acceptance time"); still 2 versions in the database. |
| M26 | PASS | Replace QR on Bed 02: connected patient → "Your session has ended"; original link refused; replacement worked. |
| M27 | PASS | Disable QR → Revoked, link refused; Generate QR → version 3 worked. |
| M28 | PASS | Close session → Bed 02 Available, patient session ended, newest link refused; Bed 01 unaffected. |

## API and automated check results

| ID | Result | Evidence |
|---|---|---|
| A01 | PASS | Full quality gate on a separate disposable database: backend 8 unit + 83 integration, frontend 29 tests, format, lint, typecheck, build, Prisma validate, migration status all exit 0. |
| A02 | PASS | Admin route without token 401; invalid token 401; staff lacking `staff.manage` 403; unknown request UUID 404. |
| A03 | PASS | Guest routes without a guest token 401; a staff token on a guest route 401. |
| A04 | PASS | Two repeat submissions of an active service returned 200 (existing request, not a new one); still one active request in the database. |
| A05 | PASS | Patient cancel of a Closed request 409; unknown reference 404. |
| A06 | PASS | Submitted → Assigned (admin) → Accepted → In progress → Completed (assigned pantry staff) → Closed (admin): versions 1→6, exactly one event per step, patient list showed CLOSED. |
| A07 | PASS | Refused: accept/complete/close from Submitted (409), assign by staff without `request.assign` (403), assign to wrong-department staff (400), stale `expectedVersion` (409), cancel without reason (400), accept by a non-assignee (403), start before accept (409), replayed accept (409), cancel after Closed (409). Editing a `RequestEvent` row in the database failed: "RequestEvent is append-only". |
| A08 | PASS | After the SLA edit to v2 (4 / 12), the earlier request still held v1, 3 / 10 minutes, and its original deadlines. |
| A09 | PASS | A forged `bedId` in the request body → 400; public responses carry `Cache-Control: no-store` and no internal hospital, bed-session, assignee, department, or SLA IDs. |

## Findings

**Setup issues (fixed or to do on this machine):**

1. **Database role did not exist (fixed).** `services/.env` used a role `postgres3` that is not present in Postgres.app, so the backend could not connect (Prisma P1010) and no migrations had ever run. `DATABASE_URL` now uses the existing `vishalgupta` role; the original file is saved as `services/.env.bak` (git-ignored).
2. **Redis is not installed (to do).** `npm run dev` waits for Redis at startup and `/ready` returns 503 without it. Install with `brew install redis` and `brew services start redis`, then re-run M02.
3. **Node version (to do).** Both apps declare Node ≥ 24 and `.nvmrc` pins 24.19.0, but this machine has only Node 20.20.2, so `nvm use` fails. Every dependency also supports Node 20.19+, and all tests passed on Node 20. Node 20 is past end-of-life, so run `nvm install` (reads `.nvmrc`) to match the declared version.

**Minor UI notes (not blocking):**

4. Service catalog: at laptop width the last column (Activate/Deactivate) is cut off and needs sideways scrolling.
5. Staff page: the Duty column shows the action ("Set off duty") rather than the current state, so a dark "Set off duty" button means the person is on duty.
6. Hindi patient page: the session expiry time still reads "01:10 pm" in Latin script.

## Phase 9 entry criteria

| Criterion | Status |
|---|---|
| All runnable browser tests M01–M28 pass or exceptions are recorded | ✅ 27 pass; M02 `/ready` exception recorded (Redis not installed) |
| A01 passes on a separate test database, no migration drift | ✅ |
| A02–A09 covered, no tenant leak or request-state defect open | ✅ |
| No real patient data, passwords, tokens, or QR URLs shared or committed | ✅ Passwords live only in git-ignored `services/.env` |

**Ready for Phase 9 after Redis is installed and M02 passes.** The Phase 7–8 code and these docs are not yet committed to git.
