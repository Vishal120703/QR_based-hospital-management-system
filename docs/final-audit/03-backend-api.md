# Backend API inventory — stages 2–3

Audit date: 2026-10-09. Current working tree, not HEAD alone. 126 distinct method/path endpoints. Paths below are backend paths; the development frontend adds `/api` via its proxy.

`HW` = permission held hospital-wide. `TENANT` = hospital from the staff session and tenant-qualified target/foreign references. `AREA` = floor, ward, or department linked to the particular permission. `OWN` = ordinary staff can read only assigned requests. `GS` = hospital, bed, and stay from an authenticated GuestSession. `PLATFORM` = active platform operator; all client/hospital administration is intentionally global. Public health, login, QR exchange, and raster-logo routes are intentional public entrypoints.

Authentication is mounted centrally in `services/src/routes/index.ts`: `/admin` requires staff auth once; `/platform` uses its own router-level platform guard; guest guards are explicit on each patient route. The production server does not supply `configureRoutes`, so that test hook does not add hidden production routes. All credential types resolve against separate session tables.

Inventory sources: every `services/src/modules/*/*.routes.ts`, `services/src/http/crud.ts` (five-method expansion), `services/src/http/health.routes.ts`, `requestCommands` in request.schemas.ts, and the composition root. Controller/service call paths and relevant tenant/area filters were inspected. No currently mounted protected route missing its intended auth domain or route permission was confirmed. A report service target-scope defect is confirmed as AUD-001; an auth guard alone does not fix that.

| Method | Path | Auth | Permission | Scope | Controller | Service |
|---|---|---|---|---|---|---|
| GET | `/` | PUBLIC | — | PUBLIC | inline health router | readiness probes |
| GET | `/health` | PUBLIC | — | PUBLIC | inline health router | readiness probes |
| GET | `/ready` | PUBLIC | — | PUBLIC | inline health router | readiness probes |
| POST | `/auth/staff/login` | PUBLIC | — | credential resolution | AuthController.login | StaffAuthService |
| GET | `/auth/staff/me` | STAFF | — | trusted staff session | AuthController.me | StaffAuthService |
| POST | `/auth/staff/logout` | STAFF | — | trusted staff session | AuthController.logout | StaffAuthService |
| POST | `/auth/platform/login` | PUBLIC | — | credential resolution | PlatformAuthController.login | PlatformAuthService |
| GET | `/auth/platform/me` | PLATFORM | — | platform operator | PlatformAuthController.me | PlatformAuthService |
| POST | `/auth/platform/logout` | PLATFORM | — | platform operator | PlatformAuthController.logout | PlatformAuthService |
| GET | `/platform/clients` | PLATFORM | platform operator | PLATFORM | PlatformController.listClients | PlatformService |
| GET | `/platform/clients/:id` | PLATFORM | platform operator | PLATFORM | PlatformController.getClient | PlatformService |
| PATCH | `/platform/clients/:id` | PLATFORM | platform operator | PLATFORM | PlatformController.updateClient | PlatformService |
| GET | `/platform/hospitals` | PLATFORM | platform operator | PLATFORM | PlatformController.listHospitals | PlatformService |
| POST | `/platform/hospitals` | PLATFORM | platform operator | PLATFORM | PlatformController.createHospital | PlatformService |
| GET | `/platform/hospitals/:id` | PLATFORM | platform operator | PLATFORM | PlatformController.getHospital | PlatformService |
| PATCH | `/platform/hospitals/:id` | PLATFORM | platform operator | PLATFORM | PlatformController.updateHospital | PlatformService |
| PUT | `/platform/hospitals/:id/logo` | PLATFORM | platform operator | PLATFORM | PlatformController.setLogo | PlatformService |
| DELETE | `/platform/hospitals/:id/logo` | PLATFORM | platform operator | PLATFORM | PlatformController.removeLogo | PlatformService |
| POST | `/platform/hospitals/:id/managers` | PLATFORM | platform operator | PLATFORM | PlatformController.addManager | PlatformService |
| GET | `/admin/buildings` | STAFF | location.read (any scope) | AREA + TENANT | LocationController.buildings.list | LocationService |
| GET | `/admin/buildings/:id` | STAFF | location.read (any scope) | AREA + TENANT | LocationController.buildings.get | LocationService |
| POST | `/admin/buildings` | STAFF | location.manage (HW) | HW + TENANT | LocationController.buildings.create | LocationService |
| PATCH | `/admin/buildings/:id` | STAFF | location.manage (HW) | HW + TENANT | LocationController.buildings.update | LocationService |
| DELETE | `/admin/buildings/:id` | STAFF | location.manage (HW) | HW + TENANT | LocationController.buildings.remove | LocationService |
| GET | `/admin/floors` | STAFF | location.read (any scope) | AREA + TENANT | LocationController.floors.list | LocationService |
| GET | `/admin/floors/:id` | STAFF | location.read (any scope) | AREA + TENANT | LocationController.floors.get | LocationService |
| POST | `/admin/floors` | STAFF | location.manage (HW) | HW + TENANT | LocationController.floors.create | LocationService |
| PATCH | `/admin/floors/:id` | STAFF | location.manage (HW) | HW + TENANT | LocationController.floors.update | LocationService |
| DELETE | `/admin/floors/:id` | STAFF | location.manage (HW) | HW + TENANT | LocationController.floors.remove | LocationService |
| GET | `/admin/wards` | STAFF | location.read (any scope) | AREA + TENANT | LocationController.wards.list | LocationService |
| GET | `/admin/wards/:id` | STAFF | location.read (any scope) | AREA + TENANT | LocationController.wards.get | LocationService |
| POST | `/admin/wards` | STAFF | location.manage (HW) | HW + TENANT | LocationController.wards.create | LocationService |
| PATCH | `/admin/wards/:id` | STAFF | location.manage (HW) | HW + TENANT | LocationController.wards.update | LocationService |
| DELETE | `/admin/wards/:id` | STAFF | location.manage (HW) | HW + TENANT | LocationController.wards.remove | LocationService |
| GET | `/admin/rooms` | STAFF | location.read (any scope) | AREA + TENANT | LocationController.rooms.list | LocationService |
| GET | `/admin/rooms/:id` | STAFF | location.read (any scope) | AREA + TENANT | LocationController.rooms.get | LocationService |
| POST | `/admin/rooms` | STAFF | location.manage (HW) | HW + TENANT | LocationController.rooms.create | LocationService |
| PATCH | `/admin/rooms/:id` | STAFF | location.manage (HW) | HW + TENANT | LocationController.rooms.update | LocationService |
| DELETE | `/admin/rooms/:id` | STAFF | location.manage (HW) | HW + TENANT | LocationController.rooms.remove | LocationService |
| GET | `/admin/beds` | STAFF | bed.read (any scope) | AREA + TENANT | LocationController.beds.list | LocationService |
| GET | `/admin/beds/:id` | STAFF | bed.read (any scope) | AREA + TENANT | LocationController.beds.get | LocationService |
| POST | `/admin/beds` | STAFF | bed.manage (HW) | HW + TENANT | LocationController.beds.create | LocationService |
| PATCH | `/admin/beds/:id` | STAFF | bed.manage (HW) | HW + TENANT | LocationController.beds.update | LocationService |
| DELETE | `/admin/beds/:id` | STAFF | bed.manage (HW) | HW + TENANT | LocationController.beds.remove | LocationService |
| GET | `/admin/departments` | STAFF | staff.read (HW) | HW + TENANT | DepartmentController.list | DepartmentService |
| GET | `/admin/departments/:id` | STAFF | staff.read (HW) | HW + TENANT | DepartmentController.get | DepartmentService |
| POST | `/admin/departments` | STAFF | staff.manage (HW) | HW + TENANT | DepartmentController.create | DepartmentService |
| PATCH | `/admin/departments/:id` | STAFF | staff.manage (HW) | HW + TENANT | DepartmentController.update | DepartmentService |
| DELETE | `/admin/departments/:id` | STAFF | staff.manage (HW) | HW + TENANT | DepartmentController.remove | DepartmentService |
| GET | `/admin/service-categories` | STAFF | service.read (HW) | HW + TENANT | CatalogController.categories.list | CategoryService |
| GET | `/admin/service-categories/:id` | STAFF | service.read (HW) | HW + TENANT | CatalogController.categories.get | CategoryService |
| POST | `/admin/service-categories` | STAFF | service.manage (HW) | HW + TENANT | CatalogController.categories.create | CategoryService |
| PATCH | `/admin/service-categories/:id` | STAFF | service.manage (HW) | HW + TENANT | CatalogController.categories.update | CategoryService |
| DELETE | `/admin/service-categories/:id` | STAFF | service.manage (HW) | HW + TENANT | CatalogController.categories.remove | CategoryService |
| GET | `/admin/services` | STAFF | service.read (HW) | HW + TENANT | CatalogController.services.list | ServiceItemService |
| GET | `/admin/services/:id` | STAFF | service.read (HW) | HW + TENANT | CatalogController.services.get | ServiceItemService |
| POST | `/admin/services` | STAFF | service.manage (HW) | HW + TENANT | CatalogController.services.create | ServiceItemService |
| PATCH | `/admin/services/:id` | STAFF | service.manage (HW) | HW + TENANT | CatalogController.services.update | ServiceItemService |
| DELETE | `/admin/services/:id` | STAFF | service.manage (HW) | HW + TENANT | CatalogController.services.remove | ServiceItemService |
| GET | `/admin/sla-policies` | STAFF | service.read (HW) | HW + TENANT | SlaController.policies.list | SlaPolicyService |
| GET | `/admin/sla-policies/:id` | STAFF | service.read (HW) | HW + TENANT | SlaController.policies.get | SlaPolicyService |
| POST | `/admin/sla-policies` | STAFF | sla.manage (HW) | HW + TENANT | SlaController.policies.create | SlaPolicyService |
| PATCH | `/admin/sla-policies/:id` | STAFF | sla.manage (HW) | HW + TENANT | SlaController.policies.update | SlaPolicyService |
| DELETE | `/admin/sla-policies/:id` | STAFF | sla.manage (HW) | HW + TENANT | SlaController.policies.remove | SlaPolicyService |
| GET | `/admin/escalation-policies` | STAFF | service.read (HW) | HW + TENANT | SlaController.escalations.list | EscalationPolicyService |
| GET | `/admin/escalation-policies/:id` | STAFF | service.read (HW) | HW + TENANT | SlaController.escalations.get | EscalationPolicyService |
| POST | `/admin/escalation-policies` | STAFF | sla.manage (HW) | HW + TENANT | SlaController.escalations.create | EscalationPolicyService |
| PATCH | `/admin/escalation-policies/:id` | STAFF | sla.manage (HW) | HW + TENANT | SlaController.escalations.update | EscalationPolicyService |
| DELETE | `/admin/escalation-policies/:id` | STAFF | sla.manage (HW) | HW + TENANT | SlaController.escalations.remove | EscalationPolicyService |
| POST | `/admin/wards/:id/bulk-beds` | STAFF | bed.manage (HW); location.manage when creating rooms | HW + TENANT | LocationController.bulkBeds | LocationService |
| GET | `/admin/hospital` | STAFF | hospital.read (HW) | session hospital | HospitalController.get | HospitalService |
| PATCH | `/admin/hospital` | STAFF | hospital.manage (HW) | session hospital | HospitalController.update | HospitalService |
| PUT | `/admin/hospital/logo` | STAFF | hospital.manage (HW) | session hospital | HospitalController.setLogo | HospitalService |
| DELETE | `/admin/hospital/logo` | STAFF | hospital.manage (HW) | session hospital | HospitalController.removeLogo | HospitalService |
| GET | `/public/logos/:publicId` | PUBLIC | — | opaque public branding ID | HospitalController.publicLogo | HospitalService |
| GET | `/admin/roles` | STAFF | role.read (HW) | HW + TENANT; grant hierarchy on writes | RoleController.list | RoleService |
| GET | `/admin/roles/:id` | STAFF | role.read (HW) | HW + TENANT; grant hierarchy on writes | RoleController.get | RoleService |
| POST | `/admin/roles` | STAFF | role.manage (HW) | HW + TENANT; grant hierarchy on writes | RoleController.create | RoleService |
| PATCH | `/admin/roles/:id` | STAFF | role.manage (HW) | HW + TENANT; grant hierarchy on writes | RoleController.update | RoleService |
| DELETE | `/admin/roles/:id` | STAFF | role.manage (HW) | HW + TENANT; grant hierarchy on writes | RoleController.remove | RoleService |
| POST | `/admin/memberships/:id/roles` | STAFF | staff.manage + role.manage (HW) | TENANT + scope validation + privilege ceiling | RoleController.assign | RoleService |
| DELETE | `/admin/memberships/:id/roles/:roleId` | STAFF | staff.manage + role.manage (HW) | TENANT + scope validation + privilege ceiling | RoleController.unassign | RoleService |
| DELETE | `/admin/memberships/:id/roles/:roleId/scopes/:scopeId` | STAFF | staff.manage + role.manage (HW) | TENANT + scope validation + privilege ceiling | RoleController.unassign | RoleService |
| GET | `/admin/staff` | STAFF | staff.read (HW) | HW + TENANT; hierarchy for privileged mutations | StaffController.list | StaffService |
| GET | `/admin/staff/:id` | STAFF | staff.read (HW) | HW + TENANT; hierarchy for privileged mutations | StaffController.get | StaffService |
| POST | `/admin/staff` | STAFF | staff.manage (HW) | HW + TENANT; hierarchy for privileged mutations | StaffController.create | StaffService |
| POST | `/admin/staff/:id/status` | STAFF | staff.manage (HW) | HW + TENANT; hierarchy for privileged mutations | StaffController.setStatus | StaffService |
| POST | `/admin/staff/:id/duty` | STAFF | staff.manage (HW) | HW + TENANT; hierarchy for privileged mutations | StaffController.setDuty | StaffService |
| POST | `/admin/staff/:id/departments` | STAFF | staff.manage (HW) | HW + TENANT; hierarchy for privileged mutations | StaffController.addDepartment | StaffService |
| DELETE | `/admin/staff/:id/departments/:departmentId` | STAFF | staff.manage (HW) | HW + TENANT; hierarchy for privileged mutations | StaffController.removeDepartment | StaffService |
| POST | `/admin/staff/:id/coverage` | STAFF | staff.manage (HW) | HW + TENANT; hierarchy for privileged mutations | StaffController.addCoverage | StaffService |
| DELETE | `/admin/staff/:id/coverage/:coverageId` | STAFF | staff.manage (HW) | HW + TENANT; hierarchy for privileged mutations | StaffController.removeCoverage | StaffService |
| GET | `/admin/staff/eligible` | STAFF | staff.read (any scope) | AREA + department + eligibility | StaffController.eligible | StaffService |
| GET | `/admin/shifts` | STAFF | staff.read (HW) | HW + TENANT | ShiftController.list | ShiftService |
| POST | `/admin/shifts` | STAFF | staff.manage (HW) | HW + TENANT | ShiftController.create | ShiftService |
| DELETE | `/admin/shifts/:id` | STAFF | staff.manage (HW) | HW + TENANT | ShiftController.remove | ShiftService |
| GET | `/admin/bed-sessions` | STAFF | bed.read (any scope) | AREA + TENANT | BedSessionController.list | BedSessionService |
| POST | `/admin/bed-sessions` | STAFF | bedSession.manage (any scope) | AREA + TENANT | BedSessionController.start | BedSessionService |
| POST | `/admin/bed-sessions/:id/close` | STAFF | bedSession.manage (any scope) | AREA + TENANT | BedSessionController.close | BedSessionService |
| PUT | `/admin/bed-occupancy` | STAFF | hospital.manage (HW) | session hospital | BedSessionController.setOccupancy | BedSessionService |
| GET | `/public/session` | GUEST | — | GS | GuestSessionController.describe | GuestSessionService |
| GET | `/admin/qr-codes` | STAFF | bed.read (any scope) | AREA + TENANT | QrController.list | QrCodeService |
| POST | `/admin/qr-codes/batch` | STAFF | hospital.manage + qr.generate (+ qr.rotate when replacing) (HW) | HW + TENANT | QrController.generateBatch | QrCodeService |
| POST | `/admin/beds/:id/qr` | STAFF | hospital.manage + qr.generate (HW) | HW + TENANT | QrController.generate | QrCodeService |
| POST | `/admin/beds/:id/qr/print` | STAFF | hospital.manage + qr.generate (HW) | HW + TENANT | QrController.print | QrCodeService |
| POST | `/admin/beds/:id/qr/rotate` | STAFF | hospital.manage + qr.rotate (HW) | HW + TENANT | QrController.rotate | QrCodeService |
| POST | `/admin/beds/:id/qr/revoke` | STAFF | hospital.manage + qr.revoke (HW) | HW + TENANT | QrController.revoke | QrCodeService |
| POST | `/public/qr/resolve` | PUBLIC | — | valid active hashed QR + stay; rate limited | QrController.resolve | QrCodeService |
| GET | `/public/services` | GUEST | — | GS; active tenant catalog | CatalogController.patientCatalog | ServiceItemService |
| GET | `/admin/requests` | STAFF | request.read (any scope) | AREA + OWN + TENANT | RequestController.list | RequestService |
| GET | `/admin/requests/:id` | STAFF | request.read (any scope) | AREA + OWN + TENANT | RequestController.get | RequestService |
| GET | `/admin/requests/:id/events` | STAFF | request.read (any scope) | AREA + OWN + TENANT | RequestController.events | RequestService |
| POST | `/admin/requests/:id/assign` | STAFF | request.assign (any scope) | TENANT + command AREA | RequestController.command(assign) | RequestService.assign |
| POST | `/admin/requests/:id/accept` | STAFF | request.accept (any scope) | TENANT + command AREA + assignee | RequestController.command(accept) | RequestService.accept |
| POST | `/admin/requests/:id/start` | STAFF | request.start (any scope) | TENANT + command AREA + assignee | RequestController.command(start) | RequestService.start |
| POST | `/admin/requests/:id/complete` | STAFF | request.complete (any scope) | TENANT + command AREA + assignee | RequestController.command(complete) | RequestService.complete |
| POST | `/admin/requests/:id/close` | STAFF | request.close (any scope) | TENANT + command AREA | RequestController.command(close) | RequestService.close |
| POST | `/admin/requests/:id/cancel` | STAFF | request.cancel (any scope) | TENANT + command AREA | RequestController.command(cancel) | RequestService.cancel |
| POST | `/admin/requests/:id/reject` | STAFF | request.reject (any scope) | TENANT + command AREA + assignee | RequestController.command(reject) | RequestService.reject |
| POST | `/admin/requests/:id/transfer` | STAFF | request.transfer (any scope) | TENANT + command AREA | RequestController.command(transfer) | RequestService.transfer |
| GET | `/public/requests` | GUEST | — | GS | PatientRequestController.list | RequestService |
| POST | `/public/requests` | GUEST | — | GS | PatientRequestController.submit | RequestService |
| POST | `/public/requests/:publicId/cancel` | GUEST | — | GS | PatientRequestController.cancel | RequestService |
| GET | `/admin/reports/requests` | STAFF | analytics.read (any scope) | analytics AREA + TENANT | ReportController.summary | ReportService |
| GET | `/admin/reports/requests/log` | STAFF | analytics.read (any scope) | analytics AREA + TENANT | ReportController.log | ReportService |
| GET | `/admin/reports/requests/:id` | STAFF | analytics.read (any scope) | analytics AREA + TENANT, known request ID | ReportController.timeline | ReportService |
| GET | `/admin/reports/people/:id` | STAFF | analytics.read (any scope) | analytics AREA for work; identity fallback TENANT ONLY (AUD-001) | ReportController.person | ReportService |
| GET | `/admin/audit-log` | STAFF | audit.read (HW) | HW + TENANT | AuditController.list | AuditService |

## Runtime checks

Anonymous calls to representative staff/platform/guest endpoints returned 401. All six wrong-domain token combinations returned 401. The additional same-name fixture checks and existing integration tests exercise direct UUID access as well as filtered lists; see [authorization and tenancy](./04-auth-authorization-tenancy.md). Platform endpoints use operator authentication rather than hospital RBAC by design. Authenticated `/me` and logout need no extra business permission. Public logos expose branding only; no staff/guest token is accepted in exchange for a QR secret.

Stage 4 session lifecycle, Stage 9 security review and Stage 12 deployment/proxy behavior are deferred, not declared PASS by this inventory.

