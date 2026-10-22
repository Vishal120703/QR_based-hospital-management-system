# Audit remediation — 2026-10-22

This is the implementation follow-up to the [complete audit](./15-complete-audit-2026-10-21.md).
It records the code changes and final local verification. Deployment was deliberately excluded at
the owner's request; no Render or Vercel deployment, monitoring setup, backup job, restore drill, or
pilot action was performed.

## Finding disposition

| Finding                                              | Result                                  | Evidence                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CQ-001 — dependency advisories                       | Fixed                                   | Vite is 8.3.5 and both Vitest installations are 4.1.12; both final `npm audit` runs report zero vulnerabilities.                                                                                                                                                                                      |
| CQ-002 — unbounded rate-limit keys                   | Fixed for the single-process V1 service | Counters have a hard key cap, bounded expiry cleanup, and fail closed when full.                                                                                                                                                                                                                      |
| CQ-003 — IP-only password throttling                 | Fixed                                   | Staff and platform logins have normalized per-account limits in addition to per-address limits; password changes are member/account limited.                                                                                                                                                          |
| CQ-004 — orphaned authorization scopes               | Fixed                                   | Floor, ward, and department deletion rejects referenced scopes inside the lifecycle transaction; integration regressions cover each type.                                                                                                                                                             |
| CQ-005 — persistent browser bearer tokens            | Mitigated; hosting-dependent remainder  | Privileged tokens moved from `localStorage` to per-tab `sessionStorage`, including legacy-key removal. They remain script-readable. Secure HttpOnly cookies require the web and API to be deployed on a compatible same-site/proxy topology and therefore remain part of the skipped deployment work. |
| CQ-006 — insecure production origins                 | Fixed                                   | Production rejects HTTP public/CORS origins and requires the documented database TLS setting.                                                                                                                                                                                                         |
| CQ-007 — sleeping free-tier worker                   | Skipped by request                      | The owner chose Render/Vercel free tiers. The availability limitation remains explicit and is not presented as production-ready.                                                                                                                                                                      |
| CQ-008 — monitoring/backups/restore/staging evidence | Skipped by request                      | These are external deployment and operations tasks; no evidence was fabricated.                                                                                                                                                                                                                       |
| CQ-009 — retention lifecycle                         | Fixed in code                           | A bounded retention worker removes expired sessions, notifications, and dispatch receipts. Production must explicitly choose audit retention.                                                                                                                                                         |
| CQ-010 — platform password lifecycle                 | Fixed                                   | In-app current-password change revokes other sessions; a controlled CLI recovery command is available.                                                                                                                                                                                                |
| CQ-011 — unbounded/deep lists                        | Fixed                                   | Platform and staff lists use bounded, backward-compatible cursor pagination; request offset depth is capped.                                                                                                                                                                                          |
| CQ-012 — oversized frontend modules                  | Fixed                                   | The six reported modules were split at existing responsibility seams; each original module is now below 500 lines.                                                                                                                                                                                    |
| CQ-013 — source-only API contract                    | Fixed                                   | `services/openapi.json` is generated from the Express registry (136 operations). CI checks route output plus a fingerprint of every route and Zod schema source.                                                                                                                                      |

## Additional requested fixes

- Location setup now submits a new floor to the currently selected building, including when the
  form stays mounted while switching from the first building to the second.
- Staff administration accepts `.csv` and `.xlsx` files for up to 50 people. It validates headers,
  rows, roles, scopes, departments, coverage, duplicate emails, and the 2 MB file limit before
  submission. Passwords are not shown in the preview.
- The backend creates the entire staff batch in one serializable transaction. Any invalid or
  conflicting row rolls the whole batch back, and audit records never include passwords.

## Final local verification

- Frontend: format, lint, strict typecheck, production build, 154 tests across 25 files.
- Backend: format, lint, strict typecheck, production build, 56 unit tests across 12 files, and 184
  PostgreSQL integration tests across 21 files.
- Browser: 18 Chromium end-to-end tests, including the care workflow and responsive tours at
  desktop, tablet, and phone widths.
- Database: all 18 migrations current on disposable PostgreSQL 18; Prisma validation and schema
  drift check passed; no difference detected.
- Generated documents: ER diagram and OpenAPI drift checks passed.
- Dependencies: frontend and backend audits both report zero known vulnerabilities.

These checks establish a clean local code baseline. They do not establish production availability,
backup recoverability, hosted TLS/proxy correctness, load capacity, or pilot acceptance.
