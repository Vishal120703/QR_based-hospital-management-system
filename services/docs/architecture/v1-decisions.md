# CARE QR V1 Architecture Decisions

Status: Frozen for V1  
Last reviewed: 2026-10-05

This document is the Phase 0 architecture freeze. Changing a frozen decision requires an explicit architecture decision record, an impact review, and updates to all affected tests and documentation.

## 1. Delivery architecture

CARE QR V1 is a **modular monolith**, not a set of microservices.

- The backend is deployed as one service. Background processing lives inside this service until scale or reliability requirements justify a separate process.
- Domain code is split into cohesive modules with explicit public interfaces.
- A module owns its business rules and persistence access. Controllers, jobs, and other modules must not query its tables directly.
- Cross-module calls use exported application services. Asynchronous side effects use typed domain/application events after the source transaction commits.
- PostgreSQL is the authoritative store. Redis, BullMQ, and Socket.IO are replaceable infrastructure and never hold authoritative state.
- No network calls, distributed transactions, service discovery, or duplicated databases are introduced between internal modules.

These boundaries allow a module to be extracted into a microservice later. Extraction is an option, not a V1 requirement.

### Repository shape

```text
care-qr/
├── frontend/
└── services/
    └── docs/
        └── architecture/
```

The backend service lives in `services/` and uses `src/modules/<domain>` for domain modules. Technical code lives in `src/common`, `src/config`, `src/database`, and `src/middleware`. More directories are added only when the corresponding feature exists. Shared frontend contracts can be exported from the backend or moved to a package later if there is a demonstrated need.

The original Phase 1 multi-workspace layout was simplified by the user on 2026-10-05. The rationale and impact, including the later rename to `services/`, are recorded in [ADR 0001](./adr-0001-single-app-layout.md).

## 2. Terminology and location hierarchy

The canonical hierarchy is:

```text
Platform
└── Hospital
    └── Building
        └── Floor
            └── Ward
                └── Room
                    └── Bed
```

Building and Room are optional layers. A hospital may use Hospital → Floor → Ward → Bed. Relationships must still be validated within the same hospital.

For V1, `Bed` means the care location or bed position. It does not represent a movable physical bed asset. A physical asset may be modeled separately in a future version.

## 3. Tenant model

- `Hospital` is the tenant boundary.
- Every hospital-owned record belongs to exactly one `hospitalId`.
- A person may eventually have memberships in multiple hospitals; permissions and scopes are evaluated through the active hospital membership.
- Tenant context is derived from authenticated server-side context, never from trusted client input.
- Detailed invariants are defined in [tenant-rules.md](./tenant-rules.md).

## 4. Authentication domains

The three authentication domains remain separate:

1. Platform authentication for platform operators.
2. Hospital staff authentication, membership, roles, permissions, and location scopes.
3. Patient/attendant guest sessions derived from a validated QR code and active BedSession.

Patients and attendants do not create accounts in V1.

## 5. Request lifecycle

The request states are:

- `SUBMITTED`
- `ASSIGNED`
- `ACCEPTED`
- `IN_PROGRESS`
- `COMPLETED`
- `CLOSED`
- `CANCELLED`
- `REJECTED`

`ESCALATED` is not a request state. Escalation is represented by `isEscalated`, `escalationLevel`, and immutable RequestEvents. The complete transition policy is in [request-state-machine.md](./request-state-machine.md).

## 6. Assignment modes

The V1 assignment enum is prepared with:

- `MANUAL`
- `POOL`
- `DIRECT` (reserved; not implemented initially)
- `AUTO_ASSIGN` (reserved; not implemented initially)

Only `MANUAL` is implemented first. `POOL` is introduced in its planned phase. Reserved enum values do not authorize behavior.

## 7. Priority

The request priorities are:

- `NORMAL`
- `HIGH`
- `URGENT`

`URGENT` does not mean medical emergency. Patient-facing flows must clearly state that CARE QR is not an emergency system and direct users to the hospital's emergency process.

## 8. QR approach

- QR URLs contain one opaque, cryptographically random token and no tenant or location identifiers.
- New QR tokens use at least 256 bits of cryptographically secure randomness.
- The database stores a SHA-256 token hash, not the recoverable raw token. The raw token is shown only when issued for QR generation.
- QR codes are versioned and can be rotated or revoked. Rotation invalidates the previous token.
- Resolving a QR requires an active QR record, active bed, and active BedSession.
- After resolution, normal patient navigation uses a short-lived GuestSession rather than repeatedly exposing the permanent QR token.
- Invalid, unknown, revoked, or cross-tenant QR lookups return a non-enumerating response.

## 9. BedSession and GuestSession approach

- A BedSession represents the period in which one care location is active for an occupant, without storing unnecessary patient identity.
- A bed may have at most one active BedSession, enforced by transactional application logic and a database constraint suitable for PostgreSQL.
- Authorized hospital staff manually start and close sessions in V1. HIS/ADT automation is deferred.
- Closing a BedSession transactionally revokes or invalidates all related GuestSessions and prevents new requests.
- GuestSessions are short-lived, revocable, bound server-side to exactly one `hospitalId`, `bedId`, and `bedSessionId`, and refreshed only under an explicit expiry policy.
- Public request creation derives its hospital, bed, and BedSession solely from the validated GuestSession. Conflicting client identifiers are rejected.

## 10. SLA definitions

- Each applicable request snapshots its policy version and durations at creation.
- `acceptDueAt = submittedAt + accept target duration`.
- `completeDueAt = submittedAt + completion target duration`.
- Both deadlines therefore measure total elapsed service time from submission; accepting a request does not reset the completion clock.
- Subsequent policy changes do not alter existing requests.
- SLA breach and escalation do not change the request's lifecycle state. They update escalation fields and append immutable RequestEvents.
- PostgreSQL timestamps are authoritative. Workers may detect and process breaches but cannot define or own deadline state.

## 11. Persistence and consistency

- PostgreSQL is the source of truth.
- Every important request transition and its RequestEvent are committed atomically.
- Important concurrent operations use database-backed guards such as transactions, conditional updates, unique constraints, or optimistic version checks.
- Every administrative configuration change produces an AuditLog entry in the same logical operation.
- Prisma migrations are versioned. `prisma db push` is not used for production schema evolution.
- Destructive migrations require explicit review and approval.

## 12. Deferred beyond the relevant planned phases

- Microservice extraction
- Automatic assignment
- HIS/ADT-driven BedSession lifecycle
- Physical movable-bed asset management
- Patient accounts
- Medical emergency workflows

## Phase 0 review checklist

- [x] Terminology frozen
- [x] Request states frozen
- [x] Tenant model frozen
- [x] QR approach frozen
- [x] BedSession approach frozen
- [x] Assignment modes frozen
- [x] SLA definitions frozen
