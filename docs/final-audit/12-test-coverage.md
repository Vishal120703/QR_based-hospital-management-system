# Test coverage and audit evidence

Existing tests run once on the current tree: 23 backend unit tests in 5 files; 131 integration tests in 14 files; 95 frontend tests in 17 files. All 249 passed. The database suite ran serially against a fresh isolated PostgreSQL 18 cluster with all 13 migrations. Its fixtures never used the app database.

Relevant exercised coverage includes tenant CRUD and cross-tenant relationships, separate platform/staff/guest access, scoped floor/ward/department lists/direct access, care staff assignee rules, public bed/stay isolation, QR/session revocation, state transitions/concurrency, reports and audit output. Tests are credited only for their actual cases, not as proof of exhaustive correctness.

The existing person-report test covered hospital-wide zero-work membership reports, foreign/nonexistent memberships, and care-staff denial. The scope report test covered filtered totals and timeline denial. It did not test a scoped caller directly querying an unrelated same-hospital person UUID. AUD-001 therefore survives an all-green suite.

Additional independent probe: evidence/stage3-probe.mjs, 94 assertions / 91 PASS / 3 FAIL, one confirmed defect across three scoped manager roles. The script restricts its database path/socket to the disposable audit naming scheme, creates synthetic records only, and never emits tokens. Its process exit 0 means the harness completed; it does NOT mean the failing authorization assertions passed.

Unverified testing: clean npm ci, CI execution on PostgreSQL 17, exhaustive session lifecycle, full independent report arithmetic/timezone fixture, browser responsive/accessibility tour, deployment/proxy behavior, failure/load/staging/pilot testing. Stages 4–13 remain deferred. No source/test suite was weakened.
