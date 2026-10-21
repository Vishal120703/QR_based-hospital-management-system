# Code map: following one request through the code

This page answers "where is the code for this?" for any API request: which files a request passes through, where sign-in, permission, and hospital checks happen, where the transaction starts and ends, and which tests cover it. The [data-flow page](./data-flow.md) shows the same journeys as diagrams; this page is about the files.

## 1. From a URL to its files

Every request goes through the same outer layers:

1. **Browser → API.** The web app calls `/api/...` through [`frontend/src/api/client.ts`](../../frontend/src/api/client.ts). In development Vite forwards `/api` to the API and drops the prefix ([`vite.config.ts`](../../frontend/vite.config.ts)); in production `VITE_API_URL` or the host's proxy does the same.
2. **Shared middleware** in [`services/src/app.ts`](../../services/src/app.ts): security headers, CORS, request ID, logging, JSON body, and "commands take no query parameters".
3. **The URL map** in [`services/src/routes/index.ts`](../../services/src/routes/index.ts) mounts every module's routes in three groups:
   - root: staff sign-in (`/auth/staff/*`), platform sign-in and console (`/auth/platform/*`, `/platform/*`);
   - `/admin/*`: hospital staff, signed in **once** here by `requireStaffAuth`;
   - `/public/*`: patients, with the guest session checked **on each route**.
4. **The module**: `<name>.routes.ts` (URL and permission guard) → `<name>.controller.ts` (parses the body with the Zod schema in `<name>.schemas.ts`) → a service (rules, hospital and area checks, transaction, audit) → `<name>.repository.ts` (database queries). [`services/src/container.ts`](../../services/src/container.ts) creates each service and controller once.

| URL | Routes | Service that does the work |
|---|---|---|
| `/auth/staff/*` | `modules/auth/auth.routes.ts` | `StaffAuthService` (`auth.service.ts`) |
| `/auth/platform/*`, `/platform/*` | `modules/platform/platform.routes.ts` | `PlatformAuthService`, `PlatformService` |
| `/admin/hospital`, `/admin/hospital/logo` | `modules/hospitals/hospital.routes.ts` | `HospitalService` |
| `/admin/roles`, `/admin/memberships/:id/roles` | `modules/roles/role.routes.ts` | `RoleService` (`role.service.ts`) |
| `/admin/buildings`, `floors`, `wards`, `rooms`, `beds` | `modules/locations/location.routes.ts` (generic CRUD, see 2.1) | one service per level: `building.service.ts` … `bed.service.ts` |
| `/admin/wards/:id/bulk-beds` | `modules/locations/location.routes.ts` | `BedService.bulkCreate` (`bed.service.ts`) |
| `/admin/bed-sessions`, `/admin/bed-occupancy` | `modules/bed-sessions/bed-session.routes.ts` | `BedSessionService` |
| `/admin/qr-codes`, `/admin/beds/:id/qr*` | `modules/qr/qr.routes.ts` | `QrCodeService` |
| `/admin/departments` | `modules/departments/department.routes.ts` (generic CRUD) | `DepartmentService` |
| `/admin/staff`, `/admin/shifts` | `modules/staff/staff.routes.ts` | `StaffService`, `ShiftService` |
| `/admin/service-categories`, `/admin/services` | `modules/catalog/catalog.routes.ts` (generic CRUD) | `CategoryService`, `ServiceItemService` |
| `/admin/sla-policies`, `/admin/escalation-policies` | `modules/sla/sla.routes.ts` (generic CRUD) | `SlaPolicyService`, `EscalationPolicyService` |
| `/admin/requests` (lists, alerts, one request, events) | `modules/requests/request.routes.ts` | `RequestQueryService` (`request-query.service.ts`) |
| `/admin/requests/:id/<command>` | `modules/requests/request.routes.ts` | `RequestCommandService.run` (`request-command.service.ts`) |
| `/admin/reports/*` | `modules/reports/report.routes.ts` | `ReportService`; figures in `report-facts.ts`, `report-metrics.ts`, `person-activity.ts` |
| `/admin/audit-log` | `modules/audit/audit.routes.ts` | `AuditService` |
| `/admin/notifications` | `modules/notifications/notification.routes.ts` | `NotificationService` |
| `/public/logos/:publicId` | `modules/hospitals/hospital.routes.ts` | `HospitalService` |
| `/public/qr/resolve` | `modules/qr/qr.routes.ts` | `QrCodeService` |
| `/public/session` | `modules/bed-sessions/bed-session.routes.ts` | `GuestSessionService` |
| `/public/services` | `modules/catalog/catalog.routes.ts` | `CatalogController.patientCatalog` |
| `/public/requests*` | `modules/requests/request.routes.ts` | `PatientRequestService` (`patient-request.service.ts`) |

`/health` and `/ready` are mounted in `app.ts` before these.

## 2. Three requests, step by step

### 2.1 A manager adds a floor (generic CRUD)

`POST /api/admin/floors` with `{ code, name, level, buildingId }`.

| Step | File | What happens |
|---|---|---|
| Form | `frontend/src/features/locations/LocationForms.tsx` (`AddFloorForm`) | Calls `staffApi.create(token, 'floors', …)` ([`api/staff.ts`](../../frontend/src/api/staff.ts)). |
| Sign-in | `routes/index.ts` → `middleware/staff-auth.ts` (`requireStaffAuth`) | The bearer token must be a live staff session; it sets the staff context (hospital, permissions, scopes). |
| Permission | `modules/locations/location.routes.ts` | `registerCrudRoutes(router, '/floors', …)` from [`http/crud.ts`](../../services/src/http/crud.ts) adds the five standard routes. `POST` needs `location.manage` **hospital-wide** (`requirePermission`); reads accept a floor- or ward-level `location.read`. |
| Input | `http/crud.ts` (`CrudController.create`) | Parses the body with `createFloorSchema` (`location.schemas.ts`). |
| Rules | `modules/locations/floor.service.ts` (`FloorService.create`) | Opens a **Serializable** transaction (`writeSerializable` in `location-rules.ts`), requires an active building if one is given (`requireActiveParent`), creates the floor with the **hospital ID from the session** (never from the body), and records the audit entry in the same transaction. |
| Query | `modules/locations/location.repository.ts` | `createFloor`; every query is scoped by `hospitalId`. |
| Reply | `http/crud.ts` | `201 { floor }`; the transaction committed before the reply. |

Tests: `services/tests/integration/locations.test.ts`, `tenant-isolation.test.ts`; screen: `frontend/tests/locations.test.tsx`.

The generic CRUD layer (`http/crud.ts`) is used where a resource has exactly the five standard operations: locations, departments, catalog, and SLA. Each location level's service offers those five methods directly, so the controller hands it over without mapping.

### 2.2 A manager assigns a request (a lifecycle command)

`POST /api/admin/requests/:id/assign` with `{ expectedVersion, assigneeId }`.

| Step | File | What happens |
|---|---|---|
| Screen | `frontend/src/features/requests/RequestCard.tsx` → `RequestsPage.tsx` (`act`) | **Choose staff** loads eligible people (`GET /admin/staff/eligible`); **Assign request** calls `staffApi.requestAction`. The list itself comes from `use-request-queue.ts`. |
| Sign-in | `routes/index.ts` → `requireStaffAuth` | As above. |
| Permission | `modules/requests/request.routes.ts` | One route per command from `requestCommands` (`request.schemas.ts`); each needs its permission **anywhere** (`requireScopedPermission('request.assign')`). The area is checked in the service. |
| Input | `request.controller.ts` (`command('assign')`) | Parses the command's own schema (`withAssignee`). |
| Rules | `modules/requests/request-command.service.ts` (`run`) | **One transaction**: loads the request with its bed's place; returns *not found* unless the caller's scope covers that floor, ward, or department (`canAccessLocation`); checks `expectedVersion` and the allowed transition (`request-transitions.ts`); checks the assignee is eligible now (`findEligibleStaff`, `modules/staff/eligibility.ts`); updates the request **only if unchanged** (a concurrent change becomes a 409); appends a `RequestEvent`; writes the staff audit entry. |
| Reply | `request.controller.ts` | `200 { serviceRequest }`. |
| Afterwards | `modules/notifications/` | The notification worker reads new request events and creates inbox notices outside this transaction ([notification architecture](./notifications.md)). |

Tests: `services/tests/integration/request-core.test.ts`, `request-queue.test.ts`, `notifications.test.ts`, `tenant-isolation.test.ts`; screen: `frontend/tests/requests.test.tsx`. The state machine is described in [request-state-machine.md](./request-state-machine.md).

### 2.3 A patient asks for a service

`POST /api/public/requests` with `{ serviceId }`, using the guest token from the bedside QR.

| Step | File | What happens |
|---|---|---|
| Screen | `frontend/src/features/patient/ServiceCategory.tsx` → `PatientPage.tsx` (`submit`) | Calls `guestApi.submitRequest` ([`api/patient.ts`](../../frontend/src/api/patient.ts)). |
| Sign-in | `modules/requests/request.routes.ts` → `middleware/guest-auth.ts` (`requireGuestSession`) | The guest token must be a live guest session (`GuestSessionService.authenticate`); hospital, bed, and stay come only from it. |
| Input | `request.controller.ts` (`PatientRequestController.submit`) | Parses `submitRequestSchema`. |
| Rules | `modules/requests/patient-request.service.ts` (`submitForGuest`, `submit`) | Returns the already-open request for the same service if there is one (`200`). Otherwise **one transaction**: locks the bed stay and the guest session rows so closing the stay or replacing the QR cannot race it, rechecks that the session is live and the hospital open, copies the service, department, priority, and SLA deadlines (`snapshotService`, catalog module), creates the request, and appends the `SUBMITTED` event. A database unique index stops two open requests for one service; a lost race returns the winner. |
| Reply | `request.controller.ts` | `201` (new) or `200` (existing) with the patient-safe view (`toPublicRequest`: no internal IDs). |

Tests: `services/tests/integration/public-requests.test.ts`, `request-core.test.ts`, `qr-bed-sessions.test.ts`; screen: `frontend/tests/patient.test.tsx`.

## 3. Where larger modules keep each job

- **locations:** one service per level (`building`, `floor`, `ward`, `room`, `bed`) composed by `location.service.ts`; shared rules in `location-rules.ts`; area filters in `location-access.ts`.
- **requests:** `request-query.service.ts` (read), `patient-request.service.ts` (patients), `request-command.service.ts` (staff commands), composed by `request.service.ts`; the state machine in `request-transitions.ts`; the SLA worker in `escalation.service.ts`.
- **reports:** `report.service.ts` loads data and checks access; the figures are pure functions in `report-facts.ts`, `report-metrics.ts`, and `person-activity.ts` (unit-tested in `tests/unit/report-metrics.test.ts`).
- **roles, staff:** setup helpers that skip staff checks (for onboarding and the super admin) are in `role-setup.ts` and `staff-account.ts`, apart from the checked services.

On the web side, a screen's file holds its state and layout, with its parts beside it: for example `features/requests/` has `RequestsPage.tsx`, `RequestCard.tsx`, `RequestDialogs.tsx`, and `use-request-queue.ts`; `features/locations/` has one panel per level, its forms, and `LayoutTree.tsx`; `features/patient/` keeps the English and Hindi text in `patient-copy.ts`. Shared UI is in `frontend/src/components/` (one file per kind, imported from `components/index.tsx`).

## 4. Reviewing a change to one request

Before approving a change, check that you can answer, from the code:

1. Which route, controller, service, and repository handle it (sections 1–2)?
2. Which sign-in and permission guard applies, and is the permission hospital-wide or scoped?
3. Where is the hospital ID taken from (the session, never the request), and where is the area (floor, ward, department) checked?
4. Where does the transaction begin and end, and what else is written in it (event, audit)?
5. Which integration and screen tests cover it, and was a test added for the changed behaviour?
