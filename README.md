# CARE QR

CARE QR is a modular hospital service-request platform. V1 has one backend service and one frontend app. The backend keeps domain boundaries inside one process so a module can be extracted later if needed.

## Repository layout

```text
frontend/   React web app: staff administration and the patient QR pages
services/   Backend: Express API, domain modules, Prisma, tests, architecture docs
```

Architecture decisions are in [`services/docs/architecture`](./services/docs/architecture). Module boundaries are described in [`services/src/modules/README.md`](./services/src/modules/README.md).

## Current progress

The patient QR flow and manual request workflow are implemented: managers assign requests and staff accept, start, and complete them. Automatic routing, alerts, and production hardening remain. See the [phase-by-phase status and audit results](./services/docs/project-status.md).

The [Phase 0–8 manual test plan](./services/docs/manual-test-plan-phases-0-8.md) is a historical baseline, not the full acceptance plan for the newer manager, staff, platform, and QR-label features.

For a plain-language walkthrough of the architecture, demo data, and local setup, read the [easy project guide](./services/docs/easy-guide.md).

To test every role with ready-made dummy hospitals, run `npm run seed:test` in `services/` and follow the [full testing guide](./services/docs/full-testing-guide.md).

Patients can submit, track, and cancel eligible service requests from an active QR session. A floor manager can manually assign requests; assigned staff can accept, start, and mark them complete. Automatic routing, alerts, and notifications are still later work. This is not ready for hospital production use.

## Prerequisites

- Node.js 24 or newer and npm 10 or newer (`.nvmrc` pins the tested version)
- PostgreSQL 17 or newer (for example Postgres.app)
- Redis 7 or newer (for example `brew install redis`, then `brew services start redis`). The server waits for Redis at startup; tests do not need it.

If you use nvm, run `nvm use` from the repository root before running either app. `.nvmrc` pins Node 24.19.0.

If you change `services/.env` (especially `DATABASE_URL`), stop and restart the backend: a running process keeps its old connection. Check the **new** database with `npm run prisma:status`, apply its migrations if needed, and seed the demo hospital only if it is absent. Never reset an existing database just to make sign-in work.

## Run the app

1. Backend, inside `services/`:

   ```bash
   cp .env.example .env      # then set DATABASE_URL and REDIS_URL
   npm ci
   npm run prisma:migrate
   npm run dev               # http://localhost:3001
   ```

2. Create the SaaS **platform admin** (the CARE QR team account that onboards hospitals), inside `services/`: set `PLATFORM_ADMIN_EMAIL`, `PLATFORM_ADMIN_NAME`, and a `PLATFORM_ADMIN_PASSWORD` of at least 12 characters, then run `npm run bootstrap:platform-admin`. Sign in at `/platform/login` and use **Add hospital** to create each client hospital with its logo and first Hospital Manager. Alternatively, create a hospital and its first administrator from the command line, inside `services/`. Set `DATABASE_URL`, `HOSPITAL_NAME`, `HOSPITAL_CODE`, `HOSPITAL_TIMEZONE`, `ADMIN_EMAIL`, `ADMIN_NAME`, and an `ADMIN_PASSWORD` of at least 12 characters, then run `npm run bootstrap:hospital`. The password is hashed and never printed. To brand a new client hospital at the same time, also set `HOSPITAL_LOGO_PATH` to a PNG, JPEG, or WebP file of up to 1 MB; a bad file stops the command before anything is created. The logo can be added or changed later in **Hospital → Profile & logo**.

   For a ready-made **dummy hospital instead of this step**, follow the [one-time demo seed instructions](./services/docs/easy-guide.md#load-dummy-data-once). It creates `CAREQR-DEMO` with beds, staff, catalog, and an active bed session in a local database; it refuses to overwrite an existing demo hospital.

3. Frontend, inside `frontend/`:

   ```bash
   npm ci
   npm run dev               # http://localhost:5173
   ```

   The frontend forwards `/api` to the backend on port 3001.

## Try it

1. Open http://localhost:5173. Patients see **Scan QR** first and can use the live camera, take/choose a QR photo, or paste their bedside QR link without signing in. Staff choose **Staff sign in** and enter the hospital code, email, and password from step 2. Staff land on **Overview**, with role-relevant counts and a few next-step shortcuts; the navigation lists their other available sections.
2. **Location setup:** add a floor (with its level), then a unit such as a General ward or ICU, then add its beds in one step with **Add beds**. Buildings and rooms are optional. Use **Beds & QR → Print QR labels** to choose a floor and optionally a unit or room, then download one A4 PDF with a separate QR for each active bed that needs one. Location screens also offer contextual QR-label actions.
3. **Beds & QR:** choose **Start session** for an available bed, then **Generate QR**. In the one-time QR dialog, choose **Open patient view** to test on this computer, or **Download PDF** and print it at actual size. If an active QR already exists but its link was lost, choose **Replace QR** to issue a new one; the old code stops working.
4. On the patient page, choose a service and select **Request service**. The request appears under **Your requests**, where the patient can track or cancel it while eligible.
5. **Close session**, **Replace QR**, or **Disable QR** ends existing patient access. The patient page rechecks access every 30 seconds and when the tab becomes visible.
6. **Staff:** add a staff member, then **Manage** them: add a department (for example Housekeeping) and coverage (a ward). Turn them **On duty**.
7. **Services** and **SLA:** hide a service and it disappears from the patient view. Change an SLA's minutes and it saves a new version; the history keeps every earlier version.
8. **Who can respond?:** pick a bed and a department. Only staff who are active, on duty, in that department, and covering that bed's ward, floor, or the whole hospital are listed.

To open a printed QR with a real phone on the same Wi-Fi, start the frontend with `npm run dev -- --host`, and set `PUBLIC_APP_URL=http://<your-computer-ip>:5173` in `services/.env` **before issuing the QR**. A phone's built-in Camera app can open the printed link directly. In-app live camera scanning requires a secure browser context (HTTPS, or `localhost` on the device running the browser); on an HTTP LAN address, use **Take / choose a QR photo**, the phone's Camera app, or a pasted link instead. QR photos are decoded locally and not uploaded.

## Quality gate

Every phase must pass these commands. Inside `services/`:

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

Inside `frontend/`:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

Integration tests do not read `.env`. Set `TEST_DATABASE_URL` to a disposable PostgreSQL database with migrations applied. Tests create isolated fixture hospitals with unique codes, so they can run repeatedly against the same database.
