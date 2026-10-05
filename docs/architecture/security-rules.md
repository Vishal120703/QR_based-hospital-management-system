# Security Rules

Status: Frozen for V1  
Last reviewed: 2026-10-05

These rules are mandatory across CARE QR V1.

## Input and trust boundaries

- All endpoint inputs are validated with Zod, including params, query, headers where applicable, and body.
- Unknown or forbidden fields are rejected for security-sensitive commands.
- The server never trusts client-supplied `hospitalId`, `bedId`, `wardId`, `departmentId`, `assigneeId`, role, permission, scope, request state, or assignment eligibility.
- Public requests derive hospital, bed, and BedSession only from a validated server-side GuestSession.
- Controllers validate transport input and call application services; they do not implement business rules or access Prisma directly.
- Error responses are standardized and do not expose stack traces, SQL details, secrets, or internal object existence.

## Authentication and authorization

- Platform, hospital staff, and guest authentication use separate credential/session domains.
- Every protected operation checks authentication, active status, active hospital membership, permission, tenant ownership, and applicable department/location scope.
- Authorization is enforced server-side for HTTP, WebSocket, worker, and administrative paths.
- Sensitive administrative actions require explicit permissions and immutable AuditLog records.
- Session and credential expiration, revocation, and rotation are enforced against authoritative server-side state.

## QR and guest-session security

- QR tokens contain at least 256 bits of cryptographically secure randomness.
- Only SHA-256 hashes of QR tokens are stored. Raw QR secrets are not logged, cached, placed in analytics, or returned after the issuance flow.
- Token comparison and resolution do not expose whether a hospital, bed, or session exists.
- QR resolution is rate-limited and monitored for abuse.
- Revoked, rotated, expired, inactive-bed, and no-active-BedSession cases are denied.
- Guest session credentials are short-lived, securely generated, revocable, and protected in transit and at rest according to the chosen session transport.
- Closing the related BedSession invalidates access even if a GuestSession's nominal expiry has not passed.
- The permanent QR secret is removed from ordinary navigation after resolution wherever practical.

## Data protection

- Collect the minimum patient/attendant data required for the service workflow; V1 does not require a patient account.
- Secrets, tokens, credentials, and sensitive personal data are never written to application logs.
- Logs are structured and include a request/correlation ID.
- Production traffic uses TLS. Cookies, if used, are `Secure`, `HttpOnly`, and use an appropriate `SameSite` policy.
- CORS, trusted proxy behavior, body limits, security headers, and rate limits are configured explicitly per environment.
- Environment variables are validated before the application accepts traffic. The application fails startup on missing or invalid required configuration.

## State and transaction integrity

- PostgreSQL is authoritative; Redis, BullMQ, and Socket.IO are not sources of truth.
- Request transitions use named commands and the frozen state machine. Arbitrary status PATCH operations are forbidden.
- Every important transition and its RequestEvent commit atomically.
- Administrative configuration changes and their AuditLog records commit as one logical operation.
- Race-prone operations use database constraints and transactional/optimistic concurrency checks.
- Queue consumers are idempotent, revalidate current database state, and tolerate redelivery.
- Real-time messages notify clients to reconcile with authoritative API state; they do not grant access or define state.

## Auditability

AuditLog covers at least:

- hospital and security configuration changes
- role, permission, membership, and scope changes
- location, bed, service, routing, SLA, and escalation configuration changes
- QR generation, rotation, and revocation
- BedSession start and close
- privileged assignment, transfer, cancellation, rejection, and override actions

Audit records include server-derived tenant, actor, action, target, timestamp, request ID, and safe before/after metadata. Audit history is append-only and excludes credentials and raw QR/session tokens.

## Operational safeguards

- Health endpoints disclose only necessary dependency status and no secrets.
- Database and Redis readiness are distinguished from process liveness.
- Dependencies and build artifacts are scanned in CI when the deployment phase is introduced.
- Backups, restore testing, retention, secret rotation, and least-privilege deployment credentials are required before production rollout.
- A medical-emergency disclaimer is visible in patient flows. CARE QR does not replace emergency processes.

## Mandatory security test categories

- Authentication failure and session revocation
- Permission and scope denial
- Full cross-tenant CRUD and relationship isolation
- QR guessing, rotation, revocation, expiry, and rate limiting
- GuestSession manipulation and BedSession closure
- Validation of malformed, extra, and oversized inputs
- Concurrent acceptance, duplicate submission, and idempotent retry
- Transaction rollback for RequestEvent and AuditLog coupling
- WebSocket subscription isolation
- Queue redelivery and stale-job behavior
- Safe production error responses and log redaction

Security-critical tests cannot be removed or weakened merely to make CI pass.

