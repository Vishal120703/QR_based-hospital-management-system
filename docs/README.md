# CARE QR documentation

CARE QR is one React frontend and one Express/Prisma backend. Start with the guide that matches your task:

| If you want to… | Read |
|---|---|
| Understand the product, roles, demo data, and local setup | [Easy guide](./guides/easy-guide.md) |
| Trace a request from QR scan to completion | [Data-flow diagrams and sequences](./architecture/data-flow.md) |
| Understand module boundaries and the folder layout | [Architecture](./architecture/README.md) and [module catalog](./architecture/modules.md) |
| See tables, columns, and relationships | [Generated ER diagrams](./database/er-diagram.md) and [`schema.prisma`](../services/prisma/schema.prisma) |
| Add a feature without breaking the boundaries | [Adding a feature](./adding-a-feature.md) |
| Test every role and workflow | [Full testing guide](./guides/full-testing-guide.md) |
| Check what is implemented versus still planned | [Project status](./project-status.md) |

The [Phase 0–8 test plan](./testing/manual-test-plan-phases-0-8.md) and [historical report](./testing/test-report-phases-0-8.md) cover an earlier baseline; use the full testing guide for later platform, reports, audit, and staff features.

The ER diagram is generated from the Prisma model. After changing the schema, run `npm run prisma:generate` and `npm run docs:er` from `services/`; use `npm run docs:er:check` to verify it. Never run database integration tests against the development or production database; they require an isolated `TEST_DATABASE_URL`.
