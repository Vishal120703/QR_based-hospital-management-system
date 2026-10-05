# Request State Machine

Status: Frozen for V1  
Last reviewed: 2026-10-05

## States

| State | Meaning | Terminal |
|---|---|---:|
| `SUBMITTED` | Valid request recorded, not yet assigned | No |
| `ASSIGNED` | Assigned to an eligible staff member or pool | No |
| `ACCEPTED` | A staff member has accepted responsibility | No |
| `IN_PROGRESS` | Work has begun | No |
| `COMPLETED` | Staff reports the service complete | No |
| `CLOSED` | Completion has been finalized | Yes |
| `CANCELLED` | Request was cancelled before work began | Yes |
| `REJECTED` | An assigned request was rejected with a reason | Yes |

Escalation is orthogonal to state and is recorded through `isEscalated`, `escalationLevel`, and RequestEvents.

## Allowed transitions

| From | Command | To | Required behavior |
|---|---|---|---|
| `SUBMITTED` | assign | `ASSIGNED` | Validate routing and assignee/pool eligibility |
| `SUBMITTED` | cancel | `CANCELLED` | Require an allowed actor and reason where policy requires it |
| `ASSIGNED` | accept | `ACCEPTED` | Atomically prevent competing acceptance |
| `ASSIGNED` | cancel | `CANCELLED` | Record actor and reason |
| `ASSIGNED` | reject | `REJECTED` | Record actor and mandatory reason |
| `ACCEPTED` | start | `IN_PROGRESS` | Actor must own or be authorized over the assignment |
| `IN_PROGRESS` | complete | `COMPLETED` | Record completion actor and timestamp |
| `COMPLETED` | close | `CLOSED` | Finalize the workflow |
| `ACCEPTED` | transfer | `ASSIGNED` | Replace assignment and record transfer details |
| `IN_PROGRESS` | transfer | `ASSIGNED` | Replace assignment and record transfer details |

All other transitions are invalid. Terminal states have no outgoing transitions in V1.

Transfer is a domain command, not an intermediate request state. It clears the previous active assignment as required, creates the new assignment, returns the request to `ASSIGNED`, and appends an immutable event.

## Command rules

- There is no generic status PATCH endpoint.
- Each transition has a named command such as `/assign`, `/accept`, `/start`, `/complete`, `/close`, `/cancel`, `/reject`, or `/transfer`.
- Commands validate authentication domain, active hospital membership, permission, location scope, current state, actor eligibility, and tenant ownership.
- Client-provided `hospitalId`, role, permission, scope, department, assignee eligibility, bed, or session is never authoritative.
- State changes use a transaction and a concurrency guard (`version` or a conditional current-state update).
- The state update and its RequestEvent either both commit or both roll back.
- Retried commands must not create duplicate effects. Where a retry is safe to return the existing result, the API documents that behavior; otherwise it returns a conflict.

## Required timestamps

The first successful transition into a state sets its corresponding timestamp:

- `submittedAt`
- `assignedAt`
- `acceptedAt`
- `startedAt`
- `completedAt`
- `closedAt`
- `cancelledAt`

Transfer sets a new assignment timestamp/history event but does not erase historical RequestEvents. Rejection is represented in RequestEvent history and should have an explicit persisted rejection timestamp if the final schema includes it.

## RequestEvent invariant

Every successful command appends an immutable event containing at least:

- request and hospital identifiers
- event type
- previous and resulting state
- actor type and actor identifier when applicable
- occurred-at timestamp
- reason and structured metadata when applicable
- request version/correlation information

RequestEvents are append-only. Corrections create additional events rather than editing history.

## Concurrency expectations

- Only one actor can win acceptance of the same pool assignment.
- Commands with a stale request version or unexpected current state fail with a conflict.
- Duplicate submission is protected using the BedSession, ServiceItem, and active-state rule defined for the public flow.
- Queue redelivery and client retries cannot apply the same transition twice.

## Minimum transition test matrix

Tests must cover every allowed transition and representative forbidden transitions, including:

- `SUBMITTED → COMPLETED` is rejected.
- `ASSIGNED → IN_PROGRESS` is rejected.
- `ACCEPTED → COMPLETED` is rejected.
- `COMPLETED → ACCEPTED` is rejected.
- A terminal state cannot transition.
- Simultaneous acceptance produces exactly one winner and one transition event.
- A forced persistence failure rolls back both the state change and event.

