# Authorization and tenant isolation — stages 2–3

Tenant isolation result: PASS for exercised cases. Within-hospital scope result: FAIL (AUD-001). No CRITICAL or HIGH defect was confirmed in this bounded first run.

The existing 131-test integration suite passed against a fresh temporary PostgreSQL 18 database. It includes cross-tenant CRUD/foreign references, floor/ward/department scopes, ordinary staff own-work access, guest bed/stay isolation, request commands, QR revocation, and database relationship backstops. These passing cases are evidence, not a claim that every future endpoint or race was exhaustively checked.

The independent [probe](./evidence/stage3-probe.mjs) creates two hospitals with deliberately identical building/floor/ward/room/bed codes and names, identical default service/department names, and staff with identical display names but distinct global emails/IDs. It also creates two floors and departments within the first hospital. No valuable database was used.

| Probe area | Result |
|---|---|
| All five location levels: list + direct foreign GET/PATCH/DELETE | PASS |
| Departments, services, roles, SLA: direct foreign GET/PATCH/DELETE | PASS |
| Foreign floor parent, staff department, role assignment | PASS — rejected |
| Foreign staff ID, request ID/events, QR generation, BedSession close | PASS — rejected |
| Foreign report timeline and person ID; summary excluding other hospital | PASS |
| Foreign audit target filter | PASS — empty entries |
| Guest foreign service, foreign request cancellation, other stay cancellation | PASS — rejected |
| Floor/ward/department request lists and report totals | PASS — one in-scope request only |
| Direct request/timeline and assignment outside manager area | PASS — 404 |
| Floor/ward bed reads and out-of-area discharge | PASS |
| Scoped manager staff directory and audit access | PASS — 403 |
| Ordinary care staff own list, known other request read/action | PASS — read 404, action 403 |
| All six wrong auth-domain token combinations | PASS — 401 |
| Anonymous representative STAFF/PLATFORM/GUEST endpoints | PASS — 401 |
| Floor, ward, department person report outside staff association/area | FAIL — 200 identity shell in all three cases |

Final probe: 94 assertions / 91 PASS / 3 FAIL; the failures are three reproductions of ONE finding. Foreign assignee rejection is 400 (generic invalid assignee); the wrong assigned worker's command is 403. Those are effective denials, not additional bypass findings. The probe emits no bearer or QR secrets.

## AUD-001 — Person-report fallback bypasses target staff scope

- ID: AUD-001
- Severity: MEDIUM
- Confidence: CONFIRMED
- Area: authorization / report identity disclosure
- File: services/src/modules/reports/report.service.ts
- Lines: 366–395, specifically 375–384; supporting repository lines 31–36 and report.routes.ts lines 9–14.
- Affected role: Floor Manager, Ward Manager, Department Supervisor, and custom scoped analytics.read roles.
- Affected tenant/scope: same hospital, outside the caller's floor/ward/department; hospital boundary is still enforced.
- Description: requestFacts correctly filters work by analytics scope. If the requested membership has no row in those facts, personReport searches all memberships of that hospital and returns the name and an empty report shell. The lookup checks hospitalId but no target-area authorization.
- Evidence: in the probe, the target worker belongs to Nursing, covers only Floor 2, and has no facts in Floor 1, Ward 1, or Pantry. Each manager's ordinary report has exactly one permitted request and direct outside request/timeline returns 404. Yet GET /admin/reports/people/<outside membership UUID> returns 200 with person.name = Same staff, work.assigned = 0 and activity = []. A membership from the other hospital returns 404.
- Reproduction: apply existing migrations to a disposable careqr_final_audit database with a /private/tmp/careqr-audit.* socket, then run the probe command in 01-baseline.md. Or sign in a floor manager, supply a known same-hospital membership UUID whose staff coverage/department/work is outside that floor, and request the person-report endpoint. The page's selector visibility is not required for a direct API call.
- Impact: disclosure of a staff display name and confirmation that a membership exists in the hospital beyond a scoped manager's permitted area. No outside request history or performance facts were disclosed in the reproduced case; severity is limited accordingly. UUID knowledge is required.
- Recommended fix: authorize the target membership separately from period aggregation. Limit unrestricted zero-work shells to hospital-wide analytics. For scoped roles, require an explicitly authorized target association or permitted request history according to the product policy; otherwise return uniform 404. Do not simply remove hospitalId filtering or widen the ordinary staff directory.
- Required regression test: same-hospital outsider, other-hospital outsider and nonexistent UUID for floor/ward/department roles all return the same denial; permitted staff and historical permitted work remain usable; empty/custom periods cannot broaden access; hospital-wide authorized managers retain zero-work reports.
- Breaking-change risk: LOW to MEDIUM — scoped users' bookmarked zero-work person reports may now be denied; define legitimate empty-period behavior explicitly.

## Coverage limits

Identical-name guest/request checks existed before this run; the new probe adds independent UUID/mutation/scope cases. Full auth lifecycle, all inactive-resource cases, every mixed custom-permission combination, every mutation race, report arithmetic/date-boundary semantics and hosted UI behavior are not certified by stages 1–3.

## Resolution (2026-10-12)

Status: RESOLVED.

- Fix (commit 391959a, `services/src/modules/reports/report.service.ts`): when the person has no work in the caller's report area for the period, a hospital-wide analytics holder still gets their zero-work report; a floor, ward, or department manager gets it only if the person has ever taken part in a request in that area (assigned, acted, handed over or to). Otherwise the answer is the same 404 as an unknown ID: "There is no report for this person in your area."
- Regression tests (`services/tests/integration/reports-audit.test.ts`, "lets a floor, ward, or department manager open only people who worked in their area"): floor, ward, and department managers; outsiders, other-hospital members, and unknown IDs; current and empty periods; identical 404 code and message for all; hospital-wide managers keep zero-work reports. The existing person-report test still covers other-hospital IDs and care-staff denial.
- Independent recheck: this audit's probe, rerun unchanged on a fresh disposable cluster with all 15 migrations: 94/94 passing, no identity leaks ([result](./evidence/stage3-results-2026-10-12.json)).
