# CARE QR

CARE QR is a modular hospital service-request platform. V1 is intentionally built as a modular monolith with one API service and one background worker so domain modules can be extracted later without carrying distributed-system complexity into the first release.

Architecture decisions are documented in [`docs/architecture`](./docs/architecture).

## Workspace layout

```text
apps/                 Patient, staff, and administration web clients
services/api/          Express API and modular application core
services/worker/       BullMQ background processing host
packages/shared/       Stable cross-workspace contracts and utilities
deploy/                Local and deployment infrastructure
docs/                  Product and architecture documentation
```

## Prerequisites

- Node.js 20.19 or newer
- npm 10 or newer
- Docker with Compose for local PostgreSQL and Redis

## Local foundation workflow

```bash
cp services/api/.env.example services/api/.env
docker compose -f deploy/docker-compose.yml up -d
npm install
npm run prisma:generate
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run build
npm run prisma:validate
```

No product domain feature should bypass the module boundaries described in [`services/api/src/modules/README.md`](./services/api/src/modules/README.md).
