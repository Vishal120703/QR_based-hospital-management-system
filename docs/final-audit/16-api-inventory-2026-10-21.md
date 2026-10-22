# API inventory — 2026-10-21

This inventory expands the five routes registered by each generic CRUD resource and the eight dynamically registered request commands. All `/admin/*` routes first require a valid staff session. Public guest routes state where a guest session is also required.

The generated [OpenAPI contract](../../services/openapi.json) is the exact route inventory. CI
rebuilds it from the Express route registry and fingerprints every route and Zod schema source, so
an undocumented API change fails `npm run docs:api:check`.

## Health and process

| Methods and paths                    | Access                     |
| ------------------------------------ | -------------------------- |
| `GET /`, `GET /health`, `GET /ready` | Public; strict empty query |

## Authentication and platform

| Methods and paths                                                                                                     | Access                                              |
| --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `POST /auth/staff/login`                                                                                              | Public; address and account+address rate limits     |
| `GET /auth/staff/me`, `POST /auth/staff/logout`, `POST /auth/staff/password`                                          | Staff session; password route has member rate limit |
| `POST /auth/platform/login`                                                                                           | Public; address rate limit                          |
| `GET /auth/platform/me`, `POST /auth/platform/logout`, `POST /auth/platform/password`                                 | Platform session                                    |
| `GET /platform/clients`, `GET /platform/clients/:id`, `PATCH /platform/clients/:id`                                   | Platform session                                    |
| `GET /platform/hospitals`, `POST /platform/hospitals`, `GET /platform/hospitals/:id`, `PATCH /platform/hospitals/:id` | Platform session                                    |
| `PUT /platform/hospitals/:id/logo`, `DELETE /platform/hospitals/:id/logo`, `POST /platform/hospitals/:id/managers`    | Platform session                                    |

## Standard admin CRUD sets

Each resource below has `GET /resource`, `GET /resource/:id`, `POST /resource`, `PATCH /resource/:id`, and `DELETE /resource/:id`.

| Resources                                                           | Read guard                   | Change guard                    |
| ------------------------------------------------------------------- | ---------------------------- | ------------------------------- |
| `/admin/buildings`, `/admin/floors`, `/admin/wards`, `/admin/rooms` | scoped `location.read`       | hospital-wide `location.manage` |
| `/admin/beds`                                                       | scoped `bed.read`            | hospital-wide `bed.manage`      |
| `/admin/departments`                                                | hospital-wide `staff.read`   | hospital-wide `staff.manage`    |
| `/admin/service-categories`, `/admin/services`                      | hospital-wide `service.read` | hospital-wide `service.manage`  |
| `/admin/sla-policies`, `/admin/escalation-policies`                 | hospital-wide `service.read` | hospital-wide `sla.manage`      |

## Hospital, roles, and locations

| Methods and paths                                                                                            | Permission                     |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| `GET /admin/hospital`                                                                                        | `hospital.read`                |
| `PATCH /admin/hospital`, `PUT /admin/hospital/logo`, `DELETE /admin/hospital/logo`                           | `hospital.manage`              |
| `GET /admin/roles`, `GET /admin/roles/:id`                                                                   | `role.read`                    |
| `POST /admin/roles`, `PATCH /admin/roles/:id`, `DELETE /admin/roles/:id`                                     | `role.manage`                  |
| `POST /admin/memberships/:id/roles`                                                                          | `staff.manage` + `role.manage` |
| `DELETE /admin/memberships/:id/roles/:roleId`, `DELETE /admin/memberships/:id/roles/:roleId/scopes/:scopeId` | `staff.manage` + `role.manage` |
| `POST /admin/wards/:id/bulk-beds`                                                                            | `bed.manage`                   |

## Bed stays and QR

| Methods and paths                                                                        | Permission                                      |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `GET /admin/bed-sessions`                                                                | scoped `bed.read`                               |
| `POST /admin/bed-sessions`, `POST /admin/bed-sessions/:id/close`                         | scoped `bedSession.manage`, service checks area |
| `PUT /admin/bed-occupancy`                                                               | `hospital.manage`                               |
| `GET /admin/qr-codes`                                                                    | scoped `bed.read`                               |
| `POST /admin/qr-codes/batch`, `POST /admin/beds/:id/qr`, `POST /admin/beds/:id/qr/print` | `hospital.manage` + `qr.generate`               |
| `POST /admin/beds/:id/qr/rotate`                                                         | `hospital.manage` + `qr.rotate`                 |
| `POST /admin/beds/:id/qr/revoke`                                                         | `hospital.manage` + `qr.revoke`                 |

## Staff and shifts

| Methods and paths                                                                                                                             | Permission                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `GET /admin/staff`, `GET /admin/staff/:id`, `GET /admin/shifts`                                                                               | hospital-wide `staff.read`                   |
| `GET /admin/staff/eligible`                                                                                                                   | scoped `staff.read`, service checks bed area |
| `POST /admin/staff`, `POST /admin/staff/bulk`, `POST /admin/staff/:id/status`, `POST /admin/staff/:id/password`, `POST /admin/staff/:id/duty` | `staff.manage`                               |
| `POST /admin/staff/:id/departments`, `DELETE /admin/staff/:id/departments/:departmentId`                                                      | `staff.manage`                               |
| `POST /admin/staff/:id/coverage`, `DELETE /admin/staff/:id/coverage/:coverageId`                                                              | `staff.manage`                               |
| `POST /admin/shifts`, `DELETE /admin/shifts/:id`                                                                                              | `staff.manage`                               |

## Requests

| Methods and paths                                                                                                | Permission                                                          |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `GET /admin/requests`, `GET /admin/requests/alerts`, `GET /admin/requests/:id`, `GET /admin/requests/:id/events` | scoped `request.read`; query service filters visible area/ownership |
| `POST /admin/requests/:id/assign`                                                                                | scoped `request.assign`                                             |
| `POST /admin/requests/:id/accept`                                                                                | scoped `request.accept` + assignee/eligibility rules                |
| `POST /admin/requests/:id/start`                                                                                 | scoped `request.start` + assignee rule                              |
| `POST /admin/requests/:id/complete`                                                                              | scoped `request.complete` + assignee rule                           |
| `POST /admin/requests/:id/close`                                                                                 | scoped `request.close`                                              |
| `POST /admin/requests/:id/cancel`                                                                                | scoped `request.cancel`                                             |
| `POST /admin/requests/:id/reject`                                                                                | scoped `request.reject` + assignee rule                             |
| `POST /admin/requests/:id/transfer`                                                                              | scoped `request.transfer` + eligibility rule                        |

All request commands require `expectedVersion`; invalid states/stale updates return conflict instead of arbitrary status mutation.

## Reports, audit, notifications

| Methods and paths                                                                                                                    | Permission                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| `GET /admin/reports/requests`, `GET /admin/reports/requests/log`, `GET /admin/reports/requests/:id`, `GET /admin/reports/people/:id` | scoped `analytics.read`; service adds area predicate        |
| `GET /admin/audit-log`                                                                                                               | hospital-wide `audit.read`                                  |
| `GET /admin/notifications`, `GET /admin/notifications/unread-count`, `POST /admin/notifications/:id/read`                            | authenticated staff; repository binds hospital + membership |

## Public patient and assets

| Methods and paths                                                                         | Access                                                   |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `GET /public/logos/:publicId`                                                             | Public, versioned asset ID                               |
| `POST /public/qr/resolve`                                                                 | Public; address rate limit; opaque QR token              |
| `GET /public/session`                                                                     | Guest session                                            |
| `GET /public/services`                                                                    | Guest session                                            |
| `GET /public/requests`, `POST /public/requests`, `POST /public/requests/:publicId/cancel` | Guest session; hospital/bed/stay derived from credential |

## Common contract behavior

- Non-GET/HEAD query strings are rejected globally.
- Module schemas are strict: undeclared body/query fields are rejected.
- Authenticated JSON and errors default to `Cache-Control: no-store`.
- Error envelope: `{ error: { code, message, requestId, fields? } }`.
- Typical statuses: 200 read/update, 201 create, 204 no-content action/delete, 400 validation, 401 unauthenticated, 403 forbidden, 404 hidden/unknown, 409 conflict, 413 payload too large, 429 rate limited, 500 safe internal error, 503 not ready.
- Current frontend compatibility is verified; no API behavior was changed by this audit.
