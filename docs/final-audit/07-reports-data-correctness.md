# Reports — scope evidence only

Status: FAIL for authorization scope (AUD-001); arithmetic/timezone correctness remains UNVERIFIED. Stage 8 not executed.

New/uncommitted person-report code is included in the current tests and in the additional scope probe. Summary/log/timeline work stays filtered in the exercised cases; person identity fallback does not. See 04-auth-authorization-tenancy.md for reproduction.

The existing reports-audit.test.ts verifies several known outcome/staff/transfer totals and passed. This run did not independently calculate the complete Stage 8 fixture, inspect browser-vs-hospital timezone presets, verify DST/midnight boundaries, export values, renamed/former staff semantics, or 20,000/2,000 truncation behavior. The brief's timezone suspicion is not yet a confirmed finding and must remain pending.
