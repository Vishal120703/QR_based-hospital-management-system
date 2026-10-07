# Tenant Rules

Status: Frozen for V1  
Last reviewed: 2026-10-05

This is the V1 tenant-isolation policy, including planned routing, notifications, background jobs, and real-time features. Those future components are not present in the current app; see [project status](../project-status.md) for what is implemented today.

## Boundary

`Hospital` is the CARE QR tenant. Every hospital-owned record has exactly one non-null `hospitalId`, including location, bed, department, service catalog, membership, role assignment, scope, routing, request, SLA, shift, QR, BedSession, GuestSession, audit, and notification records.

Platform-owned records are the only exception and must be explicitly identified as platform data.

## Trusted tenant context

The active tenant is derived on the server:

- Staff requests: verified identity plus an active HospitalMembership selects the tenant.
- Patient/attendant requests: a validated GuestSession supplies `hospitalId`, `bedId`, and `bedSessionId`.
- Background jobs: the durable job reference is reloaded from PostgreSQL and its tenant ownership is revalidated before processing.

Credential resolution is a narrow pre-tenant exception: login may look up a hospital code and user email, and bearer authentication may look up a hashed opaque session token. These lookups grant no access by themselves. The resolved active hospital, membership, and session must agree before any tenant-owned operation runs.


Headers, query parameters, route parameters, request bodies, Socket.IO payloads, and queue payloads never establish tenant ownership by themselves.

After staff authentication, request context exposes a validated actor, tenant, permissions, and scopes. Application services receive this tenant context explicitly.

## Query invariants

- Every read, insert, update, and delete of tenant-owned data is scoped by `hospitalId`.
- Entity lookup is conceptualized as `(hospitalId, entityId)`, never just `entityId`.
- Foreign-key relationships are validated as belonging to the same hospital before mutation.
- Database constraints use tenant-aware unique keys where uniqueness is hospital-local.
- Relation connect operations cannot attach another hospital's record.
- Counts, aggregates, exports, analytics, audit queries, real-time rooms, cache keys, and job processing obey the same tenant boundary.
- Modules expose tenant-scoped repositories/services so controllers cannot bypass the rule.

Prisma `findUnique({ where: { id } })` is not sufficient for a tenant-owned resource. Prefer a tenant-qualified unique selector where available or `findFirst`/`updateMany` with both identifiers and an affected-row check.

## Authorization and scope

Tenant membership and permission are both required. Location or department scope may further restrict access.

- A global user identity does not grant hospital access.
- Roles and permissions come from persisted active membership relationships, not client claims alone.
- `User.role` and `User.departmentId` are not the authorization model.
- Cross-hospital role, department, assignee, routing, bed, location, and service identifiers are rejected.
- Scope elevation requires an explicit authorized policy and AuditLog entry.

## Information disclosure policy

For tenant-owned resource identifiers, an authenticated user who lacks access receives `404 Not Found` by default so existence is not disclosed. `403 Forbidden` is used when the resource is visible in the active tenant but the actor lacks permission for the requested action. Authentication failures return `401 Unauthorized`.

Public QR and GuestSession failures use non-enumerating responses and do not reveal the hospital, bed, session, or token status.

## Creation and lifecycle

- `hospitalId` on new records is assigned from trusted context, not copied from input.
- Tenant ownership is immutable. Moving a resource between hospitals is not supported in V1.
- Hospital suspension blocks hospital operations according to the authentication policy without deleting data.
- Tenant deletion and cross-tenant data migration are outside V1 and require a separately reviewed destructive-data procedure.

## Infrastructure isolation

- Redis keys and Socket.IO rooms include server-derived tenant namespaces.
- Queue payloads contain opaque record identifiers and correlation data only as needed; workers reload authoritative records and verify tenant ownership.
- Logs include tenant and request correlation identifiers where safe, but never secrets or raw QR/session credentials.
- Redis cache eviction or loss must not weaken authorization or change authoritative state.

## Required isolation tests

For every tenant-owned resource and CRUD capability, tests prove:

- Hospital A can act on Hospital A data when authorized.
- Hospital B cannot read, update, or delete Hospital A data using its UUID.
- Hospital B cannot create a relationship to Hospital A data.
- Missing/invalid authentication returns `401`.
- Valid membership without permission returns `403` for a known same-tenant resource.
- Cross-tenant probing follows the `404` non-disclosure policy.
- Filters, pagination, counts, exports, analytics, events, WebSocket subscriptions, caches, and jobs do not leak cross-tenant data.

No phase that introduces tenant-owned entities passes until its isolation suite passes.
