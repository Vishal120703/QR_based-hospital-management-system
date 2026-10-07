# Data flow

How data moves through CARE QR: first as data flow diagrams (DFD), then step by step for each main flow, then the life of a request.

Notation in the DFDs: rectangles are people outside the system, rounded boxes are processes, cylinders are data stores. Arrow labels are the data that moves.

## 1. Context diagram (DFD level 0)

```mermaid
flowchart LR
  patient["Patient / attendant"]
  staff["Hospital staff"]
  super["Super admin"]
  system(("CARE QR"))
  patient -- "QR token, service choice,<br/>cancel reason" --> system
  system -- "bed and hospital name, services,<br/>request status" --> patient
  staff -- "sign-in, hospital setup,<br/>admissions, request actions" --> system
  system -- "work lists, deadlines,<br/>reports, audit log, QR labels" --> staff
  super -- "sign-in, clients, hospitals,<br/>managers, suspend/reactivate" --> system
  system -- "client and hospital lists<br/>with counts only" --> super
```

## 2. Level 1 data flow diagram

```mermaid
flowchart TB
  patient["Patient"]
  staff["Hospital staff"]
  super["Super admin"]

  p1("1. Sign in and<br/>check access")
  p2("2. Set up the hospital<br/>layout · staff · roles · services")
  p3("3. Admit patients<br/>and issue QR codes")
  p4("4. Patient requests<br/>scan · send · track · cancel")
  p5("5. Handle requests<br/>assign → accept → start →<br/>complete → close")
  p6("6. Reports and<br/>audit log")
  p7("7. Manage clients<br/>and hospitals")

  d1[("D1 Accounts and sessions<br/>User · HospitalMembership ·<br/>StaffSession · PlatformSession")]
  d2[("D2 Hospital setup<br/>Client · Hospital · locations ·<br/>departments · roles · catalog · SLA")]
  d3[("D3 Stays and QR<br/>BedSession · BedQrCode ·<br/>GuestSession")]
  d4[("D4 Requests<br/>ServiceRequest · RequestEvent")]
  d5[("D5 Audit log<br/>AuditLog")]

  staff -- credentials --> p1
  super -- credentials --> p1
  p1 <--> d1
  p1 -- "staff context<br/>(permissions per place)" --> p2 & p3 & p5 & p6
  p1 -- "platform context" --> p7

  staff -- "layout, people,<br/>roles, services" --> p2
  p2 <--> d2
  p2 -- changes --> d5

  staff -- "admit / discharge,<br/>issue / replace QR" --> p3
  p3 <--> d3
  p3 -- "QR label (token once)" --> staff
  p3 -- changes --> d5

  patient -- "QR token" --> p4
  p4 -- "guest session" --> d3
  d2 -- "active services,<br/>SLA version" --> p4
  patient -- "service, cancel reason" --> p4
  p4 <--> d4
  p4 -- "status, history" --> patient

  staff -- "assign, accept, start,<br/>complete, close, cancel,<br/>turn down, hand over" --> p5
  d1 -- "who is eligible<br/>(duty, team, coverage)" --> p5
  p5 <--> d4
  p5 -- "assign · transfer ·<br/>cancel · reject" --> d5

  d4 -- "requests + events" --> p6
  d5 -- entries --> p6
  p6 -- "totals, staff work,<br/>reasons, CSV" --> staff

  super -- "clients, hospitals,<br/>managers, status" --> p7
  p7 <--> d2
  p7 -- "new manager" --> d1
  p7 -- "end sessions on suspend" --> d1
  p7 -- changes --> d5
```

## 3. Every authenticated staff call

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser (staff)
  participant M as Middleware
  participant R as routes
  participant C as controller
  participant S as service
  participant Rep as repository
  participant DB as PostgreSQL
  B->>M: GET /api/admin/requests<br/>Authorization: Bearer <token>
  M->>DB: find StaffSession by SHA-256(token)<br/>+ hospital, client, roles, scopes
  alt session missing, expired, revoked,<br/>hospital or client suspended, person inactive
    M-->>B: 401 UNAUTHORIZED
  end
  M->>M: build StaffContext<br/>(permissions per place)
  M->>R: request.staff = context
  R->>R: permission guard (e.g. request.read)
  alt permission not held
    R-->>B: 403 FORBIDDEN
  end
  R->>C: handler
  C->>C: validate query/body (Zod)
  C->>S: list(context)
  S->>S: visibleRequestsWhere(context)<br/>(own area or own work)
  S->>Rep: listWithBed(db, where, …)
  Rep->>DB: SELECT … WHERE hospitalId = context hospital
  DB-->>Rep: rows
  Rep-->>S: rows
  S-->>C: view objects
  C-->>B: 200 { serviceRequests: [...] }
```

The hospital always comes from the session, never from the URL or body.

## 4. Admit a patient and print a QR label

```mermaid
sequenceDiagram
  autonumber
  actor M as Manager / Admission desk
  participant API
  participant DB as PostgreSQL
  M->>API: POST /admin/bed-sessions { bedId }
  API->>DB: check bed is in the caller's area
  API->>DB: UPDATE Bed SET status=OCCUPIED<br/>WHERE status=AVAILABLE AND active (race-free)
  API->>DB: INSERT BedSession (ACTIVE) + AuditLog bedSession.start
  API-->>M: 201 bedSession
  M->>API: POST /admin/beds/:id/qr (or /qr-codes/batch)
  API->>API: token = 256 random bits
  API->>DB: INSERT BedQrCode (tokenHash only) + AuditLog qr.generate
  API-->>M: 201 { token, url } (no-store; shown once)
  M->>M: print label PDF (QR = url)
```

Replacing a QR (`/qr/rotate`) stores a new hash and ends every guest session opened with the old one. Closing the bed session ends the stay's guest sessions and sets the bed back to AVAILABLE.

## 5. Patient scans the QR

```mermaid
sequenceDiagram
  autonumber
  actor P as Patient phone
  participant W as Web app
  participant API
  participant DB as PostgreSQL
  P->>W: open https://…/q/<token>
  W->>API: POST /public/qr/resolve { token } (token in body, not URL)
  API->>DB: SELECT BedQrCode WHERE tokenHash AND ACTIVE FOR UPDATE
  API->>DB: hospital and client open? bed active?
  API->>DB: active BedSession for the bed?
  alt any check fails
    API-->>W: 404 QR_UNAVAILABLE (one message for every reason)
  end
  API->>DB: INSERT GuestSession (hash, expires in 120 min)
  API-->>W: 201 { guestToken, expiresAt, location }
  W->>W: keep guest token in this tab only (sessionStorage),<br/>remove token from the address bar
  W->>API: GET /public/services (guest token)
  API-->>W: active categories and services
```

## 6. Patient sends a request

```mermaid
sequenceDiagram
  autonumber
  actor P as Patient
  participant API
  participant DB as PostgreSQL
  P->>API: POST /public/requests { serviceId } (guest token)
  API->>DB: same stay already has this service open?
  alt yes
    API-->>P: 200 existing request (no duplicate)
  end
  API->>DB: BEGIN
  API->>DB: lock BedSession and GuestSession FOR SHARE<br/>(still active, not revoked, not expired)
  API->>DB: snapshot service: name, category, department,<br/>priority, SLA version → acceptDueAt, completeDueAt
  API->>DB: INSERT ServiceRequest (SUBMITTED, version 1)
  API->>DB: INSERT RequestEvent SUBMITTED (actor GUEST)
  API->>DB: COMMIT
  API-->>P: 201 { publicId: CR-…, status }
  loop every 30 seconds while the page is visible
    P->>API: GET /public/requests
    API-->>P: statuses and step times
  end
```

A unique partial index on (bed session, service) for open requests stops two simultaneous submissions from creating duplicates.

## 7. Staff handle the request

```mermaid
sequenceDiagram
  autonumber
  actor Mgr as Manager
  actor Staff as Care staff
  participant API
  participant DB as PostgreSQL
  Mgr->>API: GET /admin/staff/eligible?bedId&departmentId
  API-->>Mgr: active, on duty, in the department, covering the bed
  Mgr->>API: POST /admin/requests/:id/assign<br/>{ expectedVersion: 1, assigneeId }
  API->>DB: area check · version and status check · eligibility
  API->>DB: UPDATE … WHERE version=1 AND status=SUBMITTED (→ ASSIGNED, v2)
  API->>DB: INSERT RequestEvent ASSIGNED + AuditLog request.assign
  Staff->>API: POST /accept { expectedVersion: 2 } (must be the assignee)
  Staff->>API: POST /start { expectedVersion: 3 }
  Staff->>API: POST /complete { expectedVersion: 4 }
  Mgr->>API: POST /close { expectedVersion: 5 }
  Note over API,DB: each step: one guarded UPDATE + one RequestEvent.<br/>A stale version or wrong status returns 409.
```

Other paths, each with a required reason that is stored in the event (and the audit log):

- **Turn down** (`/reject`, assignee, from ASSIGNED): the request ends as REJECTED; the patient can send it again.
- **Cancel** (`/cancel`, manager, from SUBMITTED or ASSIGNED; or the patient from their page).
- **Hand over** (`/transfer`, manager, from ACCEPTED or IN_PROGRESS): back to ASSIGNED for another eligible person.

## 8. Request statuses

```mermaid
stateDiagram-v2
  [*] --> SUBMITTED: patient sends
  SUBMITTED --> ASSIGNED: assign (manager)
  SUBMITTED --> CANCELLED: cancel (manager or patient)
  ASSIGNED --> ACCEPTED: accept (assignee)
  ASSIGNED --> REJECTED: turn down (assignee, reason)
  ASSIGNED --> CANCELLED: cancel (manager or patient)
  ACCEPTED --> IN_PROGRESS: start (assignee)
  ACCEPTED --> ASSIGNED: hand over (manager, reason)
  IN_PROGRESS --> COMPLETED: complete (assignee)
  IN_PROGRESS --> ASSIGNED: hand over (manager, reason)
  COMPLETED --> CLOSED: close (manager)
  CLOSED --> [*]
  CANCELLED --> [*]
  REJECTED --> [*]
```

Deadlines: "accept by" = sent + SLA accept minutes; "complete by" = sent + SLA complete minutes. A request is overdue when the current deadline has passed. Full rules: [request state machine](./request-state-machine.md).

## 9. Reports

```mermaid
sequenceDiagram
  autonumber
  actor Mgr as Manager
  participant API
  participant DB as PostgreSQL
  Mgr->>API: GET /admin/reports/requests?from&to
  API->>API: report area from analytics.read scopes<br/>(hospital, floors, wards, or departments)
  API->>DB: requests sent in the period in that area<br/>+ location + all RequestEvents (≤ 20,000)
  API->>DB: names of everyone mentioned
  API->>API: per request: outcome, who assigned / accepted /<br/>completed / ended it, on time?, reason
  API->>API: totals · per department · per service ·<br/>per person · not completed
  API-->>Mgr: report JSON (CSV is built in the browser)
```

Because reports are rebuilt from the append-only event history, they stay correct after hand-overs and cannot be altered after the fact.

## 10. Super admin suspends a client

```mermaid
sequenceDiagram
  autonumber
  actor SA as Super admin
  participant API
  participant DB as PostgreSQL
  SA->>API: PATCH /platform/clients/:id { status: SUSPENDED }
  API->>DB: BEGIN (serializable)
  API->>DB: UPDATE Client SET status=SUSPENDED
  API->>DB: revoke every StaffSession of the client's hospitals
  API->>DB: AuditLog platform.client.update in each hospital
  API->>DB: COMMIT
  Note over API,DB: From now on every staff sign-in, staff call,<br/>QR scan, and patient request checks<br/>hospitalIsOpen(): hospital ACTIVE and client ACTIVE.
```

Reactivating the client restores exactly the previous state: a hospital that was suspended on its own stays suspended.
