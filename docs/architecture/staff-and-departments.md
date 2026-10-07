# Departments, Staff, Coverage, and Duty

Status: Implemented in Phase 5  
Last reviewed: 2026-10-05

## Who can receive a request

A staff member is eligible for a request in department **D** at bed **B** only when all of these hold:

1. Their membership in the hospital is `ACTIVE` and their user account is `ACTIVE`.
2. They belong to **D**, and **D** is active.
3. Their coverage includes **B**: the whole hospital, **B**'s floor, or **B**'s ward.
4. They are `ON_DUTY`.

`findEligibleStaff` in `src/modules/staff/eligibility.ts` is the single implementation. Routing and assignment (later phases) must call it rather than re-implementing the rule. `GET /admin/staff/eligible?bedId=&departmentId=` and the **Who can respond?** page expose it for testing.

Roles and permissions are not part of eligibility. They decide what a person can do after sign-in (enforced when they accept or complete a request).

## Departments

- Per-hospital data with a code (unique per hospital), a name, and an active flag. No code path depends on a department's code.
- New hospitals get seven editable examples: Nursing, Housekeeping, Pantry, Maintenance, Patient Assistance, Billing, Transport. Hospitals created earlier add departments themselves.
- A department in use (staff or shifts) cannot be deleted; deactivate it instead. An inactive department makes nobody eligible.
- Managed with the `staff.read` / `staff.manage` permissions.

## Staff

- A staff member is a `HospitalMembership`; the `User` is the global identity (email, name, password).
- Creating staff creates a new user. An email that already exists is rejected; linking an existing user from another hospital needs a platform-level flow (deferred).
- A new member has no role. Without a role they can be eligible for requests but cannot sign in; assign a role to give them access.
- Setting status to `SUSPENDED` or `INACTIVE` also sets them `OFF_DUTY` and ends their signed-in sessions. Nobody can change their own status or remove their own roles.
- A role can be removed only by someone who holds every permission of that role (the same rule as assigning it).

## Coverage

Coverage (`StaffLocationScope`) is where someone works and receives requests. It is separate from the authorization scope on a role (`ScopeAssignment`), which later decides what a manager may see.

| Type | Covers |
|---|---|
| `HOSPITAL` | Every bed |
| `FLOOR` | Every bed on that floor |
| `WARD` | Every bed in that ward |

A member can have several coverage rows (for example two floors). Coverage references real floors and wards through tenant-composite foreign keys, so another hospital's location cannot be linked. A staff member without coverage receives no requests.

## Duty and shifts

- `dutyStatus` (`ON_DUTY` / `OFF_DUTY`) is the switch routing uses. New members start off duty. Changes are audited.
- Shifts are scheduled periods (up to 24 hours, never overlapping for one person, optionally tied to one of the person's departments). **In V1 a shift does not change duty status or eligibility.**

## API

| Method | Path | Permission |
|---|---|---|
| `GET` `POST` | `/admin/departments` | `staff.read` / `staff.manage` |
| `GET` `PATCH` `DELETE` | `/admin/departments/:id` | `staff.read` / `staff.manage` |
| `GET` | `/admin/staff?status=&dutyStatus=&departmentId=` | `staff.read` |
| `GET` | `/admin/staff/eligible?bedId=&departmentId=` | `staff.read` |
| `GET` | `/admin/staff/:id` | `staff.read` |
| `POST` | `/admin/staff` `{ email, displayName, password }` | `staff.manage` |
| `POST` | `/admin/staff/:id/status` `{ status }` | `staff.manage` |
| `POST` | `/admin/staff/:id/duty` `{ dutyStatus }` | `staff.manage` |
| `POST` `DELETE` | `/admin/staff/:id/departments[/:departmentId]` | `staff.manage` |
| `POST` `DELETE` | `/admin/staff/:id/coverage[/:coverageId]` | `staff.manage` |
| `DELETE` | `/admin/memberships/:id/roles/:roleId` | `staff.manage` + `role.manage` |
| `GET` `POST` | `/admin/shifts` | `staff.read` / `staff.manage` |
| `DELETE` | `/admin/shifts/:id` | `staff.manage` |

Every change is audited (`department.*`, `staff.create`, `staff.status`, `staff.duty`, `staff.department.*`, `staff.coverage.*`, `role.unassign`, `shift.*`) without passwords.

## Open questions

- Should a scheduled shift put someone on duty automatically at its start and off duty at its end?
- Should eligibility also require a permission such as `request.accept`?
- Staff currently cannot change their own duty status or password; both arrive with the staff workflow and security phases.
