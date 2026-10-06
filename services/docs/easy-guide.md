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
5. In the intended full workflow, the right staff member (for example the Pantry team for water) handles it and the patient sees progress. **The staff workflow screens are not built yet**; a new request currently stays Submitted unless it is handled through the backend command API.

The current version provides a testable foundation for tracking requests and response-time targets. It must not be relied on to summon staff in a real hospital yet.

> ⚠️ CARE QR is **not for emergencies**. The app always tells patients to use the nurse-call button in an emergency.

---

## 2. Who uses it?

| Person | What they do | Where |
|---|---|---|
| **Hospital admin** | Sets up the hospital: floors, wards, beds, staff, services, QR codes | Admin website (sign in) |
| **Staff** (nurse, pantry, housekeeping…) | Receive and complete requests | *Staff screens come in a later phase* |
| **Patient / family** | Scan the QR, request help, track it | Phone browser, no login |

---

## 3. Key words (glossary)

| Word | Simple meaning |
|---|---|
| **Hospital** | One customer. Each hospital's data is completely separate from others. |
| **Location** | Building → Floor → Ward → Room → Bed. Building and Room are optional. |
| **Bed** | A bed position. It can be *Available* or *Occupied*. |
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
             (later phases) manager/system assigns it to an eligible Pantry staff
                                                          ▼
                       ASSIGNED ──► ACCEPTED ──► IN PROGRESS ──► COMPLETED ──► CLOSED
```

**Who is "eligible"?** A staff member who is **active**, **on duty**, in the **right department**, and **covering that bed's ward/floor**. You can check this on the **Who can respond?** page.

---

## 5. What is finished and what is not

| Done ✅ (Phases 0–8) | Not yet ⏳ (Phases 9–25) |
|---|---|
| Admin sign-in, hospital setup | Automatic routing of requests to staff |
| Floors, wards, rooms, beds | Manager dashboard |
| QR codes + bed sessions | Staff mobile screens (accept/complete in the app) |
| Departments, staff, duty, coverage | SLA alerts & escalation actually firing |
| Service catalog + SLA versions | Notifications (push/SMS/WhatsApp), live updates |
| Patient: scan, request, track, cancel, Hindi/English | Feedback, analytics, deployment, pilot |

So today: **a patient's request is saved and stays "Submitted"** — no staff screen picks it up yet. That is expected, not a bug.

---

## 6. How the project is organised (for curiosity)

```text
QR_Hospital_management/
├── services/   ← the BACKEND (the "brain"): rules, database, security, tests
│   ├── src/modules/   one folder per feature (locations, qr, staff, catalog, requests…)
│   ├── prisma/        database structure and its change history
│   ├── tests/         automatic tests
│   └── docs/          documentation (you are here)
└── frontend/   ← the WEBSITE (what you see): admin pages + patient pages
```

The frontend runs at `http://localhost:5173`; it talks to the backend at `http://localhost:3001`. Data is stored in **PostgreSQL** (database). **Redis** is a helper the backend needs to start.

The app is a **modular monolith**: one backend process and one frontend, with separate backend modules for authentication, locations, QR/session handling, staff, catalog/SLA, and requests. This keeps today's setup small while preserving boundaries for possible later extraction into microservices. See the [module rules](../src/modules/README.md) and the [architecture decisions](./architecture/adr-0001-single-app-layout.md).

| Frontend page | Purpose |
|---|---|
| `/login` | Staff/admin sign-in |
| `/admin/locations`, `/admin/beds` | Location setup, admissions, QR issuance |
| `/admin/departments`, `/admin/staff`, `/admin/eligibility` | Teams, people, coverage/duty, eligibility check |
| `/admin/services`, `/admin/sla` | Patient service buttons and response targets |
| `/q/<secret>`, `/patient` | QR exchange and patient request screen |

The backend exposes `/health` and `/ready` for checks; `/auth/staff/*` for staff sessions; `/admin/*` for permission-checked administration and request commands; and `/public/*` for QR/guest-session services. Admin request commands exist even though request-management screens do not. The frontend sends its API calls through the `/api` proxy during local development.

### What is protected behind the scenes

- Every hospital has its own records. The backend derives the current hospital from the signed-in staff or guest session; it does not trust a hospital or bed ID typed into a patient request.
- The printed QR contains a random bearer secret. Only its hash is stored in PostgreSQL. The secret is shown once when issued, and replacing/disabling it invalidates old patient access.
- A scan creates a short-lived guest session only while the bed has an active admission session. Staff and guest tokens are different and cannot be used interchangeably.
- A patient request stores the service details and the exact SLA version/deadlines at submission. Later catalog or SLA edits do not rewrite the old request. Each valid status change adds an append-only event and uses a version check to prevent conflicting updates.
- A staff member can receive a request only when active, on duty, in the matching department, and covering that bed. A shift schedule does not automatically change duty status.

See the [request-state rules](./architecture/request-state-machine.md), [QR/session rules](./architecture/qr-and-sessions.md), and [security rules](./architecture/security-rules.md) for exact backend behavior.

---

## 7. One-time local setup

The project requires Node.js 24+, npm 10+, PostgreSQL 17+, and Redis 7+. On a Mac with nvm and Homebrew, these commands are examples:

```bash
cd ~/Downloads/QR_Hospital_management
nvm install
brew install redis
brew services start redis
```

Start your local PostgreSQL server (for example Postgres.app). The database named in `services/.env` must exist and be accessible to its configured user. Copy `services/.env.example` to `services/.env` if needed, then set the **local** `DATABASE_URL`, `REDIS_URL`, and `PUBLIC_APP_URL`. Do not share or commit `.env`.

Install dependencies and apply migrations:

```bash
cd ~/Downloads/QR_Hospital_management/services
npm ci
npm run prisma:migrate
cd ../frontend
npm ci
```

If any command fails, stop and fix that prerequisite before testing. `http://localhost:3001/ready` should return HTTP 200 only when PostgreSQL and Redis are both available. This machine's services can change between runs; the existence of `.env` or a previous report does not prove they are running now.

**After changing `DATABASE_URL`:** stop the running backend with `Ctrl + C`, run `npm run prisma:status` inside `services/` to check the **new** database, then run migrations and the demo seed if that database is empty. Restart the backend. The old backend process will keep using the previous database until it is restarted, even if you edit `.env` and the new database has been seeded.

### Load dummy data once

The demo data is created by [`demo-seed.cli.ts`](../src/modules/hospitals/demo-seed.cli.ts) and [`demo-seed.ts`](../src/modules/hospitals/demo-seed.ts). It is **stored in the PostgreSQL database**, not in a JSON file. `bootstrapHospital` also adds the seven example departments, four services, and two SLAs for every new hospital.

Set private environment variables `DEMO_ADMIN_PASSWORD` and `DEMO_STAFF_PASSWORD` to two local-only passwords of at least 12 characters, then run this from `services/`:

```bash
DEMO_SEED_CONFIRM=CAREQR-DEMO npm run seed:demo
```

The script accepts only a local PostgreSQL URL, creates the demo hospital in one transaction, and refuses to overwrite an existing demo hospital or login email. It does not print passwords or the QR secret by default. If it says the hospital already exists, do **not** reset your database: use the existing demo credentials, or ask for help choosing a separate local test database. The detailed seed inventory and safety rules are in the [test plan](./manual-test-plan-phases-0-8.md).

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

| Who | Hospital code | Email | Password |
|---|---|---|---|
| Admin | `CAREQR-DEMO` | `admin.demo@careqr.example` | the private `DEMO_ADMIN_PASSWORD` chosen when seeding |
| Staff | `CAREQR-DEMO` | `nurse.demo@careqr.example` (also `pantry.demo`, `housekeeping.demo`, `transport.demo`) | the private `DEMO_STAFF_PASSWORD` chosen when seeding |

Your passwords may be in your local `.env` or only in the terminal/password manager, depending on how you set them. Never paste them into ChatGPT or commit them. The script stores **password hashes** in PostgreSQL, not the original passwords.

After a successful seed, the demo hospital has: Demo Wing → First Floor → General Ward → Room 101 with **Bed 01** (occupied, active QR and bed session) and **Bed 02** (available, no QR), 7 departments, 4 on-duty ward-covered staff, 4 services, and 2 SLA policies. Staff members share a limited `Demo Care Staff` role; admin has the full setup role. Request, QR, and session records made during testing are also stored in PostgreSQL. No real patient information is seeded.

---

## 10. Try it yourself — a 15-minute tour

Do these in order. ✔ = what you should see.

**A. Sign in**
1. Go to http://localhost:5173, enter the admin login.
   ✔ You see the admin area with a left menu.

**B. Look at the hospital layout**
2. Click **Location setup**.
   ✔ First Floor → General Ward → Room 101 → Bed 01, Bed 02.

**C. Make a QR code and test it like a patient**
3. Click **Beds & QR**. On **Bed 02**, click **Generate QR**.
   ✔ A QR picture appears with buttons Print / Open patient view.
4. Click **Open patient view** (opens a new tab).
   ✔ "We couldn't connect" — because no patient is admitted yet. Correct!
5. Go back, click **Done**, then **Start session** on Bed 02.
6. Open the **privately saved** Bed 02 patient link again; if you did not save it, use **Replace QR** and open that new link. An old link stops working after replacement.
   ✔ "You are connected to Bed 02" with service buttons and a red "Not for emergencies" box.

**D. Send a request as the patient**
7. In the patient tab, tap **Request service** under Drinking Water.
   ✔ A request appears under "Your requests" with a `CR-...` reference and status **Submitted**.
8. Change **Language** to हिन्दी.
   ✔ The page switches to Hindi. Switch back to English.
9. Click **Cancel request** → **Yes, cancel request**.
   ✔ Status becomes **Cancelled**.

**E. Check which staff can respond**
10. Admin tab → **Who can respond?** → choose Bed 01 and **Pantry** → Check.
    ✔ "Demo Pantry Staff".
11. Choose **Billing**.
    ✔ "Nobody is eligible" (no billing staff).

**F. Add a staff member**
12. **Staff & coverage** → fill "Add staff member" (any name, an email ending `@careqr.example`, a 12+ character password).
13. In the **Manage** box add department **Pantry** and coverage **Ward → General Ward**. Click **Set on duty**.
14. Repeat step 10.
    ✔ Your new person now appears too. Set them off duty → they disappear.

**G. Change the services**
15. **Service catalog** → **Deactivate service** on Drinking Water. Reload the patient tab.
    ✔ Drinking Water is gone. Activate it again.
16. **Response targets (SLA)** → change Quick response to 4 and 12 → **Save as vN** (the next version).
    ✔ History keeps the earlier version as well as the new one. On a fresh seed, those are v1 (3/10) and v2 (4/12).

**H. Discharge**
17. **Beds & QR** → **Close session** on Bed 02. Reload the patient tab.
    ✔ "Your session has ended." The QR no longer works.

If all ✔ appeared, this **browser tour** passed; the API/security/concurrency tests in the full plan still need to run before Phase 9.

For the full, detailed checklist (28 browser checks and 9 API/automated checks) to run one-by-one with ChatGPT, use [manual-test-plan-phases-0-8.md](./manual-test-plan-phases-0-8.md). A [previous local test report](./test-report-phases-0-8.md) records one machine's observed run; it is not a live status check or a substitute for your own results.

**To work with another ChatGPT chat:** upload this guide and the full test plan. Ask it to explain one test ID at a time, wait for your `PASS`/`FAIL`/`BLOCKED` result, and keep a results table. The exact copyable prompt is at the top of the test plan. Never paste `.env`, passwords, database URLs, bearer tokens, QR links, or real patient information into that chat.

**Automatic checks:** the backend has unit and database integration tests; the frontend has interaction tests. Run the quality-gate commands in the [root README](../../README.md#quality-gate). Integration tests need `TEST_DATABASE_URL` set to a **different disposable PostgreSQL database** with migrations applied; they do not read `services/.env`. A passing test suite checks more than the browser tour, including tenant separation, wrong permissions, duplicate-request races, request-state conflicts, and transaction rollback. Still test the real browser/mobile layout yourself.

---

## 11. If something goes wrong

| Problem | Fix |
|---|---|
| Backend window does not say "listening" | Check that PostgreSQL and Redis are running and that the URLs in `services/.env` point to them. Normal startup waits for both connections. |
| Error `P1010` or "denied access" | The PostgreSQL user in `DATABASE_URL` lacks access; check your local PostgreSQL roles and database permissions. Do not paste the URL into ChatGPT. |
| Website shows "Cannot reach the hospital system" | The backend (Window 1) isn't running. |
| Sign-in fails | Check hospital code `CAREQR-DEMO`, that the seed completed, and the private password you chose. |
| QR says "not active" | Start a bed session for that bed, or use the newest QR (old ones stop working after Replace/Disable). |
| Seed says `CAREQR-DEMO` already exists | This is intentional protection. Use that demo hospital or a new separate local database; do not reset a database that may contain your work. |
