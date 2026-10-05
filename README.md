# CARE QR

CARE QR is a modular hospital service-request platform. V1 has one backend service and one frontend app. The backend keeps domain boundaries inside one process so a module can be extracted later if needed.

Architecture decisions are documented in [`docs/architecture`](./docs/architecture).

## Workspace layout

```text
backend/   Express API, domain modules, Prisma, tests, and local infrastructure
frontend/  One app for patient, staff, and administration routes
docs/      Architecture decisions
```

## Prerequisites

- Node.js 20.19 or newer
- npm 10 or newer
- PostgreSQL 17+ and Redis 7+ (or Docker with Compose for local services)

## Local foundation workflow

```bash
cp backend/.env.example backend/.env
docker compose -f backend/docker-compose.yml up -d
npm install
npm run prisma:generate
npx prisma migrate deploy --schema backend/prisma/schema.prisma
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run build
npm run prisma:validate
```

Phase 2 integration tests require `TEST_DATABASE_URL` to point to a disposable PostgreSQL database with migrations applied. Tests create isolated fixture hospitals.

To provision a hospital administrator, set `DATABASE_URL`, `HOSPITAL_NAME`, `HOSPITAL_CODE`, `HOSPITAL_TIMEZONE`, `ADMIN_EMAIL`, `ADMIN_NAME`, and a unique `ADMIN_PASSWORD` of at least 12 characters, then run `npm run bootstrap:hospital --workspace @care-qr/backend`. The password is hashed before storage and is not printed.

No product domain feature should bypass the module boundaries described in [`backend/src/modules/README.md`](./backend/src/modules/README.md).
