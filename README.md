# CARE QR

CARE QR is a modular hospital service-request platform. V1 has one backend service and one frontend app. The backend keeps domain boundaries inside one process so a module can be extracted later if needed.

## Repository layout

```text
frontend/   Web app for patient, staff, and administration screens (from Phase 8)
services/   Backend: Express API, domain modules, Prisma, tests, architecture docs
```

Architecture decisions are in [`services/docs/architecture`](./services/docs/architecture). Module boundaries are described in [`services/src/modules/README.md`](./services/src/modules/README.md).

## Prerequisites

- Node.js 20.19 or newer and npm 10 or newer
- PostgreSQL 17 or newer (for example Postgres.app)
- Redis 7 or newer (for example `brew install redis`), needed to run the server but not the tests

## Backend setup

Run these commands inside `services/`:

```bash
cp .env.example .env
npm install
npm run prisma:migrate
npm run dev
```

Edit `DATABASE_URL` and `REDIS_URL` in `.env` to match your local databases. `.env` is read by `npm run dev` and the `prisma:*` scripts.

## Quality gate

Every phase must pass these commands, run inside `services/`:

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

Integration tests do not read `.env`. Set `TEST_DATABASE_URL` to a disposable PostgreSQL database with migrations applied. Tests create isolated fixture hospitals with unique codes, so they can run repeatedly against the same database.

## Creating a hospital

Set `DATABASE_URL`, `HOSPITAL_NAME`, `HOSPITAL_CODE`, `HOSPITAL_TIMEZONE`, `ADMIN_EMAIL`, `ADMIN_NAME`, and a unique `ADMIN_PASSWORD` of at least 12 characters, then run `npm run bootstrap:hospital` inside `services/`. The password is hashed before storage and is not printed.
