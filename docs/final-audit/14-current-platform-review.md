# Current platform review and fixes

Date: 2026-10-12. Scope: the current React frontend, Express backend, Prisma schema/migrations, authentication, authorization, notifications, and primary care workflow.

## Outcome

Verified defects were fixed and the final automated gates passed. The patient → manager assignment → staff completion → manager closure workflow passes browser tests. This is a code and local acceptance review, not a certification of production readiness or a formal penetration test.

Existing notification work and the modular-monolith structure were preserved. No new application, microservice, or unnecessary root directory was introduced. The development database, environment file, and user-started servers were not changed; migration and workflow checks used a disposable PostgreSQL database.

## Fixed findings

| Area | Verified problem | Correction and regression evidence |
|---|---|---|
| Password/session security | Changing a shared user's password left sessions in another hospital and the platform domain active. | Revoke all other staff and platform sessions belonging to that account; preserve the current session. Integration tests cover both domains. |
| Concurrent password changes | Two changes could both succeed after verifying the same old password. | Conditional password-hash update inside the transaction; only one succeeds and only one audit record is committed. |
| Sign-in race | A sign-in verified before a password change could create an old-credential session afterward. | Lock and recheck the credential account before creating either a staff or platform session. Race regressions reject old credentials without inserting sessions. |
| Request logging | Query-string and referrer secrets could enter request logs. | Whitelist request-log fields and remove query strings; redact referrers as defense in depth. Regression tests check representative secrets are absent. |
| API response protection | Sensitive responses lacked explicit no-store and basic security headers. | Set no-store, nosniff, no-referrer, and DENY before CORS. Versioned public logos retain their intentional immutable caching. |
| Notification pagination | Refreshing an exhausted inbox reintroduced an incorrect “Load older” action. | Preserve the pagination cursor after loading older pages and serialize mutations against refresh. Frontend regression passes. |
| Request queue navigation | A delayed background response could overwrite a newly selected queue tab. | Ignore superseded loads; clear a notification's selected-request filter when changing tabs; improve unavailable-link recovery. Frontend regression passes. |
| Platform session UX | Another tab's sign-out could leave the old private workspace displayed. | Handle platform-token storage changes and clear the identity/workspace. Frontend regression passes. |
| Phone navigation | Intrinsic grid sizing clipped mobile account controls. | Constrain the main grid and use accessible compact account buttons on small screens. Browser checks verify sign-out remains visible. |
| Responsive administration | The location editor retained two columns on phones; a hidden staff-table header caused tablet overflow. | Fix breakpoint ordering, constrain table wrappers, and contain the hidden header. Browser tour passes at all tested widths. |
| Schema consistency | Prisma inferred a notification foreign-key name different from the migration's explicit name. | Map the relation to the existing constraint name; no historical SQL was rewritten. Schema drift is now zero. |
| Startup/database errors | Missing worker tables could produce repeated background failures after the API announced it was listening. | Check worker schema before listening and fail once with migration instructions. Tested against an intentionally unmigrated database. |
| Network timeout UX | The API timeout ended when headers arrived, allowing a stalled JSON body to keep forms waiting. | Keep the timeout active through body parsing; show the existing recoverable network error. Frontend regression passes. |

Session lifecycle and non-caching decisions were checked against the [OWASP session guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) and [cache security guidance](https://cheatsheetseries.owasp.org/cheatsheets/Web_Cache_Security_Cheat_Sheet.html). Transaction changes use [Prisma transaction semantics](https://www.prisma.io/docs/orm/v6/prisma-client/queries/transactions).

## Final verification

| Check | Final result |
|---|---|
| Backend unit tests | 37 passing across 8 files |
| Backend integration tests | 171 passing across 19 files |
| Frontend interaction tests | 127 passing across 21 files |
| Chromium browser tests | 17 passing |
| Backend/frontend formatting, lint, TypeScript, builds | All passed; lint allows zero warnings |
| Prisma validation and generated ER documentation | Passed |
| Fresh database migrations | All 16 applied successfully |
| Migration/schema drift | No difference detected |
| Backend/frontend npm dependency audits | Zero known vulnerabilities reported at review time |
| Patch whitespace check | Passed |

The browser tour covers 14 hospital destinations at 1440, 1024, 768, 390, and 360 pixels (70 page/viewport combinations), plus patient QR-link entry and platform navigation. It checks horizontal overflow, visible account controls, runtime/API errors, and renders screenshots. The existing care-flow tests cover request handling and notification read persistence. Representative desktop and phone screenshots were visually inspected.

The previously recorded independent 94-assertion tenant probe was not rerun in this review. The current integration suite's tenancy and permission checks passed. No claim is made that every possible authorization combination or every device has been exhaustively tested.

Useful verification commands, run from each application folder with the project's supported Node runtime:

```sh
# services — tests must point at a disposable database, never the development DB
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run test:integration
npm run build
npm run prisma:validate
npm run prisma:status
npm run prisma:check-drift
npm run docs:er:check
npm audit

# frontend
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run build
npm run test:e2e
npm audit
```

`TEST_DATABASE_URL` is required for database integration tests. Browser tests also need the isolated backend fixture setup described in the testing guide and CI. `prisma:status` and `prisma:check-drift` inspect the database selected by `DATABASE_URL`; use the same disposable target for verification. CI now includes the drift check after migration status.

## Setup and remaining acceptance

The current development/deployment database still needs the repository's migrations if they have not already been applied. Nothing in this review migrates it automatically. From `services/`, with the intended database configured:

```sh
npm run prisma:migrate
npm run prisma:generate
npm run prisma:status
npm run prisma:check-drift
```

Do not reset a database to resolve a missing table. Confirm the database URL and migration status first. The new startup check makes an incomplete worker schema explicit before serving traffic.

Still requiring real-environment acceptance:

- Camera scanning and permissions on actual Android/iPhone devices; sound and desktop-notification permissions in real browsers.
- Keyboard/screen-reader acceptance beyond the existing accessible controls and automated interaction checks.
- Hosted TLS/CORS/proxy settings, sleeping-instance behavior, worker recovery, backups and a tested restore.
- Load/failure tests and multi-instance notification fanout/shared rate limiting if scaling beyond the single API process.
- Role-by-role business acceptance with hospital users and the pilot ward.

Existing product limitations remain: manual routing, browser-localStorage authentication tokens, no closed-browser push/SMS/email, and workers inside the API process. See [project status](../project-status.md), [notifications](../architecture/notifications.md), and the [full testing guide](../guides/full-testing-guide.md). No deployment or production-data mutation was performed.
