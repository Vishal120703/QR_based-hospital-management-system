# Reports — scope evidence only

Status: FAIL for authorization scope (AUD-001); arithmetic/timezone correctness remains UNVERIFIED. Stage 8 not executed.

New/uncommitted person-report code is included in the current tests and in the additional scope probe. Summary/log/timeline work stays filtered in the exercised cases; person identity fallback does not. See 04-auth-authorization-tenancy.md for reproduction.

The existing reports-audit.test.ts verifies several known outcome/staff/transfer totals and passed. This run did not independently calculate the complete Stage 8 fixture, inspect browser-vs-hospital timezone presets, verify DST/midnight boundaries, export values, renamed/former staff semantics, or 20,000/2,000 truncation behavior. The brief's timezone suspicion is not yet a confirmed finding and must remain pending.

## Update 2026-10-12

- Scope: AUD-001 resolved (see [04](./04-auth-authorization-tenancy.md#resolution-2026-10-12)).
- Time zone: report and audit-log periods are now sent as hospital days and read by the API in the hospital's configured time zone (DST-safe, including days that skip midnight); "today", day-by-day tables, labels, file names, and report times use the hospital's zone. Tested: unit tests for zone arithmetic (Kolkata, Kathmandu, Kiritimati, New York and London DST, São Paulo skipped midnight), API tests at a 23:59/00:01 boundary on New York's DST day with the server in another zone, web tests with the viewer in Los Angeles, and an end-to-end test with the manager's browser in Los Angeles.
- Cleared, impossible, reversed, and over-a-year custom dates are explained instead of throwing `RangeError: Invalid time value`.
- Still unverified: an independent recalculation of every report measure, export values, and the 20,000/2,000 truncation behavior.
