# Dead code and dependencies — deferred

Dependency baseline: PASS for the two npm audit registry checks (zero known advisories); a full unused-file/export/dependency audit remains deferred to Stage 11. No file or dependency deletion is recommended from stages 1–3.

Redis, escalation policies, shifts and additional AssignmentMode values have not been classified as dead code. The README identifies future automatic routing/alerts. Intentional future architecture is not an evidence-backed deletion candidate.

## Update 2026-10-09 / 2026-10-12

An unused-code scan (knip) found no unused files, exports, or packages in either app; flagged service methods are called indirectly and were kept. One dead CSS block and two outdated test documents were removed. Playwright 1.63.0 was added as a frontend dev dependency for end-to-end tests; `npm audit --omit=dev` reported 0 vulnerabilities.
