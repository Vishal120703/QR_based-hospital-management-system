# CARE QR

CARE QR is a modular hospital service-request platform. V1 has one backend service and one frontend app. The backend keeps domain boundaries inside one process so a module can be extracted later if needed.

## Repository layout

```text
frontend/   React web app: staff administration and the patient QR pages
services/   Backend: Express API, domain modules, Prisma, tests, architecture docs
```

Architecture decisions are in [`services/docs/architecture`](./services/docs/architecture). Module boundaries are described in [`services/src/modules/README.md`](./services/src/modules/README.md).

## Prerequisites

- Node.js 20.19 or newer and npm 10 or newer
- PostgreSQL 17 or newer (for example Postgres.app)
- Redis 7 or newer (for example `brew install redis`, then `brew services start redis`). The server waits for Redis at startup; tests do not need it.

## Run the app

1. Backend, inside `services/`:

   ```bash
   cp .env.example .env      # then set DATABASE_URL and REDIS_URL
   npm install
   npm run prisma:migrate
   npm run dev               # http://localhost:3000
   ```

2. Create a hospital and its first administrator, inside `services/`. Set `DATABASE_URL`, `HOSPITAL_NAME`, `HOSPITAL_CODE`, `HOSPITAL_TIMEZONE`, `ADMIN_EMAIL`, `ADMIN_NAME`, and an `ADMIN_PASSWORD` of at least 12 characters, then run `npm run bootstrap:hospital`. The password is hashed and never printed.

3. Frontend, inside `frontend/`:

   ```bash
   npm install
   npm run dev               # http://localhost:5173
   ```

   The frontend forwards `/api` to the backend on port 3000.

## Try it

1. Open http://localhost:5173 and sign in with the hospital code, email, and password from step 2.
2. **Locations:** add a floor, a ward, optionally a room, and a bed.
3. **Beds & QR:** generate a QR code for the bed. Choose **Open patient view**: it is refused, because the bed has no active session.
4. Choose **Start session**, then open the patient view again: it shows the bed and the emergency notice.
5. **Close session** or **Rotate** the QR code: the patient view ends and the old code stops working.
6. **Staff:** add a staff member, then **Manage** them: add a department (for example Housekeeping) and coverage (a ward). Turn them **On duty**.
7. **Who can respond?:** pick a bed and a department. Only staff who are active, on duty, in that department, and covering that bed's ward, floor, or the whole hospital are listed.

To scan with a real phone on the same Wi-Fi, start the frontend with `npm run dev -- --host`, and set `PUBLIC_APP_URL=http://<your-computer-ip>:5173` in `services/.env` before generating the QR code.

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
npm run build
```

Integration tests do not read `.env`. Set `TEST_DATABASE_URL` to a disposable PostgreSQL database with migrations applied. Tests create isolated fixture hospitals with unique codes, so they can run repeatedly against the same database.
