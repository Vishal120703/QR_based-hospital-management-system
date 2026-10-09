# CARE QR — Easy Guide

A plain-language explanation of what this project is, how it works, and how to try it yourself.

---

## 1. What is CARE QR? (in one minute)

Imagine a patient lying in a hospital bed who needs **drinking water**, a **nurse**, or **room cleaning**. Normally they press a bell or wait for someone to pass by.

With CARE QR:

1. Every bed has a **QR code** stuck on it.
2. The patient (or their family) **scans it with their phone**. No app, no login.
3. A web page opens showing buttons like **Drinking Water**, **Nurse Assistance**, **Room Cleaning**.
4. They tap a button → a **request** is saved and shown in their request history.
5. A floor manager assigns the request to an eligible staff member (for example the Pantry team for water). That staff member accepts, starts, and marks the work complete; the patient sees the updated status.

The current version provides a testable foundation for tracking requests and response-time targets. It must not be relied on to summon staff in a real hospital yet.

> ⚠️ CARE QR is **not for emergencies**. The app always tells patients to use the nurse-call button in an emergency.

---

## 2. Who uses it?

CARE QR is a SaaS platform: one CARE QR team serves many client hospitals, and each hospital's data is completely separate.

| Person | What they do | Where they sign in |
|---|---|---|
| **Super admin** (the CARE QR team) | Manages **clients** (the customers who buy CARE QR, such as a hospital group) and their **hospitals**: adds a client with its first hospital, adds more hospitals (branches) to a client, edits client contacts, moves a hospital to another client, and suspends or reactivates a whole client or one hospital. Never sees patients, requests, or staff records inside a hospital. | `/platform/login` (email + password) |
| **Hospital Manager** | Runs one hospital: layout, beds, QR labels, staff, departments, services, **Roles & access**, **Reports**, and the **Audit log** | Staff sign-in (hospital code + email + password) |
| **Floor Manager** / **Ward Manager** | Admit and discharge patients, assign requests, and see **Reports**, only for their own floor or ward | Staff sign-in |
| **Department Supervisor** | Assigns and closes one department's requests (for example Pantry) across the hospital, and sees that department's **Reports** | Staff sign-in |
| **Care Staff** (nurse, pantry, housekeeping…) | Accept, start, and complete the requests assigned to them | Staff sign-in |
| **Patient / family** | Scan the QR, request help, track it | Phone browser, no login |

Every hospital starts with these five built-in roles. A Hospital Manager can add departments and create **their own roles** in **People → Roles & access**: tick what the role may do, and choose whether it applies to the whole hospital, one floor, one ward, or one department. Then, in **Staff & coverage → Manage**, they give the role to a person *for a specific place* (for example "Floor Manager · First Floor"). The Hospital Manager role itself always has every permission and cannot be edited, and a hospital can never lose its last active Hospital Manager. Nobody can change a role, or suspend a colleague, that has more power than they do themselves.

### Reports and audit (who did what, and why not)

- **Work → Reports** (managers): pick a period (today, 7 days, 30 days, this month, or your own dates). You see how many requests came in, how many were completed, still open, overdue, cancelled (and how many by the patient), or turned down, and how often they were accepted and completed on time.
  - **Staff work**: for every nurse or staff member, how many requests were assigned to them, accepted, completed (and how many on time), turned down (with their reasons), handed over to someone else, and still open, plus average time to accept and to finish. Managers also show how many requests they assigned and closed. Click a name to open **that person's own report**: their figures beside the whole hospital's, day by day, by service, and every action they took (accepted, completed on time or late, turned down and why, handed over to whom), with **Download** and **Print / PDF**.
  - **Not completed**: every cancelled, turned-down, or overdue request, with who did it, when, and the reason.
  - **Request log**: every request with who assigned, accepted, and completed it, and whether each step was on time. Filter it and **Download CSV** for Excel.
  - **Full history** (also the **History** link on the Requests screen) shows each step of one request: who did it, when, and why.
- **Hospital → Audit log** (Hospital Manager): every change in the hospital, such as staff added or suspended, roles given, patients admitted, QR codes replaced, and requests assigned or cancelled, with who did it, when, and what changed (before → after, with names). Filter by person, kind of change, or dates; click a person to see everything they changed, or an item to see its whole history; **Download CSV** saves what is shown. Entries cannot be edited or deleted.

Floor and ward managers and department supervisors see reports only for their own area; care staff see neither.

---

## 3. Key words (glossary)

| Word | Simple meaning |
|---|---|
| **Hospital** | One site or branch belonging to a client. Its operational data is separate from every other hospital. |
| **Location** | Building → Floor → Unit/Ward → Room → Bed. Building and Room are optional. |
| **Unit / ward** | Any care area: General ward, Private or Semi-private rooms, Emergency, Day care, Maternity, Labour room, Pediatric, Isolation, Burns, Dialysis, Post-op recovery, Psychiatry, or Other. Intensive care (ICU, NICU, and similar) is not supported: those patients are too critical for a bedside self-service QR. |
| **Bed** | Any place a patient is cared for: a bed, isolation bed, cot, labour bed, dialysis or day-care chair, or emergency trolley. It can be *Available*, *Occupied*, or *Under maintenance*. |
| **Bed session** | "A patient is in this bed right now." Admin **starts** it on admission and **closes** it on discharge. The QR only works while a session is active. |
| **QR code** | The secret link printed on the bed. Can be **replaced** (old one stops working) or **disabled**. |
| **Guest session** | The patient's temporary access after scanning (about 2 hours). Ends when the bed session closes or the QR is replaced. |
| **Department** | A team: Nursing, Pantry, Housekeeping, Transport, etc. |
| **Coverage** | Which ward/floor a staff member works in. |
| **On duty / Off duty** | Whether the staff member is working right now. |
| **Service** | A button the patient sees, e.g. "Drinking Water". Each service belongs to a department. |
| **SLA** | Time target, e.g. "accept within 3 min, finish within 10 min". Changing it creates a new **version**; old requests keep their old target. |
| **Request** | What the patient sends. Has a reference like `CR-6BF6974ABB77033A`. |
| **Request status** | Submitted → Assigned → Accepted → In progress → Completed → Closed (or Cancelled / Rejected). |

---

## 4. How a request flows (the big picture)

```text
 Admin starts bed session ──► Patient scans QR ──► Patient taps "Drinking Water"
                                                          │
                                                          ▼
                                          Request created: SUBMITTED
                                                          │
                       Floor manager assigns it to an eligible Pantry staff
                                                          ▼
                       ASSIGNED ──► ACCEPTED ──► IN PROGRESS ──► COMPLETED ──► CLOSED
```

**Who is "eligible"?** A staff member who is **active**, **on duty**, in the **right department**, and **covering that bed's ward/floor**. You can check this on the **Who can respond?** page.

---

## 5. What is finished and what is not

| Available now | Still planned |
|---|---|
| Admin sign-in, hospital setup, **Overview** home page | Automatic routing of requests to staff |
| Buildings, floors, 14 unit types (general, maternity, emergency…), rooms, beds/chairs/cots, bulk bed creation; request reports and audit screen | Advanced analytics and charting |
| QR codes + bed sessions; manual manager assignment and staff completion | Dedicated mobile task app and automatic routing |
| Departments, staff, duty, coverage | SLA alerts & escalation actually firing |
| Service catalog + SLA versions | Notifications (push/SMS/WhatsApp), live updates |
| Patient: scan, request, track, cancel, Hindi/English | Feedback, analytics, deployment, pilot |

Today: a request stays **Submitted** until a manager assigns it. Assigned staff can then accept, start, and complete it in **Requests**, or **turn it down** with a reason, and a manager closes it (or cancels it with a reason). A manager can also **hand over** accepted work to another eligible person, for example at a shift change. The patient sees a progress bar move through each step.

### Finding your way around the staff area

After signing in you land on **Overview**:

- **Counters** at the top: requests waiting for assignment, being handled, overdue, completed today, occupied beds, and staff on duty. Click any counter to jump to that screen.
- **Finish setting up** (admins only): the next relevant step, with the full checklist available when needed.
- **How CARE QR works** (admins only): an expandable explanation of the scan-to-completion flow.
- **Next places to go**: a few useful shortcuts; the navigation has the other screens your role can open.

The **Requests** screen has three tabs: **Open** (still being worked on, most urgent first), **Ready to close** (staff finished; manager closes), and **History** (closed or cancelled). It refreshes itself every 15 seconds. Each card shows the bed, how long ago it was sent, who it is assigned to, and the response-time target, which turns **red** with "overdue by …" when it is missed.

You only see the screens your role allows. A floor manager, for example, sees **Overview** and **Requests** for their own floor, not the hospital-wide staff list.

---

## 6. How the project is organised (for curiosity)

```text
QR_Hospital_management/
├── services/   ← the BACKEND (the "brain"): rules, database, security, tests
│   ├── src/modules/   one folder per feature (locations, qr, staff, catalog, requests…)
│   ├── prisma/        database structure and its change history
│   ├── tests/         automatic tests
├── frontend/   ← the WEBSITE (what you see): admin pages + patient pages
└── docs/       ← architecture, ER/data-flow diagrams, guides, and test plans (you are here)
```

The frontend runs at `http://localhost:5173`; it talks to the backend at `http://localhost:3001`. Data is stored in **PostgreSQL** (database). **Redis** is optional for now: nothing needs it yet, and the backend starts without it when `REDIS_URL` is empty.

The app is a **modular monolith**: one backend process and one frontend, with separate backend modules for authentication, locations, QR/session handling, staff, catalog/SLA, and requests. This keeps today's setup small while preserving boundaries for possible later extraction into microservices. See the [module rules](../../services/src/modules/README.md) and the [architecture decisions](../architecture/adr-0001-single-app-layout.md).

| Frontend page | Purpose |
|---|---|
| `/` | Patient-first QR scanner, with a separate staff sign-in link |
| `/login` | Staff/admin sign-in |
| `/platform/login`, `/platform` | Super admin: clients and their hospitals |
| `/admin/overview` | Role-relevant summary and next steps |
| `/admin/requests` | Manager assignment and staff work |
| `/admin/locations`, `/admin/beds` | Location setup, admissions, QR issuance |
| `/admin/departments`, `/admin/staff`, `/admin/roles`, `/admin/eligibility` | Teams, people, scoped access, coverage/duty, eligibility check |
| `/admin/services`, `/admin/sla` | Patient service buttons and response targets |
| `/admin/reports`, `/admin/audit` | Request reports and hospital audit log (permission-controlled) |
| `/q/<secret>`, `/patient` | QR exchange and patient request screen |

Patients and attendants do not have a login account or staff role. An authorized staff member starts the bed session. Staff with the appropriate QR permission (for example, a Hospital Manager or Admission Desk user) can issue and print bed-wise QR labels in **Beds & QR**; replacing or disabling a QR requires its own permission. Scanning that QR creates a short-lived guest session tied to the bed stay. The patient then chooses a published service, sends a request, and tracks it under **Your requests**. The raw QR link is shown only when issued. If a demo bed already has an active QR but you do not have its printed copy or link, use **Replace QR** to get a new one; this invalidates the old QR and connected patient sessions.

The backend exposes `/health` and `/ready` for checks; `/auth/staff/*` for staff sessions; `/admin/*` for permission-checked administration and request commands; and `/public/*` for QR/guest-session services. The frontend sends its API calls through the `/api` proxy during local development. **Requests** is the manual manager/staff work screen.

### What is protected behind the scenes

- Every hospital has its own records. The backend derives the current hospital from the signed-in staff or guest session; it does not trust a hospital or bed ID typed into a patient request.
- The printed QR contains a random bearer secret. Only its hash is stored in PostgreSQL. The secret is shown once when issued, and replacing/disabling it invalidates old patient access.
- A scan creates a short-lived guest session only while the bed has an active admission session. Staff and guest tokens are different and cannot be used interchangeably.
- A patient request stores the service details and the exact SLA version/deadlines at submission. Later catalog or SLA edits do not rewrite the old request. Each valid status change adds an append-only event and uses a version check to prevent conflicting updates.
- A staff member can receive a request only when active, on duty, in the matching department, and covering that bed. A shift schedule does not automatically change duty status.

See the [request-state rules](../architecture/request-state-machine.md), [QR/session rules](../architecture/qr-and-sessions.md), and [security rules](../architecture/security-rules.md) for exact backend behavior.

---

## 7. One-time local setup

The project requires Node.js 24+, npm 10+, and PostgreSQL 17+. Redis 7+ is optional. On a Mac with nvm and Homebrew, these commands are examples:

```bash
cd ~/Downloads/QR_Hospital_management
nvm install
brew install redis
brew services start redis
```

Start your local PostgreSQL server (for example Postgres.app). The database named in `services/.env` must exist and be accessible to its configured user. Copy `services/.env.example` to `services/.env` if needed, then set the **local** `DATABASE_URL` and `PUBLIC_APP_URL` (and `REDIS_URL` only if you run Redis). Do not share or commit `.env`.

Install dependencies and apply migrations:

```bash
cd ~/Downloads/QR_Hospital_management/services
npm ci
npm run prisma:migrate
cd ../frontend
npm ci
```

If any command fails, stop and fix that prerequisite before testing. `http://localhost:3001/ready` should return HTTP 200 only when PostgreSQL (and Redis, if `REDIS_URL` is set) is available. This machine's services can change between runs; the existence of `.env` or a previous report does not prove they are running now.

**After changing `DATABASE_URL`:** stop the running backend with `Ctrl + C`, run `npm run prisma:status` inside `services/` to check the **new** database, then run migrations and the demo seed if that database is empty. Restart the backend. The old backend process will keep using the previous database until it is restarted, even if you edit `.env` and the new database has been seeded.

### Load dummy data once

The demo data is created by [`seed-demo.ts`](../../services/src/cli/seed-demo.ts) and [`demo-seed.ts`](../../services/src/seeds/demo-seed.ts). It is **stored in the PostgreSQL database**, not in a JSON file. `bootstrapHospital` also adds the seven example departments, four services, and two SLAs for every new hospital.

Set private environment variables `DEMO_ADMIN_PASSWORD` and `DEMO_STAFF_PASSWORD` to two local-only passwords of at least 12 characters, then run this from `services/`:

```bash
DEMO_SEED_CONFIRM=CAREQR-DEMO npm run seed:demo
```

The script accepts only a local PostgreSQL URL, creates the demo hospital in one transaction, and refuses to overwrite an existing demo hospital or login email. It does not print passwords or the QR secret by default. If it says the hospital already exists, do **not** reset your database: use the existing demo credentials, or ask for help choosing a separate local test database. The detailed seed inventory and safety rules are in the [test plan](../testing/manual-test-plan-phases-0-8.md).

A **fresh** demo seed also creates `floor.manager.demo@careqr.example` with the `DEMO_STAFF_PASSWORD`. This account can assign requests only on the demo floor. An already-seeded hospital is not modified by this code change; its Hospital Admin can use **Requests** to test assignment without reseeding.

---

## 8. Start the app (every time)

Use **two Terminal windows**.

**Window 1 — backend:**
```bash
cd ~/Downloads/QR_Hospital_management
nvm use
cd services
npm run dev
```
Wait until it says the API is listening.

**Window 2 — website:**
```bash
cd ~/Downloads/QR_Hospital_management
nvm use
cd frontend
npm run dev
```

Now open **http://localhost:5173** in your browser.

To stop: press `Ctrl + C` in each window.

---

## 9. Where the dummy data is, and demo logins

> **Full test data for every role:** `npm run seed:test` (from `services/`) adds two dummy client hospitals, **CITYCARE** (19 people in every role, 29 beds, two weeks of request history) and **GREENVALLEY**. Every account uses your `DEMO_STAFF_PASSWORD`. The [full testing guide](./full-testing-guide.md) lists every login, what each role may do, and a step-by-step test for each person. The smaller `CAREQR-DEMO` hospital below still works as before.

| Who | Hospital code | Email | Password |
|---|---|---|---|
| Platform admin | — (use `/platform/login`) | `platform.demo@careqr.example` | the private `DEMO_PLATFORM_PASSWORD` (see below) |
| Hospital Manager | `CAREQR-DEMO` | `admin.demo@careqr.example` | the private `DEMO_ADMIN_PASSWORD` chosen when seeding |
| Floor manager (fresh seed only) | `CAREQR-DEMO` | `floor.manager.demo@careqr.example` | the private `DEMO_STAFF_PASSWORD` chosen when seeding |
| Ward manager, Pantry supervisor (fresh seed only) | `CAREQR-DEMO` | `ward.manager.demo@careqr.example`, `pantry.supervisor.demo@careqr.example` | the private `DEMO_STAFF_PASSWORD` |
| Staff | `CAREQR-DEMO` | `nurse.demo@careqr.example` (also `pantry.demo`, `housekeeping.demo`, `transport.demo`) | the private `DEMO_STAFF_PASSWORD` chosen when seeding |

Your passwords may be in your local `.env` or only in the terminal/password manager, depending on how you set them. Never paste them into ChatGPT or commit them. The script stores **password hashes** in PostgreSQL, not the original passwords.

After a successful seed, the demo hospital has: Demo Wing → First Floor → General Ward → Room 101 with **Bed 01** (occupied, active QR and bed session) and **Bed 02** (available, no QR), 7 departments, 4 on-duty ward-covered staff, 4 services, and 2 SLA policies. Staff members share a limited `Demo Care Staff` role; admin has the full setup role. Request, QR, and session records made during testing are also stored in PostgreSQL. No real patient information is seeded.

---

### Platform admin (super user)

Create the first platform admin once, from `services/`, with a private password of at least 12 characters:

```bash
PLATFORM_ADMIN_EMAIL=you@yourcompany.com PLATFORM_ADMIN_NAME="Your Name" PLATFORM_ADMIN_PASSWORD='choose-a-long-password' npm run bootstrap:platform-admin
```

A fresh demo seed can also create `platform.demo@careqr.example` if you set `DEMO_PLATFORM_PASSWORD` before `npm run seed:demo`.

**Try the SaaS flow:** sign in at `http://localhost:5173/platform/login` → **Clients** → **Add client** (the customer, then its first hospital: name, code, time zone, optional logo, first manager). A client's page has **Add hospital** for more branches → sign in as that manager at the staff sign-in page with the new hospital code → **Departments**: add a department → **Roles & access**: create a role → **Staff & coverage**: add a person and give them **Floor Manager** for one floor → sign in as them: they see only Overview, Requests, and Beds & QR for their floor. Back in the super admin, **Suspend hospital** signs everyone in that hospital out and stops its QR codes; **Suspend client** does the same for every hospital of that client at once. **Reactivate** restores access. No data is deleted.

---

## 10. Try it yourself — a 15-minute tour

Do these in order. ✔ = what you should see.

**A. Sign in**
1. Go to http://localhost:5173, choose **Staff sign in**, then enter the admin login.
   ✔ You land on **Overview** with counters, a setup checklist, and shortcuts. The left menu lists every screen.

**B. Look at the hospital layout**
2. Click **Location setup**.
   ✔ On the left is a tree: Demo Wing → First Floor → General Ward. On the right, **Whole hospital** shows totals and beds by unit type.
3. Click **General Ward** in the tree.
   ✔ Bed counts, an **Add beds** box, and Room 101 with Bed 01 and Bed 02.
4. (Optional) In **Add beds**, set **How many beds** to 4. The preview shows exactly which beds will be created (numbering continues after the existing beds). Click **Add 4 beds**.
   ✔ Four new beds appear under **Open bay (no room)**. Use **Edit**, **Deactivate**, or **Delete** on a new bed to try those. A bed that has had a QR or patient can only be deactivated, not deleted.
5. (Optional) Click **First Floor**, choose **Maternity / postnatal** in **Add a unit or ward** and click **Add unit**.
   ✔ The new Maternity Ward opens straight away with standard beds suggested. Try **Rooms with beds** to see how rooms 1–10 with 2 beds each would be numbered.

**Your hospital's logo.** Each hospital (each client) has its own logo. Open **Hospital → Profile & logo**, choose **Upload logo** (PNG, JPEG, WebP, or SVG), check the preview, then **Save logo**. It appears in the top bar for staff, at the top of the patient page, and on every QR label printed after that. When onboarding a new client from the command line, set `HOSPITAL_LOGO_PATH` before `npm run bootstrap:hospital`.

**Printing QR labels for many beds at once.** After **Add beds**, a green bar offers **Print QR labels** for exactly the beds you just added. Location screens also have QR-label actions. In **Beds & QR → Print QR labels**, choose a floor, then optionally a unit or room. You get one PDF, sorted bed by bed, in three sizes: **Large** (1 per A4 page, for the wall), **Medium** (4 per page, for the bed rail), or **Small** (12 stickers per page). Print at 100% scale (“Actual size”). Each new QR is shown only once: download the PDF straight away, keep it private, and delete it after printing. To reprint a lost active label, choose **Also reprint the existing labels**; the old label stops working.

**C. Make a QR code and test it like a patient**
6. Click **Beds & QR**. On **Bed 02**, click **Generate QR**.
   ✔ A QR label preview appears with **Download PDF**, **Open PDF to print**, and **Open patient view**.
7. Click **Open patient view** (opens a new tab).
   ✔ "We couldn't connect" — because no patient is admitted yet. Correct!
8. Go back, click **Done**, then **Start session** on Bed 02.
9. Open the **privately saved** Bed 02 patient link again, or paste it into the **Scan QR** screen at `http://localhost:5173`. If you did not save it, use **Replace QR** and open that new link. An old link stops working after replacement.
   ✔ "You are connected to Bed 02" with service buttons and a red "Not for emergencies" box.

**D. Send a request as the patient**
10. In the patient tab, tap **Request service** under Drinking Water.
   ✔ A request appears under "Your requests" with a `CR-...` reference, status **Submitted**, and a progress bar with the first step filled.
11. Change **Language** to हिन्दी.
   ✔ The page switches to Hindi. Switch back to English.
12. Click **Cancel request** → **Yes, cancel request**.
   ✔ Status becomes **Cancelled**.

**D2. Handle the request as staff**

13. Submit Drinking Water again in the patient tab.
14. In the staff tab, sign in as `floor.manager.demo@careqr.example` (fresh seed) or stay as the admin, and open **Requests**.
    ✔ The request is on the **Open** tab with "Accept by …" or, after 3 minutes, a red "Accept overdue by …".
15. Click **Choose staff**. When only one person is eligible they are selected for you; otherwise pick **Demo Pantry Staff**. Click **Assign request**.
    ✔ The card shows "Assigned to Demo Pantry Staff". The patient's progress bar moves to **Assigned** (within 30 seconds, or press **Refresh status**).
16. Sign out, sign in as `pantry.demo@careqr.example` with the staff password, open **Requests**, then click **Accept**, **Start work**, and **Mark complete**.
    ✔ The patient's progress bar fills up to **Completed**.
17. Sign back in as the manager/admin → **Requests** → **Ready to close** tab → **Close request**.
    ✔ The request moves to **History**. Also try **Cancel…** on another new request: you must choose a reason first.

On an older demo database without the floor-manager account, the Hospital Admin can do the manager steps. Do not re-run the seed against that existing hospital.

**E. Check which staff can respond**
18. Admin tab → **Who can respond?** → choose Bed 01 and **Pantry** → Check.
    ✔ "Demo Pantry Staff".
19. Choose **Billing**.
    ✔ "Nobody is eligible" (no billing staff).

**F. Add a staff member**
20. **Staff & coverage** → fill "Add staff member" (any name, an email ending `@careqr.example`, a 12+ character password).
21. In the **Manage** box add department **Pantry** and coverage **Ward → General Ward**. In the **Duty** column click **Set on duty** (the badge above it shows the current state).
22. Repeat step 18.
    ✔ Your new person now appears too. Set them off duty → they disappear.

**G. Change the services**
23. **Service catalog** → **Deactivate** under Drinking Water's **Active** badge. Reload the patient tab.
    ✔ Drinking Water is gone. Activate it again.
24. **Response targets (SLA)** → change Quick response to 4 and 12 → **Save as vN** (the next version).
    ✔ History keeps the earlier version as well as the new one. On a fresh seed, those are v1 (3/10) and v2 (4/12).

**H. Discharge**
25. **Beds & QR** → **Close session** on Bed 02. Reload the patient tab.
    ✔ "Your session has ended." The QR no longer works.

If all ✔ appeared, this **browser tour** passed; the API/security/concurrency tests in the full plan still need to run before Phase 9.

For one-by-one tests of the current roles, platform, reports, and audit, use the [full testing guide](./full-testing-guide.md). The [Phase 0–8 manual test plan](../testing/manual-test-plan-phases-0-8.md) and [previous local report](../testing/test-report-phases-0-8.md) are historical baselines, not a live status check or a substitute for your own results.

**To work with another ChatGPT chat:** upload this guide and the full test plan. Ask it to explain one test ID at a time, wait for your `PASS`/`FAIL`/`BLOCKED` result, and keep a results table. The exact copyable prompt is at the top of the test plan. Never paste `.env`, passwords, database URLs, bearer tokens, QR links, or real patient information into that chat.

**Automatic checks:** the backend has unit and database integration tests; the frontend has interaction tests. Run the quality-gate commands in the [root README](../../README.md#quality-gate). Integration tests need `TEST_DATABASE_URL` set to a **different disposable PostgreSQL database** with migrations applied; they do not read `services/.env`. A passing test suite checks more than the browser tour, including tenant separation, wrong permissions, duplicate-request races, request-state conflicts, and transaction rollback. Still test the real browser/mobile layout yourself.

---

## 11. If something goes wrong

| Problem | Fix |
|---|---|
| Backend window does not say "listening" | Check that PostgreSQL is running and that `DATABASE_URL` in `services/.env` points to it. If `REDIS_URL` is set, Redis must be running too; leave it empty to start without Redis. |
| Error `P1010` or "denied access" | The PostgreSQL user in `DATABASE_URL` lacks access; check your local PostgreSQL roles and database permissions. Do not paste the URL into ChatGPT. |
| Website shows "Cannot reach the hospital system" | The backend (Window 1) isn't running. |
| Sign-in fails | Check hospital code `CAREQR-DEMO`, that the seed completed, and the private password you chose. |
| QR says "not active" | Start a bed session for that bed, or use the newest QR (old ones stop working after Replace/Disable). |
| Seed says `CAREQR-DEMO` already exists | This is intentional protection. Use that demo hospital or a new separate local database; do not reset a database that may contain your work. |
