# Audit status

Date: 2026-10-09 (Asia/Kolkata). Scope: FIRST RUN, stages 1–3 only, as requested in the supplied brief.

- Stage 1 baseline: complete — 18 PASS, 0 FAIL, 0 BLOCKED final command results.
- Stage 2 route/auth inventory: complete — 126 endpoints catalogued; auth-domain matrix passed.
- Stage 3 tenant/scope checks: complete — 94 additional checks, 91 PASS, 3 failures reproducing ONE defect.
- Confirmed findings: 0 CRITICAL, 0 HIGH, 1 MEDIUM (AUD-001).
- Tenant boundary: PASS for tested cases. Within-hospital authorization scopes: FAIL at the person-report identity fallback.
- Existing tests: 23 backend unit, 131 backend integration, 95 frontend tests passed.
- The isolated audit database was stopped and its disposable fixture directory removed after testing. Application servers and the development database were untouched.
- No production source, migrations, dependencies, or UI were changed. Audit documents and a disposable-fixture probe were added only under this directory; builds regenerate ignored artifacts.
- Stages 4–13: deferred. Browser UI/responsive verification: NOT_FULLY_VERIFIED.
- Next recommended stage: 4 — authentication/session lifecycle; keep AUD-001 queued for a separately authorized fix.

Details: [baseline](./01-baseline.md), [API inventory](./03-backend-api.md), [isolation finding](./04-auth-authorization-tenancy.md), [first-run report](./13-final-report.md).

## Update 2026-10-12 (fixes after this first run)

- AUD-001 is **resolved**: verified by regression tests for floor, ward, and department managers, unknown and other-hospital IDs, and empty periods, and by rerunning this audit's probe: 94 assertions, 94 passing, no identity leaks ([result](./evidence/stage3-results-2026-10-12.json)). Details in [04](./04-auth-authorization-tenancy.md#resolution-2026-10-12).
- Also fixed since: request queue paging (no 500-request limit), hospital-time-zone report days, cleared report dates crashing, staff password change and reset, web security headers and Content Security Policy, an SLA escalation worker with staff alerts, graceful shutdown, and stale Render database configuration. Browser end-to-end tests now cover the main workflow.
- Stages 4–13 of this audit were not rerun as a whole; the sections below say what changed and what is still unverified.
