# Service Catalog, SLA, and Escalation

Status: Implemented in Phase 6  
Last reviewed: 2026-10-05

## Catalog

```text
ServiceCategory  (patient-facing group, optional emergency notice)
└── ServiceItem  (department, priority, SLA policy, optional escalation policy)
```

- Patient buttons come only from this configuration; nothing is hardcoded.
- A service is shown to patients, and can be requested, only when the service, its category, and its department are all active. `GET /public/services` (guest session) returns active categories with their visible services, omitting department, SLA, and priority details.
- A category with `emergencyNotice` shows the "not for emergencies" warning beside its services. The patient page also always shows it at the bottom.
- Every service must have a department and an SLA policy, all within the same hospital (tenant-composite foreign keys).
- Priority is `NORMAL`, `HIGH`, or `URGENT`. `URGENT` is operational urgency, never a medical emergency.
- New hospitals get editable examples: Drinking Water (Pantry, Normal, Quick response), Nurse Assistance (Nursing, High, Quick response), Room Cleaning (Housekeeping, Normal, Standard), and Wheelchair (Transport, Normal, Standard). Categories are Food & Water, Nursing Help (with the emergency notice), Room & Cleaning, and Assistance.

## SLA policies

- `acceptMinutes` and `completeMinutes` both count from submission: `acceptDueAt = submittedAt + acceptMinutes`, `completeDueAt = submittedAt + completeMinutes`. Therefore `completeMinutes ≥ acceptMinutes`.
- Limits: accept 1–1440 minutes, complete 1–10080 minutes, whole numbers. The API and a database CHECK constraint both enforce them.
- Changing a timing creates a new **version**. Versions are immutable: a database trigger rejects any `UPDATE` of a `SlaPolicyVersion` row. Renaming a policy does not create a version.
- Concurrent edits cannot claim the same version: the update is guarded by the current version number, and versions are unique per policy.
- Examples: Quick response 3 / 10 minutes (from the V1 plan) and Standard 10 / 60 minutes (an editable placeholder).

## Request snapshot

`snapshotService(client, hospitalId, serviceItemId, submittedAt)` in `src/modules/catalog/service-snapshot.ts` freezes what a request needs at submission:

- service name, category name, priority, department
- SLA policy, the exact `SlaPolicyVersion` ID and number, its minutes, and the computed `acceptDueAt` / `completeDueAt`
- escalation policy ID

It returns `null` when the service cannot be requested. The request phase must call it inside the transaction that creates the request and store the result; later edits to the catalog or SLA never change an existing request.

## Escalation policies

- An ordered list of 1–10 levels. Each level fires `afterMinutes` (0–1440) after a missed deadline, strictly later than the previous level.
- A level targets either `ASSIGNEE` (re-alert the assigned staff member) or `ROLE` (notify holders of a named hospital role). No job title such as "Floor Manager" is hardcoded; hospitals point levels at their own roles.
- Editing replaces the whole level list. Escalation policies are configuration only until the SLA worker phase executes them.
- The same chain applies to missed accept and completion deadlines.

## Deletion

Configuration in use cannot be deleted (`409`): a category with services, an SLA or escalation policy used by a service, a department used by a service, or a role used by an escalation level. Deactivate instead. Requests (a later phase) will reference services and SLA versions through `RESTRICT` foreign keys.

## API

| Resource | Read | Change |
|---|---|---|
| `/admin/service-categories` | `service.read` | `service.manage` |
| `/admin/services` (`?categoryId=&departmentId=&active=`) | `service.read` | `service.manage` |
| `/admin/sla-policies` | `service.read` | `sla.manage` |
| `/admin/escalation-policies` | `service.read` | `sla.manage` |
| `GET /public/services` | guest session | — |

Each admin resource supports list, get, create, update, and delete. Every change is audited (`serviceCategory.*`, `service.*`, `sla.*` with before/after version and minutes, `escalation.*`).

## Open questions

- Translations of service and category names for the language selection step (patient flow phase).
- Whether a version of the escalation chain should also be frozen per request. V1 freezes only SLA timings, as the plan specifies; escalation levels are read when escalation runs.
