# First-run final audit report — stages 1–3

Date: 2026-10-09 (Asia/Kolkata). Scope explicitly limited to baseline, route/auth inventory, and tenant/scope isolation. This is not the completed 13-stage pre-production audit.

## Executive result

Release verdict: NOT_READY for production sign-off. The current tree passes all requested baseline commands and existing tests, but a direct person-report call discloses a same-hospital staff identity outside three manager scope types. The later audit stages are also unverified. No CRITICAL or HIGH issue was confirmed in stages 1–3; that is a bounded finding count, not a claim that later stages contain none.

Baseline: 18 PASS / 0 FAIL / 0 BLOCKED. Existing tests: 23 backend unit + 131 backend integration + 95 frontend = 249 passed. Additional audit assertions: 94 total, 91 PASS, 3 FAIL reproducing AUD-001. Both npm registry audits: zero known advisories. All 13 migrations applied to the disposable test database.

## Area verdicts

| Area | Status | Evidence/limit |
|---|---|---|
| Security | PARTIAL | Auth-domain boundary passed; AUD-001; Stage 9 pending |
| Tenant isolation | PASS | Existing tests plus same-name direct-ID/mutation/guest/report/audit probe, tested boundary only |
| Authorization/scopes | FAIL | Scoped person-report identity fallback returns 200 for unrelated same-hospital staff |
| Validation | PARTIAL | Existing cases passed; independent Stage 6 comparison pending |
| Database integrity | PARTIAL | Fresh migration/validation and existing constraints tests passed; Stage 7 review pending |
| Request state machine | PARTIAL | Existing suite passed; independent Stage 5 audit pending |
| Reports/data correctness | FAIL | Scope defect confirmed; full numerical/timezone Stage 8 verification pending |
| Frontend functional | PARTIAL | 95 component tests and build passed; real-browser Stage 10 pending |
| UI/UX responsive | NOT_FULLY_VERIFIED | No current browser viewport tour |
| Accessibility | PARTIAL | No current keyboard/screen-reader acceptance tour |
| Dependencies | PASS | Zero npm advisories at audit time; unused/dead-code classification pending |
| Deployment | PARTIAL | Configs/CI/local builds inspected; hosted/failure/shutdown audit pending |

## Findings in severity order

- CRITICAL: 0 confirmed.
- HIGH: 0 confirmed.
- MEDIUM: AUD-001 — floor/ward/department analytics users can directly obtain another same-hospital staff member's name and empty report shell outside their authorized area. Work/history remains filtered in the reproduction; cross-hospital membership returns 404. Full evidence, exact lines, fix proposal and regression requirements are in [04-auth-authorization-tenancy.md](./04-auth-authorization-tenancy.md).
- LOW: 0 formal defect findings. Baseline records stale project-status Redis/test information and missing CI ER/audit commands as observations, without treating those as production data breaches.

## Exact remediation / continuation order

1. Preserve this current tree and the audit evidence; ensure new production source/test files are included when creating the reviewed commit.
2. In a separate implementation step, define the scoped staff-identity policy and fix AUD-001's fallback. No fixes are authorized or applied in this read-only first run.
3. Add floor/ward/department outsider, unknown/foreign UUID and empty-period regression cases; rerun targeted report isolation tests and the audit probe.
4. Proceed with Stage 4 authentication/session lifecycle, then Stages 5–7 state/validation/integrity.
5. Prioritize Stage 8's deterministic arithmetic and hospital-timezone fixture on the substantial current report changes.
6. Complete Stages 9–13 security/browser/dead-code/deployment/failure testing before revisiting production release approval.

## Unverified items

Stages 4–13 in full; browser/system timezone mismatch and DST boundaries; every report measure/export/truncation; full secret-content/history/distribution scan; practical XSS and CSP; process restart/scaling/rate-limit/proxy behavior; clean install and remote CI; PostgreSQL 17 runtime; live deployed startup/readiness/graceful shutdown/dependency failures; full responsive/keyboard/camera/print testing; load/staging/pilot. No unverified area is converted to PASS because compilation or tests are green.

Dead-code cleanup: no evidence-backed deletion candidate approved by this bounded run. Source, migrations, dependencies, UI and existing docs are unchanged by audit work; only this audit directory and ignored generated build/client output were written. Test infrastructure was isolated from development/production.

## Update after fixes (2026-10-12)

AUD-001 is resolved and independently rechecked (probe 94/94, no leaks). The areas below changed; the verdict is still **NOT_READY for production sign-off** until the remaining stages, hosted checks, backups, and a hospital pilot are done.

| Area | Now | Evidence/limit |
|---|---|---|
| Authorization/scopes | PASS for AUD-001's cases | Regression tests and probe rerun; Stage 4–9 still not run in full |
| Reports/data correctness | PARTIAL | Scope fixed; hospital time zone implemented and tested; full arithmetic recheck pending |
| Frontend functional | PARTIAL | Component tests plus browser end-to-end tests of the main workflow |
| Security | PARTIAL | Headers/CSP, password management added; token in localStorage remains a documented limitation |
| Deployment | PARTIAL | Lifecycle, health, render.yaml, backup docs fixed; hosted verification pending |
