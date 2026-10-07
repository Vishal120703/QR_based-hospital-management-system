# CARE QR: Phase 0–8 test plan

Use this guide on a **local, disposable test database**, not with real patients or a live hospital. Phases 0–8 are implemented; Phase 9 (manual routing) is next. A successful test of this guide does **not** mean the app is ready for clinical or production use.

The latest full run of this plan and its findings are in the [Phase 0–8 test report](./test-report-phases-0-8.md).

## Give this to the other chat

Upload this file and say:

> Act as my CARE QR test conductor. Work through the tests in ID order, one test at a time. For each test, tell me the action and expected result in simple language, then wait for my `PASS`, `FAIL`, `BLOCKED`, or `NOT RUN` and a short observation. Keep a results table with the ID, result, observation, and any issue to fix. Do not assume a test passed. If a dependency fails, mark affected tests blocked and continue only with independent tests. Never ask me to paste a password, database URL, staff or guest bearer token, QR link/token, or real patient information. At the end, summarize pass/fail/blocked counts, defects, and whether the Phase 9 entry criteria are met.

The order below follows test dependencies, so the phase numbers are not strictly sequential. Tests marked **Automated/API** have no complete browser workflow yet. The other chat should not invent a screen for them.

## 1. Prepare the local environment

1. Use Node.js 24+, npm 10+, PostgreSQL 17+, and Redis 7+. At the repository root, run `nvm install` once (it reads `.nvmrc`), then `nvm use`; `nvm use` alone fails if Node 24 is not installed yet. Install Redis with `brew install redis` and start it with `brew services start redis`: without Redis the backend waits forever at startup and `/ready` reports 503. Use a dedicated development database for the demo and a **different disposable database** for integration tests.
2. In `services/`, copy `.env.example` to `.env` and set `DATABASE_URL`, `REDIS_URL`, and `PUBLIC_APP_URL`. With Postgres.app, the database role is usually your macOS user name with no password, for example `postgresql://<your-mac-user>@localhost:5432/<database>?schema=public` (use the port Postgres.app shows). The role in `DATABASE_URL` must exist; a missing role fails with Prisma error P1010. If a password contains `@`, `:`, or `/`, URL-encode it. For testing in the same computer's browser, `PUBLIC_APP_URL=http://localhost:5173`. For a phone on the same Wi-Fi, set it to the computer's LAN address **before issuing QR codes** and start the frontend with `npm run dev -- --host`. Keep `.env` private.
3. In `services/`, run `npm ci`, `npm run prisma:migrate`, and `npm run dev` (backend: `http://localhost:3001`). Start Redis first. In another terminal, run `npm ci` and `npm run dev` inside `frontend/` (frontend: `http://localhost:5173`). The frontend proxies `/api` to the backend.
4. Run the one-time demo seed below against the **development** database, not the integration-test database. It refuses to overwrite an existing `CAREQR-DEMO` hospital. Do not delete an existing database just to rerun it.

### One-time dummy data

From `services/`, provide two **new, local-only** passwords of at least 12 characters as environment variables named `DEMO_ADMIN_PASSWORD` and `DEMO_STAFF_PASSWORD`. Keep them out of Git and out of the ChatGPT conversation. Then run:

```bash
DEMO_SEED_CONFIRM=CAREQR-DEMO npm run seed:demo
```

The seed creates this separate test hospital:

| Item | Dummy value |
|---|---|
| Hospital code / name | `CAREQR-DEMO` / CARE QR Demo Hospital |
| Administrator login | `admin.demo@careqr.example` / your `DEMO_ADMIN_PASSWORD` |
| Staff logins | `nurse.demo@careqr.example`, `pantry.demo@careqr.example`, `housekeeping.demo@careqr.example`, `transport.demo@careqr.example` / your `DEMO_STAFF_PASSWORD` |
| Location | Demo Wing → First Floor → General Ward → Room 101 |
| Bed 01 | Occupied, active bed session, active QR code |
| Bed 02 | Available, no active bed session, no QR code |
| Departments | Nursing, Housekeeping, Pantry, Maintenance, Patient Assistance, Billing, Transport |
| Services | Drinking Water, Nurse Assistance, Room Cleaning, Wheelchair |
| SLA examples | Quick response: accept 3 min / complete 10 min; Standard: 10 / 60 min |

The four staff are demo-only and set up to cover General Ward. The seed does not print passwords. The raw QR URL is not recoverable from an existing QR: use **Replace QR** for Bed 01 to see a new printable URL, or set `DEMO_SHOW_QR_TOKEN=yes` for the one-time seed output. Keep every QR URL private. If seeding reports that the hospital already exists, use the existing demo data and your recorded credentials; the command intentionally does not reset it.

The exact starting counts and SLA version numbers below assume a **fresh** demo hospital. If this hospital has already been used for tests, record the current baseline first and use new uniquely named test records, or choose a new isolated local database. Do not erase existing work to force a fresh baseline.

**Important:** No real patient name, diagnosis, phone number, or medical information is needed anywhere in this plan. A bed session deliberately has no patient identity.

## 2. Browser test run (one ID at a time)

Record `PASS`, `FAIL`, `BLOCKED`, or `NOT RUN` for each ID. Use `http://localhost:5173` unless the LAN setup above is in use. Keep the admin and patient views in separate tabs. Use Bed 02 for QR/session lifecycle tests; leave Bed 01 available for request tests.

| ID (phase) | Action | Expected result |
|---|---|---|
| M01 (0) | Inspect the repository and [architecture/status notes](../project-status.md). | One `services/` backend and one `frontend/` app; domain modules are inside the backend. Phases 0–8 are marked implemented and Phase 9 is next. This is a review, not a UI function. |
| M02 (1) | Open `http://localhost:3001/health` and `http://localhost:3001/ready`. | Both return HTTP 200 with `status: "ok"`; `/ready` lists healthy database and Redis probes. Normal backend startup requires both PostgreSQL and Redis. If either is unavailable, the backend may not start at all; record this check as BLOCKED (environment), fix the dependency, and retest. |
| M03 (1) | Open an unknown backend URL such as `/not-a-route`. | HTTP 404, no stack trace or secret in the response, and an `x-request-id` header. |
| M04 (2) | Open `/`, confirm **Scan QR** is the first screen, choose **Staff sign in**, then enter hospital code `CAREQR-DEMO`, admin email, and your private password. | The patient entry needs no login; staff sign-in succeeds and opens the admin area with only pages permitted to this account. |
| M05 (2) | Sign out, try a wrong password, then sign in correctly again. | Wrong credentials fail without revealing whether the email or hospital exists; signing back in works. Do not repeatedly guess passwords. |
| M06 (3) | Open **Location setup**. In the tree on the left, open Demo Wing → First Floor → General Ward. | The right side shows General Ward with Room 101 holding Bed 01 and Bed 02. **Whole hospital** shows totals and beds by unit type. Buildings and rooms are optional. |
| M07 (3) | On **Whole hospital**, add a floor with level `2` (name and code fill in as Second Floor / F2). Open it, add a **Maternity / postnatal** unit, then in **Add beds** add 4 numbered beds. | The floor appears in the tree in level order. The Maternity Ward opens automatically with standard beds suggested; the preview lists the exact codes (MAT-01 … MAT-04) and the beds appear after saving. Creating beds does not start a bed session or create a QR. |
| M07b (3) | In the same Maternity Ward use **Rooms with beds**: prefix `2`, first room `1`, 3 rooms, 2 beds each. Then try adding the same rooms again. Finally **Edit** one bed (type **Isolation bed**), **Deactivate** another, and **Delete** a third. | Rooms 201–203 with beds 201-A … 203-B are created. Repeating fails with "These codes already exist…" and nothing extra is created. Edit, deactivate, and delete work; a bed with QR/patient history can only be deactivated. |
| M07c (3) | Add a second building and give it a floor with code `G`, then add another `G` floor in Demo Wing. | Both succeed (floor codes are unique per building). Adding a second `G` to the same building is refused. |
| M08 (4) | In **Beds & QR**, search for Bed 02, check the **No active session** filter, then click **Generate QR**. Copy its link privately before closing the modal. | Bed 02 is available; the QR modal says the link is shown only once and offers **Print**, **Open patient view**, and **Copy patient link**. The page lists one active QR for that bed. |
| M09 (4) | Open Bed 02's QR link **before** starting its session. | The scan is refused with a generic unavailable/“couldn’t connect” message; it does not disclose the exact internal reason. |
| M10 (4) | Click **Start session** for Bed 02 and reopen the same QR link (or paste it into the **Scan QR** screen at `/`). | Bed 02 becomes occupied with an active admission session. The link opens `/patient`, displaying Bed 02's hospital/location without asking for patient identity. The QR token should disappear from the browser address bar after scan. |
| M11 (4/8) | From the Bed 02 patient tab, inspect **Your requests**. | No Bed 01 request is visible. The list belongs only to Bed 02's bed stay. If Bed 01 has no requests yet, repeat after M15. |
| M12 (6/8) | In **Beds & QR**, clear the Bed 02 search and choose **All beds** in the Sessions filter. On Bed 01, click **Replace QR** to obtain its fresh private link, then open it in a patient tab. | Bed 01 is already occupied, so scan succeeds. The page shows its location, the four seeded services, an emergency warning, and a notice that automatic routing/alerts are not active yet. |
| M13 (8) | Change **Language** from English to हिन्दी and back; reload the patient tab. | Patient controls, status labels, and safety notice switch language; selection stays for this tab. Service/category names may remain their configured names. |
| M14 (8) | On Bed 01 choose **Request service** for Drinking Water. | One request appears in **Your requests** with a `CR-` reference and **Submitted** status. The service button changes to **View request**. No automatic assignment or alert is expected. Record the reference privately for comparison. |
| M15 (8) | Click **View request**, **Refresh status**, and reload the Bed 01 patient tab. Then revisit the Bed 02 patient tab and refresh. | Bed 01 still shows the same reference, newest first. Bed 02 does not show that request. Status may remain Submitted until a Phase 7 API command processes it. |
| M16 (8) | On Bed 01 click **Cancel request**, then **Keep request**. Reopen cancellation and choose **Yes, cancel request**. | First choice changes nothing. Confirming changes only that request to **Cancelled**; its history remains. The cancel button disappears for the terminal request. |
| M17 (8) | Request Drinking Water again on Bed 01. | A **new** `CR-` reference appears because the previous request is terminal. The old cancelled entry stays in history. One active request per service/bed stay is the rule; repeated active submission must not create another. |
| M18 (5) | Open **Who can respond?**. Select Bed 01 and Pantry, then **Check eligibility**; repeat with Nursing. | The on-duty, ward-covered pantry and nursing demo staff appear for their matching departments, not the wrong department. This screen only checks eligibility; it does not assign requests. |
| M19 (5) | Open **Staff & coverage**. Add a new dummy staff member using a unique `@careqr.example` email and a private 12+ character temporary password. In **Manage**, add Pantry and General Ward coverage; leave them off duty initially. | Staff creation succeeds. The person is not eligible while off duty. Assign a role only if you intend to test that person's sign-in; eligibility itself does not require a role. |
| M20 (5) | Set the new member **On duty**, check Pantry eligibility for Bed 01, then set **Off duty** and check again. | They appear only while on duty. Removing their Pantry department or General Ward coverage also makes them ineligible. Restore only if you want that dummy member retained for later tests. |
| M21 (5) | If desired, add an upcoming shift to that dummy member while they are off duty. | The shift is saved, but it does **not** turn duty on or make them eligible. Scheduled shift and live duty are separate. |
| M22 (6) | Open **Service catalog**. Search Drinking Water, click **Deactivate** (under its **Active** badge), then reload the Bed 01 patient tab. Restore with **Activate** afterward. | Drinking Water disappears from choices while inactive, but the existing Drinking Water request history and service name remain. It returns after activation. Do this on a disposable demo only. |
| M23 (6) | Create a dummy category and service (for example `Test Comfort` / `Extra Blanket`) using an active department and SLA. Check Bed 01 patient view. | The new active service appears in its category. Deactivating its category hides it; reactivating shows it again. An inactive department also hides its services, but restore it after testing. |
| M24 (6) | In **Response targets (SLA)**, change **Quick response** accept/complete minutes to a valid pair such as `4 / 12`, then inspect the version history. | **Save as vN** creates one new version; the prior `3 / 10` version remains in history. Existing requests retain their original timing internally; the patient page does not expose SLA snapshot fields. |
| M25 (6) | Enter an invalid SLA pair, such as accept `15` and complete `10`, and click **Save as vN**. Optionally configure one demo escalation policy with ordered levels. | Invalid timing is rejected and no version is added. A valid escalation policy can be saved, but no escalation fires yet; execution is Phase 13. |
| M26 (4) | In **Beds & QR**, search for Bed 02 and choose **All beds** in the Sessions filter. Click **Replace QR** and save the new link privately. Try the original Bed 02 link, then the replacement. | Original link is unavailable; replacement works. The earlier Bed 02 patient session is invalidated and should end on refresh, tab reactivation, or within about 30 seconds. |
| M27 (4) | On Bed 02, click **Disable QR** and try the replacement link. Then **Generate QR** again and test the new link. | Disabled link is unavailable; a newly generated code works while its bed session is still active. Save only the newest link privately. |
| M28 (4) | Finally, click **Close session** for Bed 02, then refresh its patient tab and retry its newest QR link. | Bed 02 returns to Available; its guest session ends and the link cannot connect until a new bed session starts. Bed 01 should remain usable. |

### Staff request board and Overview (added after the first run)

| ID | Do this | Expected result |
|---|---|---|
| M29 | Sign in as admin. | You land on **Overview**: counters (waiting, being handled, overdue, completed today, occupied beds, staff on duty), a **Finish setting up** checklist for admins, a "How CARE QR works" box, and shortcut cards. Each counter links to its screen. |
| M30 | Submit Drinking Water on Bed 01, then open **Requests** as admin (or `floor.manager.demo` on a fresh seed). Click **Choose staff** → **Assign request**. | The card is on the **Open** tab with "Accept by …" (red "overdue by …" after the target). Only eligible staff are offered; a single candidate is preselected. After assigning, the card shows the assignee and the patient's progress bar reaches **Assigned** within 30 seconds. |
| M31 | Sign in as `pantry.demo`, open **Requests**, then **Accept** → **Start work** → **Mark complete**. Back as the manager, open **Ready to close** → **Close request**. | Pantry sees only their own work. The patient's progress bar fills to **Completed**. After closing, the request appears under **History**. |
| M32 | On a new Submitted request click **Cancel…**, choose **Other** and leave the text empty; then enter a reason and confirm. | **Cancel request** stays disabled until a reason exists. After confirming, the patient sees **Cancelled** and the request moves to **History**. |
| M33 | (Fresh seed) Sign in as `floor.manager.demo`. | The menu shows only **Overview** and **Requests**. Opening `/admin/staff` directly shows **Access restricted**; the server also refuses the hospital-wide staff list (403). |
| M34 | In **Location setup**, add 4 beds to a unit with **Add beds**. In the green "beds added" bar click **Print QR labels (4)**. Choose **Small**, then **Download PDF**. | The dialog shows the 4 new beds in location order with a preview. The PDF has one A4 page of sticker-size labels with dashed cut lines; each label shows the hospital name, “Scan for help” in English and Hindi, the QR, bed name, full location, the emergency warning (not on small), and the bed code. Print at 100% scale; scanning a label with a phone opens the patient page once that bed has an active session. |
| M35 | In **Beds & QR → Print QR labels**, choose a floor only (all units). Then tick **Also reprint the existing labels** and create again. | The first run creates labels only for beds that have none. The reprint asks for confirmation, replaces the codes (old printed labels stop working, connected patients are signed out), and the result says how many were replaced. Closing the label dialog without downloading asks for confirmation. |
| M36 | Open **Hospital → Profile & logo**, upload a logo (try an SVG and a PNG), check the preview, and save. Then open the patient page, print a QR label, and finally **Remove logo**. | The logo shows in the staff top bar, at the top of the patient page, and on labels printed afterwards; the Overview checklist ticks “Add your hospital logo”. A non-image file is refused with a clear message. Removing it restores the plain CARE QR header. Other hospitals never see this logo. |
| M37 | Sign in at `/platform/login` as the platform admin. Choose **Add hospital**, fill in name, code (suggested from the name), time zone, an optional logo, and the first manager, then **Create hospital**. | The hospital opens with its logo, code, status **active**, and its manager listed. The staff sign-in page accepts the new code and manager. The new hospital has none of the demo hospital's data. |
| M38 | As the new Hospital Manager open **Roles & access**. | Five built-in roles in hierarchy order (Hospital Manager, Floor Manager, Ward Manager, Department Supervisor, Care Staff). Hospital Manager shows "every permission" and has no Edit button. |
| M39 | Add a department (**Departments**), then **Create role** with **Applies to: One department**, starting from Department Supervisor. In **Staff & coverage** add a person, **Manage** → choose **Floor Manager** → a second list asks which floor → **Add**. | The role is created with the chosen permissions (permissions you do not hold are greyed out). The person shows a chip such as "Floor Manager · First Floor"; the same role can be added for a second floor, and each place can be removed separately. |
| M40 | Sign in as that floor manager. | Menu shows only Overview, Requests, and Beds & QR. Beds & QR lists only their floor's beds, with **Start session** but no QR printing. Opening `/admin/staff` or `/admin/roles` shows **Access restricted**. |
| M41 | In the platform, **Suspend hospital** (confirm), then try the floor manager's tab and a patient QR of that hospital. Then **Reactivate hospital**. | While suspended: staff are signed out and cannot sign in; patient QR links do not open. After reactivation everything works again; the other hospital is never affected. |
| M42 | As Hospital Manager open **Work → Reports** with **Last 7 days**. | Tiles show requests, completed, still open, overdue now, cancelled (and how many by the patient), turned down, and on-time percentages. **Staff work** lists each person with assigned, accepted, completed, on-time %, turned down (with reasons), handed over, open now, and average times. |
| M43 | Have a staff member **turn down** an assigned request with a reason (API `reject`), cancel another as a manager with a reason, and leave one past its target. Open **Not completed**. | Each appears with who did it, when, and the reason; the overdue one shows how long it is overdue and who has it. **Full history** shows every step with names. |
| M44 | In **Request log**, filter by a person and by result, search a reference, and **Download CSV**. | Only matching requests appear; the CSV opens in Excel with names (including Hindi) intact. |
| M45 | Sign in as a floor manager and as a care staff member. | The floor manager sees **Reports** limited to their floor but no **Audit log**; care staff see neither, and cannot open another person's request by its link. |
| M46 | As Hospital Manager open **Hospital → Audit log**, choose **Request handling**, then **Load older changes**. | Entries read in plain words (for example "Assigned a request — Drinking Water (CR-…)") with who and when; cancel/turn-down entries include the reason. |

The patient page checks request status and session validity about every 30 seconds while visible and on tab visibility change. After a QR/session change, use **Refresh status**, reload, or wait up to 30 seconds; do not expect an instant push update. The guest credential lasts for a limited time (default 120 minutes), so an expired tab must rescan a valid QR.

## 3. API and automated checks (Phases 1–8)

The **Requests** screen now covers assign, accept, start, complete, close, and cancel in the browser (M30–M32). Staff can also turn down their assigned work and managers can hand accepted work to someone else from the same screen (see the [full testing guide](../guides/full-testing-guide.md)). The following checks are part of the acceptance plan; let the other ChatGPT chat guide them only when you are comfortable with local developer tools. Never share bearer tokens or database credentials in that chat.

| ID | Check | Expected result / method |
|---|---|---|
| A01 (2–8) | Run the complete quality gate below. | Every command exits 0. Integration tests use the separate disposable database and cover tenant isolation, permissions, guest expiry/closure, QR revocation, duplicate submissions, cancellation races, request transitions, audit coupling, and rollback. |
| A02 (2) | Call an admin route without a staff bearer token; repeat with an invalid token. | HTTP 401. A signed-in account without the required permission gets 403. A resource from another hospital must not be disclosed (usually 404). Existing integration tests are the safer way to check cross-hospital cases. |
| A03 (4/8) | Call guest-only `/public/session`, `/public/services`, and `/public/requests` without a guest bearer token. | HTTP 401. A staff token cannot act as a guest; a guest token cannot act as staff. The QR resolve route is the only unauthenticated entry to a guest session. |
| A04 (8) | Submit the same `{ "serviceId": "<UUID>" }` twice from the same active bed stay through `POST /public/requests`. | First response is HTTP 201; active duplicate is HTTP 200 with the **same** public reference. A different bed stay cannot list/cancel this request. The integration suite exercises the race; do not send simultaneous manual requests to a shared system. |
| A05 (8) | Cancel through `POST /public/requests/:publicId/cancel` with `{ "reason": "Test cancellation" }`; try an inaccessible or already completed reference. | Own Submitted/Assigned request returns 200 and Cancelled. Inaccessible reference gives 404; changed/non-cancellable state gives 409. The browser test M16 covers the ordinary path. |
| A06 (7) | Verify named command endpoints `POST /admin/requests/:id/{assign,accept,start,complete,close,cancel,reject,transfer}` in an isolated test. | Normal path: `SUBMITTED → ASSIGNED → ACCEPTED → IN_PROGRESS → COMPLETED → CLOSED`. Each command needs the current positive `expectedVersion`; assign needs eligible `assigneeId`; cancel/reject need a nonempty reason; transfer needs assignee and reason. Admin can assign/close, but accept/start/complete/reject must use the **assigned eligible staff member's** token. A successful command increments version and appends one immutable event. |
| A07 (7) | Exercise invalid transitions and stale `expectedVersion` on the disposable test database. | HTTP 409; no extra transition/event. Terminal states do not move again. Simultaneous accept has only one winner. A forced event-write failure rolls the state change back. Use integration tests rather than manipulating live data. |
| A08 (6/7) | Check a submitted request's catalog and SLA snapshot after catalog/SLA edits. | Original service/category names, department ID, priority, SLA version, timings, and deadlines remain frozen. The patient UI only shows service name/status; verify internal fields with tests or local read-only DB inspection. |
| A09 (2–8) | Review request/response security in the integration tests. | Forged `hospitalId`, `bedId`, or `bedSessionId` cannot select another tenant or bed; cross-hospital relationships are rejected; public responses omit internal tenant/bed/session/assignee/SLA IDs and use `Cache-Control: no-store`. |

For A06, an internal request UUID is needed; the public `CR-…` reference is **not** that UUID. `GET /admin/requests/:id` and `/events` can inspect it once found with a local read-only database query. Do not use a guessed UUID or post token-bearing API examples in ChatGPT. The automated tests in `services/tests/integration/request-core.test.ts` and `public-requests.test.ts` are the primary Phase 7/8 proof until staff screens exist.

### Complete quality gate

First create a **separate, disposable** PostgreSQL database, then point `TEST_DATABASE_URL` at it in the test terminal. From `services/`, apply migrations with `DATABASE_URL="$TEST_DATABASE_URL" npm run prisma:migrate` before running integration tests. Use the same override for `npm run prisma:status` if checking that test database; without it, status checks the development database from `services/.env`. Do not point the test URL at the demo database, and never at production. Integration tests do not read `services/.env`.

From `services/`:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run build
npm run prisma:validate
npm run prisma:status
```

From `frontend/`:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

These are development gates, not a substitute for a real device/browser pass. Browser tests should also be tried at mobile width or on a phone on the same Wi-Fi. Test QR printing with a dummy code, and check that the emergency warning remains visible and legible.

## 4. Completion record and Phase 9 entry rule

Ask the other ChatGPT chat to keep a table like this (add rows as tests finish):

| ID | Result | What happened / evidence | Defect or follow-up |
|---|---|---|---|
| M01 | NOT RUN | — | — |

Before starting Phase 9, require:

- All runnable browser tests M01–M46 pass, or any exceptions are explicitly recorded and accepted.
- A01 passes against a **separate** test database; no migration drift or build/type/lint failures remain.
- A02–A09 are covered by the passing integration suite or explicitly marked for a separate API session; no tenant leak or request-state defect remains open.
- No real patient data, passwords, bearer tokens, or QR URLs were pasted into the shared test chat or committed to the repository.

Known, **not** a Phase 0–8 failure: automatic routing, full manager dashboards and reports, request notifications, executable SLA escalation, realtime push, feedback, analytics, deployment, and pilot workflows belong to Phases 9–25. A new patient request stays **Submitted** until a manager assigns it on the **Requests** screen.
