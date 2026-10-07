# Backend modules

Every module lives in `services/src/modules/<name>/` and follows the [five layers](./README.md#3-backend-layers). Other modules may use only what its `index.ts` exports. Repositories are never exported: another module reaches a module's tables only through its services and helpers. "Writes" lists the tables a module changes; a module may read other tables for checks and display.

| Module | What it does | Writes | Main routes |
|---|---|---|---|
| [auth](#auth) | Staff sign-in, sessions, and the staff context used for every access check | `StaffSession` | `/auth/staff/*` |
| [platform](#platform) | Super admin: sign-in, clients, hospitals, managers | `Client`, `Hospital` (status, client), `PlatformSession` | `/auth/platform/*`, `/platform/*` |
| [hospitals](#hospitals) | Hospital onboarding, profile, logo, "is this hospital open" | `Client`, `Hospital`, `HospitalLogo` | `/admin/hospital*`, `/public/logos/:id` |
| [roles](#roles) | Permissions, built-in and custom roles, who holds which role where | `Permission`, `Role`, `RolePermission`, `UserRole`, `ScopeAssignment` | `/admin/roles*`, `/admin/memberships/:id/roles*` |
| [departments](#departments) | Teams such as Nursing or Pantry | `Department` | `/admin/departments*` |
| [staff](#staff) | Staff accounts, status, duty, departments, coverage, shifts, eligibility | `User`, `HospitalMembership`, `StaffDepartment`, `StaffLocationScope`, `Shift` | `/admin/staff*`, `/admin/shifts*` |
| [locations](#locations) | Building → Floor → Ward → Room → Bed, bulk beds, bed occupancy | `Building`, `Floor`, `Ward`, `Room`, `Bed` | `/admin/buildings` … `/admin/beds`, `/admin/wards/:id/bulk-beds` |
| [bed-sessions](#bed-sessions) | Admitting and discharging (bed sessions) and patient guest sessions | `BedSession`, `GuestSession` | `/admin/bed-sessions*`, `/public/session` |
| [qr](#qr) | Bed QR codes (issue, replace, disable, print in bulk) and scanning | `BedQrCode` | `/admin/qr-codes*`, `/admin/beds/:id/qr*`, `/public/qr/resolve` |
| [catalog](#catalog) | Service categories and services; the request snapshot | `ServiceCategory`, `ServiceItem` | `/admin/service-categories*`, `/admin/services*`, `/public/services` |
| [sla](#sla) | Response-time targets (versioned) and escalation policies | `SlaPolicy`, `SlaPolicyVersion`, `EscalationPolicy`, `EscalationLevel` | `/admin/sla-policies*`, `/admin/escalation-policies*` |
| [requests](#requests) | The patient request lifecycle and its event history | `ServiceRequest`, `RequestEvent` | `/admin/requests*`, `/public/requests*` |
| [reports](#reports) | Request reports: totals, staff work, why not completed, history | — (read only) | `/admin/reports/requests*` |
| [audit](#audit) | Recording every change and reading the audit log | `AuditLog` | `/admin/audit-log` |

Shared, non-domain code lives outside `modules/`: `common/` (errors, validation helpers, tokens), `http/` (generic CRUD controller, health routes), `middleware/` (auth guards, rate limit, errors), `database/` (Prisma client and the `Db` type), `seeds/` and `cli/` (scripts).

---

## auth

Staff sign-in by hospital code, email, and password; 8-hour sessions (only the token hash is stored).

- **Public interface:** `StaffAuthService`, `AuthController`, `createAuthRoutes`, `revokeStaffSessions`, `revokeHospitalSessions`, `hashPassword`, `verifyPasswordOrDummy`, and the access helpers `StaffContext`, `scopesFor`, `canAccessLocation`, `bedScopeWhere`.
- **Files:** `auth.*` layers, `password.ts` (scrypt hashing, timing-safe checks), `staff-context.ts` (who is signed in and what they may do where).
- **Notes:** a failed sign-in takes the same time whether or not the hospital or email exists; sign-in is rate limited per account and per network address.

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
- **Rules:** a staff manager can only change the status of someone with less access; going inactive also ends their sessions and duty.

## locations

- **Public interface:** `LocationService`, `LocationController` (one CRUD controller per level), `createLocationRoutes`, `areaFilters` (what a floor- or ward-level role may see), `occupyBed` / `releaseBed` (only bed sessions call these).
- **Rules:** an active location always has active parents; a bed with QR or session history can only be deactivated; bulk creation is all-or-nothing.

## bed-sessions

- **Public interface:** `BedSessionService`, `GuestSessionService`, `GuestContext`, `GuestLocation`, their controllers and routes.
- **Rules:** starting a session moves the bed AVAILABLE → OCCUPIED in one conditional update (race-free); closing ends every guest session of that stay.

## qr

- **Public interface:** `QrCodeService`, `QrController`, routes.
- **Rules:** the raw token is returned once and never stored; replacing or disabling a code ends the guest sessions opened with it; a scan locks the code row so it cannot race a replacement.

## catalog

- **Public interface:** `CategoryService`, `ServiceItemService`, `CatalogController`, routes, `seedExampleCatalog`, `snapshotService` (what a request copies).
- **Rules:** patients see only active services whose category and department are active.

## sla

- **Public interface:** `SlaPolicyService`, `EscalationPolicyService`, `SlaController`, `createSlaRoutes`, `createSlaPolicy`.
- **Rules:** changing timings creates a new immutable version (a database trigger forbids edits); escalation levels must start later than the previous level.

## requests

- **Public interface:** `RequestService`, `RequestController`, `PatientRequestController`, routes, `requestAreaWhere`.
- **Rules:** see the [state machine](./request-state-machine.md). Every command checks permission, area, version, and status; adds exactly one event; and audits assign, transfer, cancel, and reject.

## reports

- **Public interface:** `ReportService`, `ReportController`, `createReportRoutes`.
- **How it works:** loads the requests in the caller's report area for the period (at most 20,000) with their event history and rebuilds who assigned, accepted, completed, turned down, or handed over each one.

## audit

- **Public interface:** `recordStaffAudit`, `recordPlatformAudit`, `recordSystemAudit` (always inside the transaction of the change), `AuditService` (the log in plain words), `AuditController`, `createAuditRoutes`.
