# Backend modules

Every module lives in `services/src/modules/<name>/` and follows the [five layers](./README.md#3-backend-layers). Other modules may use only what its `index.ts` exports. Repositories are never exported: another module reaches a module's tables only through its services and helpers. "Writes" lists the tables a module changes; a module may read other tables for checks and display.

| Module | What it does | Writes | Main routes |
|---|---|---|---|
| [auth](#auth) | Staff sign-in, sessions, password change, and the staff context used for every access check | `StaffSession` | `/auth/staff/*` |
| [platform](#platform) | Super admin: sign-in, clients, hospitals, managers | `Client`, `Hospital` (status, client), `PlatformSession` | `/auth/platform/*`, `/platform/*` |
| [hospitals](#hospitals) | Hospital onboarding, profile, logo, "is this hospital open" | `Client`, `Hospital`, `HospitalLogo` | `/admin/hospital*`, `/public/logos/:id` |
| [roles](#roles) | Permissions, built-in and custom roles, who holds which role where | `Permission`, `Role`, `RolePermission`, `UserRole`, `ScopeAssignment` | `/admin/roles*`, `/admin/memberships/:id/roles*` |
| [departments](#departments) | Teams such as Nursing or Pantry | `Department` | `/admin/departments*` |
| [staff](#staff) | Staff accounts, status, duty, departments, coverage, shifts, eligibility | `User`, `HospitalMembership`, `StaffDepartment`, `StaffLocationScope`, `Shift` | `/admin/staff*`, `/admin/shifts*` |
| [locations](#locations) | Building → Floor → Ward → Room → Bed, bulk beds, bed occupancy | `Building`, `Floor`, `Ward`, `Room`, `Bed` | `/admin/buildings` … `/admin/beds`, `/admin/wards/:id/bulk-beds` |
| [bed-sessions](#bed-sessions) | Admitting and discharging (bed sessions), the hospital's choice to admit at all, and patient guest sessions | `BedSession`, `GuestSession` | `/admin/bed-sessions*`, `/admin/bed-occupancy`, `/public/session` |
| [qr](#qr) | Bed QR codes (issue, view/print, replace, disable, print in bulk) and scanning | `BedQrCode` | `/admin/qr-codes*`, `/admin/beds/:id/qr*`, `/public/qr/resolve` |
| [catalog](#catalog) | Service categories and services; the request snapshot | `ServiceCategory`, `ServiceItem` | `/admin/service-categories*`, `/admin/services*`, `/public/services` |
| [sla](#sla) | Response-time targets (versioned) and escalation policies | `SlaPolicy`, `SlaPolicyVersion`, `EscalationPolicy`, `EscalationLevel` | `/admin/sla-policies*`, `/admin/escalation-policies*` |
| [requests](#requests) | The patient request lifecycle, its event history, the paged work queue, alerts, and the SLA escalation worker | `ServiceRequest`, `RequestEvent`, `RequestEscalation` | `/admin/requests*`, `/public/requests*` |
| [reports](#reports) | Request reports: totals, staff work, one person's work, why not completed, history | — (read only) | `/admin/reports/requests*`, `/admin/reports/people/:id` |
| [audit](#audit) | Recording every change and reading the audit log | `AuditLog` | `/admin/audit-log` |

Shared, non-domain code lives outside `modules/`: `common/` (errors, validation helpers, tokens), `http/` (generic CRUD controller, health routes), `middleware/` (auth guards, rate limit, errors), `database/` (Prisma client and the `Db` type), `seeds/` and `cli/` (scripts).

---

## auth

Staff sign-in by hospital code, email, and password; 8-hour sessions (only the token hash is stored).

- **Public interface:** `StaffAuthService`, `AuthController`, `createAuthRoutes`, `revokeStaffSessions`, `revokeHospitalSessions`, `hashPassword`, `verifyPasswordOrDummy`, and the access helpers `StaffContext`, `scopesFor`, `canAccessLocation`, `bedScopeWhere`.
- **Files:** `auth.*` layers, `password.ts` (scrypt hashing, timing-safe checks), `staff-context.ts` (who is signed in and what they may do where).
- **Notes:** a failed sign-in takes the same time whether or not the hospital or email exists; sign-in is rate limited per account and per network address. `POST /auth/staff/password` changes one's own password (other sessions end). After a manager's reset (`resetStaffPassword`, used by the staff module) `mustChangePassword` is set and every route except who-am-I, change password, and sign out answers `PASSWORD_CHANGE_REQUIRED`.

## platform

The super admin (CARE QR / Healio team). Manages clients and their hospitals; never reads patients, requests, or staff records.

- **Public interface:** `PlatformAuthService`, `PlatformContext`, `PlatformService`, `PlatformAuthController`, `PlatformController`, `createPlatformRoutes`.
- **Uses:** `hospitals.bootstrapHospital` (create), `staff.createStaffAccount` + `roles.grantRole` (add a manager), `auth.revokeHospitalSessions` (suspend), `audit.recordPlatformAudit`.

## hospitals

- **Public interface:** `bootstrapHospital` (creates client or uses an existing one, the hospital, its first Hospital Manager, built-in roles, example departments and services), `hospitalIsOpen` / `hospitalAccessSelect` (a hospital is open only while it **and its client** are active), logo helpers (`storeLogo`, `removeLogo`, `logoUrl`, `detectLogoType`, `maxLogoBytes`), `HospitalService`, `HospitalController`, routes.
- **Files:** `hospital.*` layers, `onboarding.service.ts`, `hospital-access.ts`, `logo.ts`.

## roles

- **Public interface:** `PermissionKey`, `lockedRoleKey`, `createBuiltInRoles`, `ensurePermissionCatalog`, `grantRole`, `RoleService`, `RoleController`, routes.
- **Rules:** nobody may grant, change, or remove more power than they hold hospital-wide; the Hospital Manager role is locked; a hospital always keeps one active Hospital Manager.

## departments

The simplest module and the best template to copy. Standard list / get / create / update / delete through the shared `CrudController`.

- **Public interface:** `DepartmentService`, `DepartmentController`, `createDepartmentRoutes`, `createExampleDepartments`.

## staff

- **Public interface:** `StaffService`, `ShiftService`, their controllers, `createStaffRoutes`, `createStaffAccount`, `findEligibleStaff`.
- **Eligibility rule** (`eligibility.ts`): a person can receive a request only when their membership and account are active, they are on duty, they belong to the request's department, and their coverage includes the bed (hospital, floor, or ward).
- **Rules:** a staff manager can only change the status of, or reset the password of, someone whose permissions they hold; going inactive also ends their sessions and duty. A reset is refused for oneself and for an account also used at another hospital or on the platform.

## locations

- **Public interface:** `LocationService`, `LocationController` (one CRUD controller per level), `createLocationRoutes`, `areaFilters` (what a floor- or ward-level role may see), `occupyBed` / `releaseBed` (only bed sessions call these).
- **Rules:** an active location always has active parents; a bed with QR or session history can only be deactivated; bulk creation is all-or-nothing.

## bed-sessions

- **Public interface:** `BedSessionService`, `GuestSessionService`, `GuestContext`, `GuestLocation`, `bedTakesPatients`, their controllers and routes.
- **Rules:** starting a session moves the bed AVAILABLE → OCCUPIED in one conditional update (race-free); closing ends every guest session of that stay. With bed occupancy management off, nobody admits: a QR scan opens the bed's stay, and starts a fresh one once nobody is using the last.

## qr

- **Public interface:** `QrCodeService`, `QrController`, routes.
- **Rules:** scans use a one-way token hash; an AES-256-GCM encrypted copy lets an authorized hospital manager reopen the same active label. Viewing/printing is audited and does not change the code or guest sessions. Replacing or disabling ends the guest sessions opened with the old code; a scan locks the row so it cannot race a replacement.

## catalog

- **Public interface:** `CategoryService`, `ServiceItemService`, `CatalogController`, routes, `seedExampleCatalog`, `snapshotService` (what a request copies).
- **Rules:** patients see only active services whose category and department are active.

## sla

- **Public interface:** `SlaPolicyService`, `EscalationPolicyService`, `SlaController`, `createSlaRoutes`, `createSlaPolicy`, `findEscalationLevels` (for the SLA worker in requests).
- **Rules:** changing timings creates a new immutable version (a database trigger forbids edits); escalation levels must start later than the previous level.

## requests

- **Public interface:** `RequestService`, `RequestController`, `PatientRequestController`, routes, `requestAreaWhere`, `EscalationService`, `startEscalationWorker`.
- **Rules:** see the [state machine](./request-state-machine.md). Every command checks permission, area, version, and status; adds exactly one event; and audits assign, transfer, cancel, and reject.
- **Work queue:** `GET /admin/requests?view=open|completed|history&page=&pageSize=` returns one page and every list's count; open work comes overdue first, then oldest first. `GET /admin/requests/alerts` lists new, overdue, and escalated work for the signed-in person, with stable keys.
- **SLA worker** (`escalation.service.ts`): runs in the API process; for open requests past their current deadline it takes each escalation level once (a `RequestEscalation` row unique per request, deadline, and level), marks the request escalated, and audits `request.escalate`. A new deadline clears the flag.

## reports

- **Public interface:** `ReportService`, `ReportController`, `createReportRoutes`.
- **How it works:** loads the requests in the caller's report area for the period (at most 20,000) with their event history and rebuilds who assigned, accepted, completed, turned down, or handed over each one. A person's report uses the same figures plus their own actions; a floor, ward, or department manager can open only people who have worked on requests in their area.

## audit

- **Public interface:** `recordStaffAudit`, `recordPlatformAudit`, `recordSystemAudit` (always inside the transaction of the change), `AuditService` (the log in plain words: names instead of IDs and before → after changes, built in `audit-details.ts`), `AuditController`, `createAuditRoutes`.
