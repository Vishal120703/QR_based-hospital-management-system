# Baseline — current working tree

Audit date: 2026-10-09. The tree had 17 modified tracked files and 6 untracked files before audit output was added. Tracked diff: 2,250 additions / 575 deletions. Most changes concern report periods, person reports, report calculations/export, and audit details/filtering. Untracked source/tests are part of this audit; a later HEAD-only checkout would not reproduce this tree unless they are committed.

Recent commits reviewed: cb75f3a (API bare address / expected 4xx logs), b4809b9 (Render/Vercel deployment), 23c8abf (UI), 9b30b26 (modules/UI/validation), 7ab4cb0 (platform admin), 9482cc9 (dashboard/features).

HEAD: cb75f3afb4b1e0a87a2ac3c4f1604eccf0128eb5. Results apply to the working tree described above, not HEAD alone.

No applicable repository AGENTS.md was found. The attached audit brief specifies ONLY stages 1–3 for this run. Earlier documented results dated 2026-10-07 used 12 migrations, 123 integration tests, and 72 frontend tests; they do not establish correctness of this current tree.

## Command results

Every npm command used Node 24.19.0 via an explicit PATH because the default shell resolves Node 20.20.2. Commands run from the named app directory; no npm install, upgrades, reset, or source formatting writes were performed.

| Directory | Command | Final result | Evidence |
|---|---|---|---|
| services | npm run format:check | PASS | All source/test files formatted |
| services | npm run lint | PASS | Zero ESLint warnings/errors |
| services | npm run typecheck | PASS | TypeScript exit 0 |
| services | npm test | PASS | 23 tests / 5 files |
| services | npm run build | PASS | Prisma generate + production TypeScript build |
| services | npm run prisma:validate | PASS | Valid Prisma schema; dummy validation URL, no DB connection |
| services | npm run prisma:generate | PASS | Prisma Client 6.19.0 generated |
| services | npm run docs:er:check | PASS | Generated ER file matches current schema/client |
| services | npm run test:integration | PASS | 131 tests / 14 files; separate temporary PostgreSQL 18 cluster |
| frontend | npm run format:check | PASS | All source/test files formatted |
| frontend | npm run lint | PASS | Zero ESLint warnings/errors |
| frontend | npm run typecheck | PASS | TypeScript exit 0 |
| frontend | npm test | PASS | 95 tests / 17 files |
| frontend | npm run build | PASS | Vite production build; route chunks generated |
| services | npm audit --json | PASS | 0 known advisories; 363 dependencies in registry report |
| frontend | npm audit --json | PASS | 0 known advisories; 329 dependencies in registry report |
| services | npm run prisma:migrate | PASS | All 13 existing migrations deployed to temporary DB |
| services | npm run prisma:status | PASS | Temporary DB schema reported up to date |

Final baseline counts: 18 PASS / 0 FAIL / 0 BLOCKED. These are command outcomes, not a production correctness verdict. The separate audit probe has 3 failing authorization assertions and is not counted as a passing quality gate.

Registry audits initially failed with sandbox DNS restrictions; the same commands succeeded after approved network execution. The initial sandbox initdb attempt failed on shared-memory permission and removed its incomplete directory; initialization succeeded with approved execution. These environment failures were resolved and are not app defects.

## Test infrastructure and additional command evidence

TEST_DATABASE_URL was initially unset. PostgreSQL 18 binaries were available, so a new mktemp directory under /private/tmp/careqr-audit.* was initialized with initdb, then pg_ctl started it with listen_addresses empty and a Unix socket inside that directory. createdb made only careqr_final_audit. DATABASE_URL was supplied explicitly for migrate/status; TEST_DATABASE_URL was supplied explicitly for integration/probe. The development .env URL was never used for database mutation.

Cleanup: the audit-only cluster was stopped successfully with pg_ctl. Its exact disposable directory, /private/tmp/careqr-audit.ZCsKTA, was removed, including synthetic fixtures and temporary PostgreSQL logs. Reproduction requires creating a new isolated cluster. No application server was started or stopped.

Additional probe command, from services/: TEST_DATABASE_URL=<the disposable audit socket URL> node --import tsx ../docs/final-audit/evidence/stage3-probe.mjs. First run found 3 scope failures and two stricter-than-required status assumptions (foreign assignee denied 400, wrong assignee denied 403). The probe expectations were corrected to those valid API denials; its final run reports 94 assertions, 91 passing, 3 failing (AUD-001 only). No production code was changed to make either run pass. No full suite was rerun unnecessarily.

Read-only evidence commands: git status --short; git diff --stat / --name-only; git log -6 --oneline; git ls-files for environment/generated paths; git log --all --format= --name-only for sensitive-file filename patterns; rg route/guard/query references; targeted reads of entrypoints, routes, context/scope helpers, repositories, tests and config. No credential values were printed.

## Repository/config observations

- One frontend and one backend; domain modules and public interfaces exist.
- CI provides disposable PostgreSQL 17, pins Node 24.19.0, and runs both app gates/integration tests. The audit runtime used PostgreSQL 18; PostgreSQL 17 execution was not independently repeated here.
- CI does not currently invoke docs:er:check or dependency audit, although both passed locally. This is a coverage observation, not evidence of an app failure.
- Render blueprint and Vercel rewrites/asset headers exist. Actual deployment, proxy chain, startup/shutdown, and hosting settings are deferred to Stage 12.
- docs/project-status.md:78 says Redis is required at startup; the current README and code make Redis optional. Treat this project-status statement as stale, not an operational fact. No existing guide was edited during this audit.
- Only .env.example templates are tracked in current git files. Filename-history search did not find committed .env/.env.bak/key files matching the searched patterns. This is NOT a full secret-content scan; Stage 9 must inspect content/history/distribution hygiene.
- Clean npm ci in a fresh checkout was not run. Passing installed-workspace commands do not establish clean-install or hosted-build reproducibility.
