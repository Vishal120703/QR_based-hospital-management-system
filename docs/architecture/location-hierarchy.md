# Location Hierarchy

Status: Implemented in Phase 3  
Last reviewed: 2026-10-05

```text
Hospital
└── Building   (optional)
    └── Floor
        └── Ward
            └── Room   (optional)
                └── Bed
```

A hospital may skip Building and Room: `Hospital → Floor → Ward → Bed` is valid. A `Bed` is the care location (bed position), not a movable bed asset.

## Unit and bed types

- **Unit (ward) types:** General, Private, Semi-private, Emergency, Day care, Maternity, Labour room, Pediatric, Isolation, Burns, Dialysis, Post-op recovery, Psychiatry, Other.
- **Bed types:** Standard, Isolation, Pediatric cot, Day-care chair, Dialysis chair, Emergency trolley, Labour bed, Other.
- **Intensive care is not supported.** ICU, HDU, CCU, NICU, and PICU units and ICU, ventilator, and incubator beds were removed (migration `13_no_intensive_care`): those patients are too critical to be served by a bedside self-service QR. The API rejects these types, and any existing unit or bed of those types was changed to *Other*.

## Ownership and relationships

- Every level has a non-null `hospitalId` assigned from the authenticated staff session.
- Parent links are composite `(hospitalId, parentId)` foreign keys, so PostgreSQL rejects a parent from another hospital even if application code is bypassed.
- A bed's optional room uses a `(hospitalId, wardId, roomId)` foreign key, so the room must belong to the bed's own ward.
- Parent references are fixed after creation. Moving a ward, room, or bed to another parent is not supported in V1; create a new location instead.

## Codes

Codes are case-insensitive, stored uppercase, and limited to letters, digits, `.`, `_`, and `-` (max 32 characters).

| Level | Code is unique within |
|---|---|
| Building | Hospital |
| Floor | Hospital (its building is optional, so the hospital is the only reliable parent) |
| Ward | Floor |
| Room | Ward |
| Bed | Ward |

## Active state

Invariant: an active location always has active ancestors.

- A child cannot be created under an inactive parent (`409`).
- A parent cannot be deactivated while it has active children (`409`); deactivate from the bottom up.
- A child cannot be reactivated while any parent is inactive (`409`).
- Writes run in serializable transactions so concurrent "deactivate parent" and "create child" requests cannot both commit. A request that loses the race receives `409` and may be retried.

## Bed status

| Status | Set by |
|---|---|
| `AVAILABLE` | Staff (`PATCH /admin/beds/:id`), default on creation |
| `MAINTENANCE` | Staff |
| `INACTIVE` | Staff (temporarily out of service) |
| `OCCUPIED` | BedSession lifecycle only (Phase 4); rejected as manual input |

While a bed is `OCCUPIED`, staff cannot change its status or deactivate it; that is managed through its BedSession. `active = false` retires the location administratively and is independent of the operational status.

## Deletion

A location can be deleted only when nothing references it. Child locations are checked explicitly (`409`); later references such as QR codes, BedSessions, and requests are protected by `ON DELETE RESTRICT` foreign keys. Deletion is audited with the full prior snapshot.

## API

All endpoints require a staff session. Reads need `location.read` (`bed.read` for beds); writes need `location.manage` (`bed.manage` for beds).

| Resource | List filters | Create body |
|---|---|---|
| `/admin/buildings` | `active` | `code`, `name` |
| `/admin/floors` | `buildingId`, `active` | `buildingId?`, `code`, `name` |
| `/admin/wards` | `floorId`, `active` | `floorId`, `code`, `name` |
| `/admin/rooms` | `wardId`, `active` | `wardId`, `code`, `name` |
| `/admin/beds` | `wardId`, `roomId`, `status`, `active` | `wardId`, `roomId?`, `code`, `displayName` |

Each resource supports `GET /`, `GET /:id`, `POST /`, `PATCH /:id`, and `DELETE /:id`. `PATCH` accepts `code`, `name` (`displayName` for beds), and `active`; beds also accept `status`. Unknown fields, including `hospitalId`, are rejected with `400`. A parent ID that does not exist in the caller's hospital returns `404`, whether it is missing or belongs to another hospital.

Every create, update, and delete writes an AuditLog entry with before/after snapshots in the same transaction.
